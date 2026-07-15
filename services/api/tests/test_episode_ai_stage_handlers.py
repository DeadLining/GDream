import asyncio
from io import BytesIO

import pytest
from PIL import Image

from comic_studio import models
from comic_studio.db import create_session_factory, create_tables
from comic_studio.services.episode_ai_orchestrator import (
    EpisodeAIStageContext,
    EpisodeAIStageNeedsReview,
)
from comic_studio.services.episode_ai_stage_handlers import EpisodeAIStageHandlers


def _png_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (64, 96), "#3d7eff").save(output, format="PNG")
    return output.getvalue()


def _seed_episode(tmp_path):
    data_root = tmp_path / "data"
    session_factory = create_session_factory(f"sqlite:///{tmp_path / 'handlers.db'}")
    create_tables(session_factory)
    with session_factory() as session:
        project = models.Project(
            title="阶段处理器",
            logline="自动生成",
            story_bible="连续",
            visual_style="comic",
            aspect_ratio="9:16",
            language="Chinese",
        )
        character = models.Character(
            project=project,
            name="林夏",
            role="侦探",
            appearance_bible="黑色短发，蓝色风衣",
            personality="冷静敏锐",
            continuity_rules="服装和发型保持一致",
            voice_speaker="Chelsie",
        )
        episode = models.Episode(
            project=project,
            title="第一集",
            premise="发现线索",
            target_duration_seconds=30,
        )
        session.add_all([project, character, episode])
        session.flush()
        scene = models.Scene(
            episode=episode,
            position=1,
            location="旧车站",
            summary="林夏发现遗落的信封",
        )
        shot = models.Shot(
            scene=scene,
            position=1,
            shot_type="medium",
            duration_seconds=6,
            composition="林夏站在站台中央",
            camera_motion="push_in",
            character_state={character.id: "alert"},
            image_prompt="cinematic station platform",
            negative_prompt="text, watermark",
        )
        session.add(shot)
        session.flush()
        dialogue = models.DialogueLine(
            shot=shot,
            character_id=character.id,
            position=1,
            text="这里有人来过。",
            subtitle_text="这里有人来过。",
            emotion="alert",
            performance_instruction="压低声音",
        )
        session.add(dialogue)
        session.commit()
        return session_factory, data_root, episode.id, character.id, shot.id, dialogue.id


