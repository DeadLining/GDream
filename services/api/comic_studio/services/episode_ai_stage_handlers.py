from pathlib import Path

from PIL import Image, UnidentifiedImageError
from sqlalchemy import select

from comic_studio import models
from comic_studio.repositories import EpisodeRepository
from comic_studio.services.character_references import CharacterReferenceService
from comic_studio.services.episode_ai_orchestrator import (
    EpisodeAIStageContext,
    EpisodeAIStageNeedsReview,
)


class EpisodeAIStageHandlers:
    def __init__(self, session_factory, data_root: Path, model_runtime):
        self.session_factory = session_factory
        self.data_root = data_root.resolve()
        self.model_runtime = model_runtime

    def mapping(self):
        return {
            "references": self.references,
            "panels": self.panels,
            "panel_review": self.panel_review,
        }

    def _episode_targets(self, episode_id: str):
        with self.session_factory() as session:
            episode = EpisodeRepository(session).get(episode_id)
            if episode is None:
                raise KeyError(episode_id)
            characters = list(
                session.scalars(
                    select(models.Character)
                    .where(models.Character.project_id == episode.project_id)
                    .order_by(models.Character.created_at, models.Character.id)
                )
            )
            shots = sorted(
                (shot for scene in episode.scenes for shot in scene.shots),
                key=lambda shot: (shot.scene.position, shot.position, shot.id),
            )
            return [item.id for item in characters], [item.id for item in shots]

    def _image_asset(self, asset_id: str, label: str) -> models.Asset:
        with self.session_factory() as session:
            asset = session.get(models.Asset, asset_id)
            if asset is None:
                raise EpisodeAIStageNeedsReview(f"{label} asset is missing: {asset_id}")
            if not asset.provider or not asset.model or not asset.request_metadata.get("prompt"):
                raise EpisodeAIStageNeedsReview(
                    f"{label} generation metadata is incomplete: {asset_id}"
                )
            path = (self.data_root / asset.local_path).resolve()
            if self.data_root not in path.parents or not path.is_file():
                raise EpisodeAIStageNeedsReview(f"{label} media is missing: {asset_id}")
            try:
                with Image.open(path) as image:
                    image.verify()
                with Image.open(path) as image:
                    width, height = image.size
            except (UnidentifiedImageError, OSError, ValueError) as exc:
                raise EpisodeAIStageNeedsReview(
                    f"{label} media is invalid: {asset_id}"
                ) from exc
            if width <= 0 or height <= 0:
                raise EpisodeAIStageNeedsReview(f"{label} dimensions are invalid: {asset_id}")
            session.expunge(asset)
            return asset

    async def references(self, context: EpisodeAIStageContext) -> dict:
        character_ids, _shot_ids = self._episode_targets(context.episode_id)
        reference_ids = []
        asset_ids = []
        for character_id in character_ids:
            with self.session_factory() as session:
                reference = session.scalar(
                    select(models.CharacterReference)
                    .where(
                        models.CharacterReference.character_id == character_id,
                        models.CharacterReference.reference_type.in_({"primary", "front"}),
                        models.CharacterReference.is_active.is_(True),
                        models.CharacterReference.review_status == "approved",
                    )
                    .order_by(models.CharacterReference.created_at.desc())
                )
                existing = (
                    (reference.id, reference.asset_id) if reference is not None else None
                )
            if existing is None:
                reference, asset = await self.model_runtime.execute_image(
                    "character",
                    character_id,
                    {"reference_type": "primary", "label": "AI 主参考"},
                )
                reference_id, asset_id = reference.id, asset.id
            else:
                reference_id, asset_id = existing
            self._image_asset(asset_id, "Character reference")
            with self.session_factory() as session:
                CharacterReferenceService(
                    session, self.data_root
                ).approve_and_activate(character_id, reference_id)
            reference_ids.append(reference_id)
            asset_ids.append(asset_id)
        return {
            "character_ids": character_ids,
            "reference_ids": reference_ids,
            "asset_ids": asset_ids,
        }

    async def panels(self, context: EpisodeAIStageContext) -> dict:
        _character_ids, shot_ids = self._episode_targets(context.episode_id)
        if not shot_ids:
            raise EpisodeAIStageNeedsReview("Episode has no shots")
        asset_ids = []
        for shot_id in shot_ids:
            with self.session_factory() as session:
                shot = session.get(models.Shot, shot_id)
                asset_id = shot.active_panel_asset_id
            if asset_id is None:
                asset = await self.model_runtime.execute_image(
                    "shot", shot_id, {"activate": True}
                )
                asset_id = asset.id
            self._image_asset(asset_id, "Shot panel")
            asset_ids.append(asset_id)
        return {"shot_ids": shot_ids, "asset_ids": asset_ids}

    async def panel_review(self, context: EpisodeAIStageContext) -> dict:
        _character_ids, shot_ids = self._episode_targets(context.episode_id)
        approved = []
        with self.session_factory() as session:
            for shot_id in shot_ids:
                shot = session.get(models.Shot, shot_id)
                if shot.active_panel_asset_id is None:
                    raise EpisodeAIStageNeedsReview(
                        f"Shot has no active panel: {shot_id}"
                    )
                self._image_asset(shot.active_panel_asset_id, "Shot panel")
                asset = session.get(models.Asset, shot.active_panel_asset_id)
                asset.review_status = "approved"
                shot.review_status = "approved"
                if not shot.video_prompt.strip():
                    shot.video_prompt = (
                        f"{shot.composition}。保持角色外观、场景空间、光线方向和首帧构图稳定，"
                        "动作自然连续。"
                    )
                if not shot.negative_video_prompt.strip():
                    shot.negative_video_prompt = (
                        "闪烁、变形、额外肢体、镜头抖动、角色换脸、字幕、水印"
                    )
                approved.append(shot_id)
            session.commit()
        return {"approved_shot_ids": approved}
