"""Tests for M1.2 post-render self-review.

The review service shells out to ffprobe / ffmpeg. We monkeypatch
``subprocess.run`` so the tests are deterministic and do not require
external binaries or real media files.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from comic_studio.services.render_review import (
    FrameStats,
    RenderReviewError,
    RenderReviewService,
    _format_duration,
    _has_subtitle_stream,
    _stream_types,
)


# --- Helpers --------------------------------------------------------------


def _make_render_file(tmp_path: Path) -> Path:
    """Create a dummy file that stands in for a rendered MP4."""

    path = tmp_path / "renders" / "episode.mp4"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    return path


def _ffprobe_response(
    *,
    video: bool = True,
    audio: bool = True,
    subtitle: bool = False,
    duration: float = 10.0,
) -> dict:
    streams = []
    if video:
        streams.append(
            {
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1080,
                "height": 1920,
                "duration": str(duration),
            }
        )
    if audio:
        streams.append(
            {
                "codec_type": "audio",
                "codec_name": "aac",
                "duration": str(duration),
            }
        )
    if subtitle:
        streams.append({"codec_type": "subtitle", "codec_name": "mov_text"})
    return {"streams": streams, "format": {"duration": str(duration)}}


class _FakeProcess:
    def __init__(self, stdout: str = "", stderr: str = "", returncode: int = 0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode


# --- Pure helpers ---------------------------------------------------------


def test_format_duration_parses_float():
    assert _format_duration({"format": {"duration": "12.5"}}) == 12.5


def test_format_duration_defaults_to_zero_on_garbage():
    assert _format_duration({"format": {"duration": "n/a"}}) == 0.0
    assert _format_duration({}) == 0.0


def test_stream_types_extracts_codec_types():
    ffprobe = _ffprobe_response()
    assert _stream_types(ffprobe) == {"video", "audio"}


def test_has_subtitle_stream_detects_subtitle_codec():
    assert _has_subtitle_stream(_ffprobe_response(subtitle=True)) is True
    assert _has_subtitle_stream(_ffprobe_response(subtitle=False)) is False


# --- inspect() with mocked subprocess ------------------------------------


def test_inspect_passes_on_clean_render(tmp_path):
    render_path = _make_render_file(tmp_path)
    ffprobe = _ffprobe_response(duration=10.0)

    def fake_run(cmd, **kwargs):
        if "ffprobe" in cmd[0]:
            return _FakeProcess(stdout=json.dumps(ffprobe))
        if "silencedetect" in " ".join(cmd):
            # No silence detected.
            return _FakeProcess(stderr="")
        if "ffmpeg" in cmd[0]:
            # Frame extraction — produce a non-black dummy PNG.
            frame_path = Path(cmd[-1])
            frame_path.parent.mkdir(parents=True, exist_ok=True)
            # Minimal 1x1 white-ish PNG.
            frame_path.write_bytes(
                b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
                b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
                b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01"
                b"\x82\x8aB\x00\x00\x00\x00IEND\xaeB`\x82"
            )
            return _FakeProcess()
        return _FakeProcess()

    with patch("comic_studio.services.render_review.subprocess.run", side_effect=fake_run):
        result = RenderReviewService(session=None).inspect(render_path)

    assert result.overall_pass is True
    assert result.black_frame_positions == []
    assert result.subtitle_present is False  # no subtitle stream → info only
    assert not any(f["severity"] == "critical" for f in result.findings)


def test_inspect_fails_on_missing_video_stream(tmp_path):
    render_path = _make_render_file(tmp_path)
    ffprobe = _ffprobe_response(video=False, audio=True)

    def fake_run(cmd, **kwargs):
        return _FakeProcess(stdout=json.dumps(ffprobe))

    with patch("comic_studio.services.render_review.subprocess.run", side_effect=fake_run):
        result = RenderReviewService(session=None).inspect(render_path)

    assert result.overall_pass is False
    codes = [f["code"] for f in result.findings]
    assert "no_video_stream" in codes


def test_inspect_fails_on_missing_audio_stream(tmp_path):
    render_path = _make_render_file(tmp_path)
    ffprobe = _ffprobe_response(video=True, audio=False)

    def fake_run(cmd, **kwargs):
        return _FakeProcess(stdout=json.dumps(ffprobe))

    with patch("comic_studio.services.render_review.subprocess.run", side_effect=fake_run):
        result = RenderReviewService(session=None).inspect(render_path)

    assert result.overall_pass is False
    codes = [f["code"] for f in result.findings]
    assert "no_audio_stream" in codes


def test_inspect_raises_when_ffprobe_missing(tmp_path):
    render_path = _make_render_file(tmp_path)

    def fake_run(cmd, **kwargs):
        raise FileNotFoundError("ffprobe")

    with patch("comic_studio.services.render_review.subprocess.run", side_effect=fake_run):
        with pytest.raises(RenderReviewError, match="ffprobe not found"):
            RenderReviewService(session=None).inspect(render_path)


def test_inspect_raises_when_render_file_missing(tmp_path):
    missing = tmp_path / "does-not-exist.mp4"
    with pytest.raises(RenderReviewError, match="Render output not found"):
        RenderReviewService(session=None).inspect(missing)


def test_inspect_flags_excessive_silence(tmp_path):
    render_path = _make_render_file(tmp_path)
    ffprobe = _ffprobe_response(duration=10.0)

    def fake_run(cmd, **kwargs):
        if "ffprobe" in cmd[0]:
            return _FakeProcess(stdout=json.dumps(ffprobe))
        if "silencedetect" in " ".join(cmd):
            # Simulate 6 seconds of silence in a 10s clip (>40% threshold).
            stderr = (
                "[silencedetect @ 0x0] silence_start: 1.0\n"
                "[silencedetect @ 0x0] silence_end: 7.0 | silence_duration: 6.0\n"
            )
            return _FakeProcess(stderr=stderr)
        if "ffmpeg" in cmd[0]:
            frame_path = Path(cmd[-1])
            frame_path.parent.mkdir(parents=True, exist_ok=True)
            frame_path.write_bytes(b"\x89PNG\r\n\x1a\n")  # dummy non-black
            return _FakeProcess()
        return _FakeProcess()

    with patch("comic_studio.services.render_review.subprocess.run", side_effect=fake_run):
        result = RenderReviewService(session=None).inspect(render_path)

    assert result.overall_pass is False
    codes = [f["code"] for f in result.findings]
    assert "excessive_silence" in codes
    assert len(result.silence_ranges) == 1
    assert result.silence_ranges[0]["start"] == 1.0
    assert result.silence_ranges[0]["end"] == 7.0


# --- Persistence ----------------------------------------------------------


def test_review_render_persists_record(db_session):
    from comic_studio import models

    project = models.Project(title="P", logline="", story_bible="", visual_style="")
    db_session.add(project)
    db_session.flush()
    episode = models.Episode(project_id=project.id, title="E", premise="test", target_duration_seconds=60)
    db_session.add(episode)
    db_session.flush()

    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        render_path = Path(tmp.name)
    try:
        ffprobe = _ffprobe_response(duration=5.0)

        def fake_run(cmd, **kwargs):
            if "ffprobe" in cmd[0]:
                return _FakeProcess(stdout=json.dumps(ffprobe))
            return _FakeProcess(stderr="")

        with patch("comic_studio.services.render_review.subprocess.run", side_effect=fake_run):
            record = RenderReviewService(db_session).review_render(
                render_path, episode.id, job_id="job-1"
            )
        db_session.commit()

        assert record.episode_id == episode.id
        assert record.job_id == "job-1"
        assert record.render_path == str(render_path)
        assert record.overall_pass is True
        assert isinstance(record.findings, list)

        latest = RenderReviewService(db_session).latest_for_episode(episode.id)
        assert latest is not None
        assert latest.id == record.id
    finally:
        render_path.unlink(missing_ok=True)


def test_render_review_route_returns_404_when_none(client):
    project = client.post(
        "/api/projects",
        json={
            "title": "项目",
            "logline": "梗概",
            "story_bible": "设定",
            "visual_style": "漫画",
            "aspect_ratio": "9:16",
        },
    ).json()
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "第一集", "premise": "测试", "target_duration_seconds": 60},
    ).json()
    response = client.get(f"/api/episodes/{episode['id']}/render-review")
    assert response.status_code == 404


def test_render_review_route_404_for_unknown_episode(client):
    response = client.get("/api/episodes/unknown/render-review")
    assert response.status_code == 404


def test_render_job_persists_review_with_its_job_id(client, monkeypatch):
    from comic_studio import models
    from comic_studio.jobs import JobStore
    from comic_studio.routes.renders import run_render_job

    project = client.post(
        "/api/projects",
        json={
            "title": "项目",
            "logline": "梗概",
            "story_bible": "设定",
            "visual_style": "漫画",
            "aspect_ratio": "9:16",
        },
    ).json()
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "第一集", "premise": "测试", "target_duration_seconds": 60},
    ).json()
    with client.app.state.session_factory() as session:
        job = JobStore(session).create(
            "render_episode", "episode", episode["id"], {}
        )
        job_id = job.id

    captured = {}
    monkeypatch.setattr(
        "comic_studio.routes.renders.RenderingService.render",
        lambda self, episode_id, output: {"streams": [{"codec_type": "video"}]},
    )

    def fake_review(self, output, episode_id, *, job_id=None):
        captured["job_id"] = job_id
        return object()

    monkeypatch.setattr(
        "comic_studio.routes.renders.RenderReviewService.review_render",
        fake_review,
    )
    monkeypatch.setattr(
        "comic_studio.services.render_review.review_to_payload",
        lambda record: {"overall_pass": True},
    )

    run_render_job(client.app, job_id, episode["id"])

    with client.app.state.session_factory() as session:
        persisted = session.get(models.Job, job_id)
        assert persisted is not None
        assert persisted.status == "succeeded"
        assert persisted.result_metadata["review"]["overall_pass"] is True
    assert captured["job_id"] == job_id


# --- M2.4 Slideshow risk -------------------------------------------------


def test_score_slideshow_risk_from_frames_static_is_high():
    """Near-identical consecutive frames should score as slideshow-like."""
    from comic_studio.services.render_review import score_slideshow_risk_from_frames

    # All frames nearly identical luma → very low inter-frame difference.
    static = [
        FrameStats(position_seconds=p, mean_luma=120.0, bright_ratio=0.5)
        for p in (0.1, 0.35, 0.6, 0.85)
    ]
    result = score_slideshow_risk_from_frames(
        static,
        duration_seconds=10.0,
        shot_durations=[3.0, 3.0, 3.0, 3.0],
        shot_camera_motions=["push_in", "push_in", "push_in", "push_in"],
    )
    assert result.score >= 0.4
    assert result.level in {"warning", "critical"}
    assert "frame_difference" in result.dimensions
    assert "motion_diversity" in result.dimensions


def test_score_slideshow_risk_from_frames_dynamic_is_low():
    """Strongly varying frames with diverse motion should score ok."""
    from comic_studio.services.render_review import score_slideshow_risk_from_frames

    dynamic = [
        FrameStats(position_seconds=0.1, mean_luma=20.0, bright_ratio=0.1),
        FrameStats(position_seconds=0.35, mean_luma=160.0, bright_ratio=0.6),
        FrameStats(position_seconds=0.6, mean_luma=80.0, bright_ratio=0.3),
        FrameStats(position_seconds=0.85, mean_luma=200.0, bright_ratio=0.8),
    ]
    result = score_slideshow_risk_from_frames(
        dynamic,
        duration_seconds=10.0,
        shot_durations=[1.5, 4.0, 2.0, 5.5],
        shot_camera_motions=["push_in", "pan_left", "zoom_out", "static"],
    )
    assert result.score < 0.4
    assert result.level == "ok"


def test_score_slideshow_risk_classify_thresholds():
    from comic_studio.services.render_review import _classify_score

    assert _classify_score(0.2) == "ok"
    assert _classify_score(0.5) == "warning"
    assert _classify_score(0.8) == "critical"


def test_review_render_persists_slideshow_risk(db_session):
    """review_render must populate slideshow_risk alongside the basic review."""
    from comic_studio import models

    project = models.Project(title="P", logline="", story_bible="", visual_style="")
    db_session.add(project)
    db_session.flush()
    episode = models.Episode(
        project_id=project.id, title="E", premise="t",
        target_duration_seconds=60,
    )
    db_session.add(episode)
    db_session.flush()

    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        render_path = Path(tmp.name)
    try:
        ffprobe = _ffprobe_response(duration=5.0)

        def fake_run(cmd, **kwargs):
            if "ffprobe" in cmd[0]:
                return _FakeProcess(stdout=json.dumps(ffprobe))
            if "ffmpeg" in cmd[0] and "silencedetect" not in " ".join(cmd):
                # Frame extraction → produce a varying-frame PNG sequence.
                frame_path = Path(cmd[-1])
                frame_path.parent.mkdir(parents=True, exist_ok=True)
                frame_path.write_bytes(b"\x89PNG\r\n\x1a\n")
                return _FakeProcess()
            return _FakeProcess(stderr="")

        with patch("comic_studio.services.render_review.subprocess.run", side_effect=fake_run):
            record = RenderReviewService(db_session).review_render(
                render_path, episode.id, job_id="job-m24"
            )
        db_session.commit()

        assert record.slideshow_risk is not None
        assert "score" in record.slideshow_risk
        assert record.slideshow_risk["level"] in {"ok", "warning", "critical"}
        assert "dimensions" in record.slideshow_risk
    finally:
        render_path.unlink(missing_ok=True)
