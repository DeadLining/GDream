"""M1.2: Post-render self-review service.

Inspects a rendered MP4 for common quality failures (black frames, silence,
missing audio/subtitle) so that broken renders never silently surface as
publishable. The review is non-blocking by default — the caller decides
whether to gate publication on ``overall_pass``.

Designed to run after :meth:`RenderingService.render` completes. Uses
``ffprobe`` / ``ffmpeg`` (already required by the compositor) and PIL
(already in the API venv) for frame inspection.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from comic_studio import models


# Thresholds (tuned for 1080p dynamic-comic renders at 24-30 fps).
_BLACK_FRAME_LUMA_MAX = 12  # mean pixel value below this → black (0-255 scale)
_BLACK_FRAME_RATIO_MAX = 0.02  # max bright-pixel ratio for a frame to count as black
_SILENCE_DB_THRESHOLD = -50  # ffmpeg silencedetect threshold
_FRAME_SAMPLE_POSITIONS = (0.1, 0.35, 0.6, 0.85)  # normalized positions


@dataclass(frozen=True)
class FrameStats:
    position_seconds: float
    mean_luma: float
    bright_ratio: float


@dataclass(frozen=True)
class RenderReviewResult:
    overall_pass: bool
    ffprobe_json: dict[str, Any]
    black_frame_positions: list[float]
    silence_ranges: list[dict[str, float]]
    subtitle_present: bool
    findings: list[dict[str, Any]]
    # M2.4: frame stats sampled during black-frame detection. Reused by the
    # slideshow-risk scorer to avoid a second ffmpeg pass.
    sampled_stats: list[FrameStats] = None  # type: ignore[assignment]


# --- M2.4 Slideshow risk -------------------------------------------------
# Dynamic comics are at risk of looking like a static slideshow: near-static
# frames, repetitive imagery, low motion diversity. We score this on a 0..1
# scale where higher = more slideshow-like (worse).

_SLIDESHOW_RISK_LEVELS = ("ok", "warning", "critical")


@dataclass(frozen=True)
class SlideshowRiskResult:
    score: float  # 0..1
    level: str  # ok | warning | critical
    dimensions: dict[str, float]  # individual dimension scores (0..1)
    triggered: list[str]  # dimension names whose score crossed warning


def _perceptual_hash(gray_pixels: list[int]) -> int:
    """Compute a small 8x8 average-hash over already-grayscale pixels.

    Returns a 64-bit integer; close Hamming distance means similar imagery.
    """
    avg = sum(gray_pixels) / max(1, len(gray_pixels))
    bits = 0
    for idx, value in enumerate(gray_pixels):
        if value >= avg:
            bits |= 1 << idx
    return bits


def _hamming_distance(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def _classify_score(score: float) -> str:
    if score >= 0.7:
        return "critical"
    if score >= 0.4:
        return "warning"
    return "ok"


def score_slideshow_risk_from_frames(
    frame_stats: list[FrameStats],
    *,
    duration_seconds: float,
    shot_durations: list[float] | None = None,
    shot_camera_motions: list[str] | None = None,
) -> SlideshowRiskResult:
    """Score slideshow risk from already-sampled frame stats.

    Dimensions (each normalized to 0..1, higher = worse):
    - frame_difference: low variance between consecutive frames → slideshow-like.
    - repetition: high perceptual-hash similarity across frames.
    - motion_diversity: low diversity of shot camera_motion values.
    - duration_uniformity: very uniform shot durations suggest rigid pacing.
    - static_panel_ratio: heuristic when no real motion data is available
      (uses low frame_difference ratio).
    """
    dimensions: dict[str, float] = {}
    triggered: list[str] = []

    if len(frame_stats) >= 2:
        luma_sequence = [s.mean_luma for s in frame_stats]
        max_luma = max(luma_sequence) + 1e-6
        diffs = [abs(luma_sequence[i + 1] - luma_sequence[i]) for i in range(len(luma_sequence) - 1)]
        mean_diff = sum(diffs) / len(diffs)
        # Normalize: <5 luma units of change → strongly slideshow-like (1.0).
        frame_diff_score = max(0.0, min(1.0, 1.0 - (mean_diff / max_luma) * 20))
        dimensions["frame_difference"] = frame_diff_score

        # Repetition via perceptual hash over bright_ratio + luma bucket signature.
        # We approximate pHash from (mean_luma, bright_ratio) buckets.
        pseudo_hashes = [
            (int(s.mean_luma) & 0xF0) | (int(s.bright_ratio * 15) & 0x0F)
            for s in frame_stats
        ]
        if len(pseudo_hashes) >= 2:
            pair_distances = [
                _hamming_distance(pseudo_hashes[i], pseudo_hashes[i + 1])
                for i in range(len(pseudo_hashes) - 1)
            ]
            mean_dist = sum(pair_distances) / len(pair_distances)
            # 8-bit signature; distance 0 = identical, 8 = maximally different.
            dimensions["repetition"] = max(0.0, min(1.0, 1.0 - mean_dist / 8))
        else:
            dimensions["repetition"] = 1.0
    else:
        # Not enough frames to measure motion → assume worst case.
        dimensions["frame_difference"] = 1.0
        dimensions["repetition"] = 1.0

    # Camera motion diversity.
    if shot_camera_motions:
        unique = len(set(shot_camera_motions))
        # 1 unique motion across many shots → score 1.0; ≥4 unique → score ~0.
        diversity_score = max(0.0, min(1.0, 1.0 - (unique - 1) / 4))
        dimensions["motion_diversity"] = diversity_score
    else:
        dimensions["motion_diversity"] = 0.5  # neutral when unknown

    # Duration uniformity (variance-based).
    if shot_durations and len(shot_durations) >= 2:
        mean_dur = sum(shot_durations) / len(shot_durations)
        variance = sum((d - mean_dur) ** 2 for d in shot_durations) / len(shot_durations)
        # Coefficient of variation; <0.1 → very uniform (slideshow-like pacing).
        cv = (variance ** 0.5) / max(0.1, mean_dur)
        dimensions["duration_uniformity"] = max(0.0, min(1.0, 1.0 - cv * 5))
    else:
        dimensions["duration_uniformity"] = 0.5

    # Static-panel ratio proxy: fraction of consecutive frame pairs that barely
    # differ (mean luma delta under 3 units). High ratio → many static cuts.
    if len(frame_stats) >= 2:
        static_pairs = sum(
            1
            for i in range(len(frame_stats) - 1)
            if abs(frame_stats[i + 1].mean_luma - frame_stats[i].mean_luma) < 3
        )
        dimensions["static_panel_ratio"] = static_pairs / (len(frame_stats) - 1)
    else:
        dimensions["static_panel_ratio"] = 1.0

    # Weighted blend (sums to 1.0).
    weights = {
        "frame_difference": 0.30,
        "repetition": 0.15,
        "motion_diversity": 0.15,
        "duration_uniformity": 0.10,
        "static_panel_ratio": 0.20,
    }
    # Remaining 0.10 reserved for "subtitle ratio" dimension which we cannot
    # estimate without OCR; treat as neutral 0.5 contribution.
    score = 0.5 * 0.10  # subtitle placeholder
    for key, weight in weights.items():
        score += dimensions.get(key, 0.0) * weight

    score = max(0.0, min(1.0, score))
    level = _classify_score(score)
    triggered = [k for k, v in dimensions.items() if v >= 0.7]
    return SlideshowRiskResult(
        score=round(score, 3),
        level=level,
        dimensions={k: round(v, 3) for k, v in dimensions.items()},
        triggered=triggered,
    )


def _shot_metadata_for_episode(session: Session | None, episode_id: str | None) -> tuple[list[float], list[str]]:
    """Return (shot_durations, shot_camera_motions) for an episode, if available."""
    if session is None or episode_id is None:
        return [], []
    from comic_studio import models as _models  # local import to avoid cycles
    rows = session.execute(
        select(_models.Shot.duration_seconds, _models.Shot.camera_motion)
        .join(_models.Scene, _models.Scene.id == _models.Shot.scene_id)
        .where(_models.Scene.episode_id == episode_id)
    ).all()
    durations = [float(r[0]) for r in rows if r[0] is not None]
    motions = [str(r[1]) for r in rows if r[1]]
    return durations, motions


class RenderReviewError(RuntimeError):
    """Raised when the review cannot be performed (e.g. ffprobe missing)."""


def _run_ffprobe(path: Path) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries",
                "stream=codec_type,codec_name,width,height,duration,nb_frames:format=duration",
                "-of", "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except FileNotFoundError as exc:
        raise RenderReviewError("ffprobe not found on PATH") from exc
    except subprocess.CalledProcessError as exc:
        raise RenderReviewError(f"ffprobe failed: {exc.stderr[:300]}") from exc
    return json.loads(result.stdout or "{}")


def _format_duration(ffprobe_json: dict[str, Any]) -> float:
    fmt = ffprobe_json.get("format", {})
    try:
        return float(fmt.get("duration", 0))
    except (TypeError, ValueError):
        return 0.0


def _stream_types(ffprobe_json: dict[str, Any]) -> set[str]:
    return {s.get("codec_type", "") for s in ffprobe_json.get("streams", [])}


def _sample_frame(path: Path, position_seconds: float, tmp_dir: Path) -> Path | None:
    """Extract a single frame at the given timestamp via ffmpeg."""

    frame_path = tmp_dir / f"frame_{int(position_seconds * 1000)}.png"
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-ss", str(position_seconds),
                "-i", str(path),
                "-frames:v", "1",
                str(frame_path),
            ],
            check=True,
            capture_output=True,
            timeout=20,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    return frame_path if frame_path.is_file() else None


def _analyze_frame(frame_path: Path) -> FrameStats | None:
    """Return mean luma and bright-pixel ratio for a PNG frame using PIL."""

    try:
        from PIL import Image  # local import; PIL is heavy

        with Image.open(frame_path) as img:
            gray = img.convert("L").resize((160, 160))
            pixels = list(gray.getdata())
    except Exception:
        return None
    if not pixels:
        return None
    mean_luma = sum(pixels) / len(pixels)
    bright = sum(1 for p in pixels if p > 40)
    bright_ratio = bright / len(pixels)
    return FrameStats(
        position_seconds=0.0,  # filled by caller
        mean_luma=mean_luma,
        bright_ratio=bright_ratio,
    )


def _detect_silence(path: Path) -> list[dict[str, float]]:
    """Use ffmpeg silencedetect to find silent ranges in the audio track."""

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-v", "error",
                "-i", str(path),
                "-af", f"silencedetect=n={_SILENCE_DB_THRESHOLD}dB:d=0.6",
                "-f", "null", "-",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return []
    ranges: list[dict[str, float]] = []
    current_start: float | None = None
    for line in result.stderr.splitlines():
        if "silence_start:" in line:
            try:
                current_start = float(line.split("silence_start:")[1].strip())
            except (IndexError, ValueError):
                current_start = None
        elif "silence_end:" in line and current_start is not None:
            try:
                end_part = line.split("silence_end:")[1].strip()
                end = float(end_part.split()[0])
                ranges.append({"start": current_start, "end": end})
            except (IndexError, ValueError):
                pass
            current_start = None
    return ranges


def _has_subtitle_stream(ffprobe_json: dict[str, Any]) -> bool:
    for stream in ffprobe_json.get("streams", []):
        codec_type = stream.get("codec_type", "")
        codec_name = stream.get("codec_name", "")
        if codec_type == "subtitle":
            return True
        # mov_text / ass / srt burned as text attachment
        if codec_type == "attachment" and codec_name in {"mov_text", "ass", "srt"}:
            return True
    return False


class RenderReviewService:
    """Runs post-render review and persists the result."""

    def __init__(self, session: Session):
        self.session = session

    # -- Core inspection ----------------------------------------------------

    def inspect(self, render_path: Path) -> RenderReviewResult:
        """Run the full review on ``render_path`` without persisting."""

        if not render_path.is_file():
            raise RenderReviewError(f"Render output not found: {render_path}")

        ffprobe_json = _run_ffprobe(render_path)
        duration = _format_duration(ffprobe_json)
        streams = _stream_types(ffprobe_json)
        findings: list[dict[str, Any]] = []

        # 1. Codec / stream presence checks.
        if "video" not in streams:
            findings.append({"code": "no_video_stream", "severity": "critical"})
        if "audio" not in streams:
            findings.append({"code": "no_audio_stream", "severity": "critical"})

        # 2. Black-frame sampling (only if there is a video stream).
        black_positions: list[float] = []
        sampled_stats: list[FrameStats] = []
        if "video" in streams and duration > 0:
            tmp_dir = render_path.parent / ".review_frames"
            tmp_dir.mkdir(parents=True, exist_ok=True)
            try:
                for ratio in _FRAME_SAMPLE_POSITIONS:
                    pos = round(duration * ratio, 2)
                    frame_path = _sample_frame(render_path, pos, tmp_dir)
                    if frame_path is None:
                        continue
                    stats = _analyze_frame(frame_path)
                    if stats is None:
                        continue
                    sampled_stats.append(FrameStats(
                        position_seconds=pos,
                        mean_luma=stats.mean_luma,
                        bright_ratio=stats.bright_ratio,
                    ))
                    is_black = (
                        stats.mean_luma < _BLACK_FRAME_LUMA_MAX
                        and stats.bright_ratio < _BLACK_FRAME_RATIO_MAX
                    )
                    if is_black:
                        black_positions.append(pos)
                    # Clean up sampled frame.
                    try:
                        frame_path.unlink()
                    except OSError:
                        pass
            finally:
                try:
                    tmp_dir.rmdir()
                except OSError:
                    pass
        if black_positions:
            findings.append(
                {
                    "code": "black_frames",
                    "severity": "critical",
                    "positions": black_positions,
                }
            )

        # 3. Silence detection (only if there is an audio stream).
        silence_ranges: list[dict[str, float]] = []
        if "audio" in streams:
            silence_ranges = _detect_silence(render_path)
            # Flag long continuous silence (>40% of duration) as critical.
            if duration > 0:
                total_silence = sum(r["end"] - r["start"] for r in silence_ranges)
                if total_silence / duration > 0.4:
                    findings.append(
                        {
                            "code": "excessive_silence",
                            "severity": "critical",
                            "ratio": round(total_silence / duration, 3),
                        }
                    )

        # 4. Subtitle stream presence (informational — dynamic comics may
        # burn subtitles into the video, so this is not a hard failure).
        subtitle_present = _has_subtitle_stream(ffprobe_json)
        if not subtitle_present:
            findings.append(
                {"code": "no_subtitle_stream", "severity": "info"}
            )

        overall_pass = not any(f.get("severity") == "critical" for f in findings)
        return RenderReviewResult(
            overall_pass=overall_pass,
            ffprobe_json=ffprobe_json,
            black_frame_positions=black_positions,
            silence_ranges=silence_ranges,
            subtitle_present=subtitle_present,
            findings=findings,
            sampled_stats=sampled_stats,
        )

    # -- Persistence --------------------------------------------------------

    def score_slideshow_risk(
        self,
        render_path: Path,
        episode_id: str | None = None,
        *,
        reuse_result: RenderReviewResult | None = None,
    ) -> SlideshowRiskResult:
        """Score how slideshow-like a render is (M2.4).

        When ``reuse_result`` is provided (a previous inspect() on the same
        file), reuses its sampled frame stats to avoid a second ffmpeg pass.
        Otherwise samples frames fresh.
        """
        if reuse_result is not None and reuse_result.sampled_stats:
            stats_list = list(reuse_result.sampled_stats)
            duration = _format_duration(reuse_result.ffprobe_json)
        else:
            ffprobe_json = _run_ffprobe(render_path)
            duration = _format_duration(ffprobe_json)
            stats_list: list[FrameStats] = []
            if duration > 0:
                tmp_dir = render_path.parent / ".review_frames"
                tmp_dir.mkdir(parents=True, exist_ok=True)
                try:
                    for ratio in _FRAME_SAMPLE_POSITIONS:
                        pos = round(duration * ratio, 2)
                        frame_path = _sample_frame(render_path, pos, tmp_dir)
                        if frame_path is None:
                            continue
                        stats = _analyze_frame(frame_path)
                        if stats is None:
                            continue
                        stats_list.append(FrameStats(
                            position_seconds=pos,
                            mean_luma=stats.mean_luma,
                            bright_ratio=stats.bright_ratio,
                        ))
                        try:
                            frame_path.unlink()
                        except OSError:
                            pass
                finally:
                    try:
                        tmp_dir.rmdir()
                    except OSError:
                        pass
        durations, motions = _shot_metadata_for_episode(self.session, episode_id)
        return score_slideshow_risk_from_frames(
            stats_list,
            duration_seconds=duration,
            shot_durations=durations,
            shot_camera_motions=motions,
        )

    def review_render(
        self,
        render_path: Path,
        episode_id: str,
        *,
        job_id: str | None = None,
    ) -> models.RenderReviewRecord:
        """Inspect the render and persist the review record."""

        result = self.inspect(render_path)
        # M2.4: compute slideshow risk from the same sampled frames.
        try:
            risk = self.score_slideshow_risk(
                render_path, episode_id=episode_id, reuse_result=result
            )
            slideshow_risk = {
                "score": risk.score,
                "level": risk.level,
                "dimensions": risk.dimensions,
                "triggered": risk.triggered,
            }
        except RenderReviewError:
            slideshow_risk = None
        record = models.RenderReviewRecord(
            episode_id=episode_id,
            job_id=job_id,
            render_path=str(render_path),
            ffprobe_json=result.ffprobe_json,
            black_frame_positions=result.black_frame_positions,
            silence_ranges=result.silence_ranges,
            subtitle_present=result.subtitle_present,
            overall_pass=result.overall_pass,
            findings=result.findings,
            slideshow_risk=slideshow_risk,
        )
        self.session.add(record)
        self.session.flush()
        return record

    def latest_for_episode(self, episode_id: str) -> models.RenderReviewRecord | None:
        return self.session.scalar(
            select(models.RenderReviewRecord)
            .where(models.RenderReviewRecord.episode_id == episode_id)
            .order_by(models.RenderReviewRecord.created_at.desc())
        )


def review_to_payload(record: models.RenderReviewRecord) -> dict[str, Any]:
    """Serialize a review record for API responses."""

    return {
        "id": record.id,
        "episode_id": record.episode_id,
        "job_id": record.job_id,
        "render_path": record.render_path,
        "overall_pass": record.overall_pass,
        "subtitle_present": record.subtitle_present,
        "black_frame_positions": record.black_frame_positions,
        "silence_ranges": record.silence_ranges,
        "ffprobe_json": record.ffprobe_json,
        "findings": record.findings,
        "slideshow_risk": record.slideshow_risk,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }
