import json
import subprocess
from pathlib import Path

from comic_studio import models
from comic_studio.services.rendering import RenderingService
from comic_studio.services.shot_inputs import ShotInputCompiler


def seed_episode(session, data_root: Path):
    project = models.Project(
        title="霓虹夜行",
        logline="侦探寻找记忆",
        story_bible="近未来重庆",
        visual_style="Chinese noir",
        aspect_ratio="9:16",
    )
    episode = models.Episode(
        project=project, title="雨夜", premise="寻找芯片", target_duration_seconds=60
    )
    scene = models.Scene(
        episode=episode,
        position=1,
        location="巷道",
        summary="发现线索",
        estimated_duration_seconds=5,
    )
    shot = models.Shot(
        scene=scene,
        position=1,
        shot_type="close_up",
        duration_seconds=5,
        composition="芯片特写",
        camera_motion="push_in",
        review_status="approved",
    )
    session.add(project)
    session.flush()
    panel = models.Asset(
        project_id=project.id,
        kind="panel",
        local_path="projects/panel.png",
        media_type="image/png",
        provider="test",
        model="test",
        checksum="0" * 64,
        review_status="approved",
    )
    session.add_all([shot, panel])
    session.flush()
    shot.active_panel_asset_id = panel.id
    compiled = ShotInputCompiler(session).compile(
        shot.id, usage_kinds={"panel", "reference"}
    )
    panel.request_metadata = {
        "input_snapshot": compiled.snapshot,
        "input_snapshot_hash": compiled.snapshot_hash,
    }
    session.commit()
    panel_path = data_root / panel.local_path
    panel_path.parent.mkdir(parents=True)
    panel_path.write_bytes(b"png")
    return episode


def test_render_manifest_uses_only_active_approved_assets(db_session, tmp_path):
    episode = seed_episode(db_session, tmp_path)

    manifest = RenderingService(db_session, tmp_path, tmp_path).build_manifest(
        episode.id
    )

    assert manifest["episode"]["width"] == 1080
    assert manifest["episode"]["height"] == 1920
    assert manifest["shots"][0]["reviewStatus"] == "approved"
    assert manifest["shots"][0]["panelPath"].endswith("projects/panel.png")


def test_render_manifest_rejects_unapproved_shot(db_session, tmp_path):
    episode = seed_episode(db_session, tmp_path)
    episode.scenes[0].shots[0].review_status = "draft"
    db_session.commit()

    service = RenderingService(db_session, tmp_path, tmp_path)
    try:
        service.build_manifest(episode.id)
    except ValueError as exc:
        assert "not approved" in str(exc)
    else:
        raise AssertionError("Expected unapproved shot to block rendering")


def test_render_manifest_rejects_stale_active_panel(db_session, tmp_path):
    episode = seed_episode(db_session, tmp_path)
    episode.scenes[0].shots[0].image_prompt = "changed after panel generation"
    db_session.commit()

    service = RenderingService(db_session, tmp_path, tmp_path)
    try:
        service.build_manifest(episode.id)
    except ValueError as exc:
        assert "panel is stale" in str(exc)
    else:
        raise AssertionError("Expected stale panel to block rendering")


def test_render_manifest_includes_active_video_and_keeps_panel_fallback(db_session,tmp_path):
    episode=seed_episode(db_session,tmp_path); shot=episode.scenes[0].shots[0]
    video=models.Asset(project_id=episode.project_id,kind=f"video:{shot.id}",local_path="projects/shot.mp4",media_type="video/mp4",provider="test",model="video",checksum="2"*64,duration_seconds=5)
    db_session.add(video); db_session.flush(); shot.active_video_asset_id=video.id; db_session.commit(); (tmp_path/video.local_path).write_bytes(b'\x00\x00\x00\x18ftypmp42video')
    manifest=RenderingService(db_session,tmp_path,tmp_path).build_manifest(episode.id)
    assert manifest['shots'][0]['videoPath'].endswith('projects/shot.mp4')
    assert manifest['shots'][0]['panelPath'].endswith('projects/panel.png')


def test_render_manifest_includes_bound_scene_sound(db_session, tmp_path):
    episode = seed_episode(db_session, tmp_path)
    scene = episode.scenes[0]
    sound_file = tmp_path / "projects" / "rain.wav"
    sound_file.write_bytes(b"RIFF\x00\x00\x00\x00WAVE")
    media = models.Asset(
        project_id=episode.project_id,
        kind="library-asset-media",
        local_path="projects/rain.wav",
        media_type="audio/wav",
        provider="upload",
        model="local",
        checksum="e" * 64,
    )
    db_session.add(media)
    db_session.flush()
    sound = models.LibraryAsset(
        project_id=episode.project_id,
        kind="sound",
        name="城市雨声",
        description="环境底噪",
        tags=["环境"],
        asset_metadata={"volume": 0.25},
        media_asset_id=media.id,
    )
    db_session.add(sound)
    db_session.flush()
    db_session.add(
        models.LibraryAssetSceneBinding(
            library_asset_id=sound.id, scene_id=scene.id
        )
    )
    db_session.commit()

    manifest = RenderingService(db_session, tmp_path, tmp_path).build_manifest(episode.id)

    assert manifest["shots"][0]["sounds"] == [
        {
            "id": sound.id,
            "name": "城市雨声",
            "audioPath": str(sound_file),
            "volume": 0.25,
        }
    ]


def test_render_subtitles_use_absolute_episode_timeline():
    manifest = {
        "shots": [
            {
                "durationSeconds": 5,
                "dialogue": [
                    {
                        "text": "第一行\r\n第二行",
                        "startSeconds": 1,
                        "durationSeconds": 2,
                    }
                ],
            },
            {
                "durationSeconds": 3,
                "dialogue": [
                    {
                        "text": "下一镜头",
                        "startSeconds": 0.5,
                        "durationSeconds": 1,
                    }
                ],
            },
        ]
    }

    subtitles = RenderingService.build_srt(manifest)

    assert "00:00:01,000 --> 00:00:03,000" in subtitles
    assert "第一行\n第二行" in subtitles
    assert "00:00:05,500 --> 00:00:06,500" in subtitles


def test_render_subtitles_skip_empty_text():
    manifest = {
        "shots": [
            {
                "durationSeconds": 2,
                "dialogue": [
                    {"text": "  ", "startSeconds": 0, "durationSeconds": 1}
                ],
            }
        ]
    }

    assert RenderingService.build_srt(manifest) == ""


def test_render_muxes_independent_mov_text_subtitle(db_session, tmp_path, monkeypatch):
    episode = seed_episode(db_session, tmp_path)
    shot = episode.scenes[0].shots[0]
    line = models.DialogueLine(
        shot=shot,
        character_id=None,
        position=1,
        text="雨还没有停。",
        subtitle_text="雨还没有停。",
        emotion="calm",
        performance_instruction="",
        start_seconds=0.5,
        duration_seconds=1.5,
    )
    db_session.add(line)
    db_session.commit()
    commands = []

    def fake_run(command, **kwargs):
        commands.append(command)
        if command[0] == "node":
            Path(command[-1]).write_bytes(b"\x00\x00\x00\x18ftypmp42video")
        elif command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"\x00\x00\x00\x18ftypmp42subtitled")
        elif command[0] == "ffprobe":
            has_subtitle = any(item[0] == "ffmpeg" for item in commands)
            streams = [{"codec_type": "video", "codec_name": "h264"}]
            if has_subtitle:
                streams.append({"codec_type": "subtitle", "codec_name": "mov_text"})
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps({"streams": streams, "format": {"duration": "5"}}),
            )
        return subprocess.CompletedProcess(command, 0, stdout="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    output = tmp_path / "episode.mp4"

    report = RenderingService(db_session, tmp_path, tmp_path).render(
        episode.id,
        output,
    )

    ffmpeg_command = next(command for command in commands if command[0] == "ffmpeg")
    assert "mov_text" in ffmpeg_command
    assert any(stream["codec_type"] == "subtitle" for stream in report["streams"])
    assert output.read_bytes().endswith(b"subtitled")
