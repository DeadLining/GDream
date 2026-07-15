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
            continuity_rules="服装和发型保持一致",
        )
        episode = models.Episode(
            project=project,
            title="第一集",
            premise="发现线索",
            target_duration_seconds=30,
        )
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
        session.add_all([character, shot])
        session.commit()
        return session_factory, data_root, episode.id, character.id, shot.id


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
    session_factory, data_root, episode_id, character_id, shot_id = _seed_episode(tmp_path)
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
    session_factory, data_root, episode_id, _character_id, shot_id = _seed_episode(tmp_path)
    handlers = EpisodeAIStageHandlers(
        session_factory,
        data_root,
        FakeImageRuntime(session_factory, data_root),
    )

    with pytest.raises(EpisodeAIStageNeedsReview, match=shot_id):
        asyncio.run(handlers.panel_review(_context(episode_id, "panel_review")))