class FakeImageRuntime:
    def __init__(self, session_factory, data_root):
        self.session_factory = session_factory
        self.data_root = data_root
        self.calls = []

    async def execute_image(self, target_type, target_id, payload):
        self.calls.append((target_type, target_id, payload))
        content = _png_bytes()
        with self.session_factory() as session:
            if target_type == "character":
                character = session.get(models.Character, target_id)
                relative = f"projects/{character.project_id}/characters/{target_id}/primary.png"
                asset = models.Asset(
                    project_id=character.project_id,
                    kind=f"character-reference:{target_id}:primary",
                    local_path=relative,
                    media_type="image/png",
                    provider="gpt-image",
                    model="gpt-image-1",
                    request_metadata={"prompt": "character reference"},
                    checksum="character-checksum",
                    width=64,
                    height=96,
                )
                session.add(asset)
                session.flush()
                reference = models.CharacterReference(
                    character_id=target_id,
                    asset_id=asset.id,
                    reference_type="primary",
                    label=payload["label"],
                )
                session.add(reference)
                self._write(relative, content)
                session.commit()
                return reference, asset

            shot = session.get(models.Shot, target_id)
            relative = f"projects/{shot.scene.episode.project_id}/shots/{target_id}/panel.png"
            asset = models.Asset(
                project_id=shot.scene.episode.project_id,
                kind=f"panel:{target_id}",
                local_path=relative,
                media_type="image/png",
                provider="gpt-image",
                model="gpt-image-1",
                request_metadata={"prompt": "shot panel"},
                checksum="panel-checksum",
                width=64,
                height=96,
            )
            session.add(asset)
            session.flush()
            shot.active_panel_asset_id = asset.id
            self._write(relative, content)
            session.commit()
            return asset

    async def execute_speech(self, dialogue_id):
        self.calls.append(("speech", dialogue_id, {}))
        with self.session_factory() as session:
            line = session.get(models.DialogueLine, dialogue_id)
            project_id = line.shot.scene.episode.project_id
            relative = f"projects/{project_id}/audio/{dialogue_id}/speech.wav"
            asset = models.Asset(
                project_id=project_id,
                kind=f"dialogue:{dialogue_id}",
                local_path=relative,
                media_type="audio/wav",
                provider="qwen3-tts",
                model="Qwen3-TTS",
                request_metadata={"text": line.text, "speaker": "Chelsie"},
                checksum="speech-checksum",
                duration_seconds=1.25,
            )
            session.add(asset)
            session.flush()
            line.audio_asset_id = asset.id
            line.duration_seconds = 1.25
            self._write(relative, b"RIFF" + b"\x00" * 128)
            session.commit()
            return asset

    async def execute_video(self, shot_id, activate):
        self.calls.append(("video", shot_id, {"activate": activate}))
        with self.session_factory() as session:
            shot = session.get(models.Shot, shot_id)
            project_id = shot.scene.episode.project_id
            relative = f"projects/{project_id}/videos/{shot_id}/video.mp4"
            asset = models.Asset(
                project_id=project_id,
                kind=f"video:{shot_id}",
                local_path=relative,
                media_type="video/mp4",
                provider="wan-local",
                model="Wan2.2-TI2V-5B",
                request_metadata={
                    "prompt": shot.video_prompt,
                    "source_panel_id": shot.active_panel_asset_id,
                },
                parent_asset_id=shot.active_panel_asset_id,
                checksum="video-checksum",
                duration_seconds=6,
            )
            session.add(asset)
            session.flush()
            shot.active_video_asset_id = asset.id
            shot.video_render_status = "completed"
            self._write(relative, b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 128)
            session.commit()
            return asset

    def _write(self, relative, content):
        destination = self.data_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)


def _context(episode_id: str, stage: str) -> EpisodeAIStageContext:
    return EpisodeAIStageContext(
        run_id="run-1",
        episode_id=episode_id,
        stage=stage,
        automation_policy={"approval_mode": "ai_default"},
    )


def test_image_handlers_generate_validate_and_approve_episode_assets(tmp_path):
    session_factory, data_root, episode_id, character_id, shot_id, _dialogue_id = (
        _seed_episode(tmp_path)
    )
    runtime = FakeImageRuntime(session_factory, data_root)
    handlers = EpisodeAIStageHandlers(session_factory, data_root, runtime)

    references = asyncio.run(handlers.references(_context(episode_id, "references")))
    panels = asyncio.run(handlers.panels(_context(episode_id, "panels")))
    review = asyncio.run(handlers.panel_review(_context(episode_id, "panel_review")))

    assert references["character_ids"] == [character_id]
    assert len(references["reference_ids"]) == 1
    assert panels["shot_ids"] == [shot_id]
    assert len(panels["asset_ids"]) == 1
    assert review == {"approved_shot_ids": [shot_id]}
    assert [call[0] for call in runtime.calls] == ["character", "shot"]
    with session_factory() as session:
        reference = session.get(models.CharacterReference, references["reference_ids"][0])
        shot = session.get(models.Shot, shot_id)
        panel = session.get(models.Asset, shot.active_panel_asset_id)
        assert reference.review_status == "approved"
        assert reference.is_active is True
        assert shot.review_status == "approved"
        assert panel.review_status == "approved"
        assert "保持角色外观" in shot.video_prompt
        assert "闪烁" in shot.negative_video_prompt


def test_panel_review_blocks_missing_active_panel(tmp_path):
    session_factory, data_root, episode_id, _character_id, shot_id, _dialogue_id = (
        _seed_episode(tmp_path)
    )
    handlers = EpisodeAIStageHandlers(
        session_factory,
        data_root,
        FakeImageRuntime(session_factory, data_root),
    )

    with pytest.raises(EpisodeAIStageNeedsReview, match=shot_id):
        asyncio.run(handlers.panel_review(_context(episode_id, "panel_review")))


def test_media_handlers_generate_all_dialogue_and_shot_outputs(tmp_path):
    session_factory, data_root, episode_id, _character_id, shot_id, dialogue_id = (
        _seed_episode(tmp_path)
    )
    runtime = FakeImageRuntime(session_factory, data_root)
    handlers = EpisodeAIStageHandlers(session_factory, data_root, runtime)
    asyncio.run(handlers.references(_context(episode_id, "references")))
    asyncio.run(handlers.panels(_context(episode_id, "panels")))
    asyncio.run(handlers.panel_review(_context(episode_id, "panel_review")))

    speech = asyncio.run(handlers.speech(_context(episode_id, "speech")))
    videos = asyncio.run(handlers.videos(_context(episode_id, "videos")))

    assert speech["dialogue_ids"] == [dialogue_id]
    assert len(speech["asset_ids"]) == 1
    assert videos["shot_ids"] == [shot_id]
    assert len(videos["asset_ids"]) == 1
    with session_factory() as session:
        line = session.get(models.DialogueLine, dialogue_id)
        shot = session.get(models.Shot, shot_id)
        assert line.audio_asset_id == speech["asset_ids"][0]
        assert line.duration_seconds == 1.25
        assert shot.active_video_asset_id == videos["asset_ids"][0]
        assert shot.video_render_status == "completed"


def test_release_handlers_render_review_gate_and_publish_internal_master(tmp_path):
    session_factory, data_root, episode_id, _character_id, _shot_id, _dialogue_id = (
        _seed_episode(tmp_path)
    )
    runtime = FakeImageRuntime(session_factory, data_root)

    def render_executor(_episode_id, output_path):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 256)
        return {"format": {"duration": "6.0"}}

    def review_executor(session, render_path, reviewed_episode_id, job_id):
        record = models.RenderReviewRecord(
            episode_id=reviewed_episode_id,
            job_id=job_id,
            render_path=str(render_path),
            ffprobe_json={"format": {"duration": "6.0"}},
            black_frame_positions=[],
            silence_ranges=[],
            subtitle_present=True,
            overall_pass=True,
            findings=[],
        )
        session.add(record)
        session.flush()
        return record

    handlers = EpisodeAIStageHandlers(
        session_factory,
        data_root,
        runtime,
        compositor_root=tmp_path / "compositor",
        render_executor=render_executor,
        review_executor=review_executor,
    )
    for stage in ("references", "panels", "panel_review", "speech", "videos"):
        asyncio.run(getattr(handlers, stage)(_context(episode_id, stage)))

    rendered = asyncio.run(handlers.rendering(_context(episode_id, "rendering")))
    reviewed = asyncio.run(
        handlers.quality_review(_context(episode_id, "quality_review"))
    )
    candidate = asyncio.run(
        handlers.release_candidate(_context(episode_id, "release_candidate"))
    )
    gate = asyncio.run(handlers.release_gate(_context(episode_id, "release_gate")))
    published = asyncio.run(handlers.published(_context(episode_id, "published")))

    assert rendered["job_id"] == reviewed["job_id"]
    assert rendered["output_path"].endswith(".mp4")
    assert reviewed["overall_pass"] is True
    assert candidate["candidate_id"] == gate["candidate_id"]
    assert gate["ready"] is True
    assert published["status"] == "published"
    assert published["platform"] == "internal_master"
    with session_factory() as session:
        stored_candidate = session.get(models.ReleaseCandidate, candidate["candidate_id"])
        publication = session.get(models.PublicationRecord, published["publication_id"])
        assert stored_candidate.status == "published"
        assert publication.candidate_id == stored_candidate.id
