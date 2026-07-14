from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from comic_studio import models, schemas


class SceneStructureReferenceError(ValueError):
    pass


class SceneStructureConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class StructureMutation:
    episode_id: str
    resource_id: str
    affected_shot_ids: tuple[str, ...]
    invalidated_stages: tuple[str, ...]


class SceneStructureService:
    PANEL_FIELDS = {
        "shot_type",
        "composition",
        "camera_motion",
        "character_state",
        "image_prompt",
        "negative_prompt",
    }
    VIDEO_FIELDS = PANEL_FIELDS | {
        "duration_seconds",
        "video_prompt",
        "negative_video_prompt",
    }

    def __init__(self, session: Session, data_root: Path | None = None):
        self.session = session
        self.data_root = data_root.resolve() if data_root is not None else None

    @staticmethod
    def _mutation(
        episode_id: str,
        resource_id: str,
        shots: list[models.Shot],
        stages: tuple[str, ...],
    ) -> StructureMutation:
        return StructureMutation(
            episode_id=episode_id,
            resource_id=resource_id,
            affected_shot_ids=tuple(shot.id for shot in shots),
            invalidated_stages=stages,
        )

    @staticmethod
    def _normalize_positions(items) -> None:
        for position, item in enumerate(items, start=1):
            item.position = position

    @staticmethod
    def _invalidate(shots: list[models.Shot], *, panels: bool, videos: bool) -> None:
        for shot in shots:
            if panels:
                shot.review_status = "draft"
                shot.render_status = "pending"
            if videos:
                shot.active_video_asset_id = None
                shot.video_render_status = "pending"

    def _validate_character_state(self, shot_or_scene, character_state: dict) -> None:
        project_id = (
            shot_or_scene.scene.episode.project_id
            if isinstance(shot_or_scene, models.Shot)
            else shot_or_scene.episode.project_id
        )
        for key in character_state:
            try:
                UUID(str(key))
            except (TypeError, ValueError):
                continue
            character = self.session.get(models.Character, key)
            if character is None or character.project_id != project_id:
                raise SceneStructureReferenceError(
                    "Character state references must belong to the episode project"
                )

    def _ensure_mutable(self, episode_id: str) -> None:
        active = self.session.scalar(
            select(models.ProductionRun.id).where(
                models.ProductionRun.episode_id == episode_id,
                models.ProductionRun.status.in_({"queued", "running", "paused"}),
            ).limit(1)
        )
        if active is not None:
            raise SceneStructureConflictError(
                "Cannot edit scene structure while production is active"
            )

    def create_scene(self, episode_id: str, data: schemas.SceneCreate):
        episode = self.session.get(models.Episode, episode_id)
        if episode is None:
            return None
        self._ensure_mutable(episode.id)
        position = (
            self.session.scalar(
                select(func.max(models.Scene.position)).where(
                    models.Scene.episode_id == episode.id
                )
            )
            or 0
        ) + 1
        scene = models.Scene(
            episode_id=episode.id, position=position, **data.model_dump()
        )
        self.session.add(scene)
        self.session.commit()
        return self._mutation(episode.id, scene.id, [], ())

    def update_scene(self, scene_id: str, data: schemas.ScenePatch):
        scene = self.session.get(models.Scene, scene_id)
        if scene is None:
            return None
        self._ensure_mutable(scene.episode_id)
        changed = data.model_dump(exclude_unset=True)
        for field, value in changed.items():
            setattr(scene, field, value)
        affected = list(scene.shots) if set(changed) - {"estimated_duration_seconds"} else []
        self._invalidate(affected, panels=True, videos=True)
        self.session.commit()
        stages = ("panels", "videos") if affected else ()
        return self._mutation(scene.episode_id, scene.id, affected, stages)

    def create_shot(self, scene_id: str, data: schemas.ShotCreate):
        scene = self.session.get(models.Scene, scene_id)
        if scene is None:
            return None
        self._ensure_mutable(scene.episode_id)
        self._validate_character_state(scene, data.character_state)
        position = (
            self.session.scalar(
                select(func.max(models.Shot.position)).where(
                    models.Shot.scene_id == scene.id
                )
            )
            or 0
        ) + 1
        shot = models.Shot(scene_id=scene.id, position=position, **data.model_dump())
        self.session.add(shot)
        self.session.commit()
        return self._mutation(
            scene.episode_id, shot.id, [shot], ("panels", "videos")
        )

    def update_shot(self, shot_id: str, data: schemas.ShotPatch):
        shot = self.session.get(models.Shot, shot_id)
        if shot is None:
            return None
        changed = data.model_dump(exclude_unset=True)
        if set(changed) & self.VIDEO_FIELDS:
            self._ensure_mutable(shot.scene.episode_id)
        if "character_state" in changed:
            self._validate_character_state(shot, changed["character_state"])
        for field, value in changed.items():
            setattr(shot, field, value)
        panels = bool(set(changed) & self.PANEL_FIELDS)
        videos = bool(set(changed) & self.VIDEO_FIELDS)
        self._invalidate([shot], panels=panels, videos=videos)
        self.session.commit()
        self.session.refresh(shot)
        return shot

    def reorder_scenes(self, episode_id: str, ids: list[str]):
        episode = self.session.get(models.Episode, episode_id)
        if episode is None:
            return None
        self._ensure_mutable(episode.id)
        scenes = list(
            self.session.scalars(
                select(models.Scene)
                .where(models.Scene.episode_id == episode.id)
                .order_by(models.Scene.position)
            )
        )
        by_id = {scene.id: scene for scene in scenes}
        if len(ids) != len(scenes) or len(set(ids)) != len(ids) or set(ids) != set(by_id):
            raise SceneStructureReferenceError(
                "Scene order must contain every scene in the episode exactly once"
            )
        ordered = [by_id[item_id] for item_id in ids]
        self._normalize_positions(ordered)
        affected = [shot for scene in ordered for shot in scene.shots]
        for shot in affected:
            shot.previous_shot_tail_asset_id = None
        self._invalidate(affected, panels=True, videos=True)
        self.session.commit()
        return self._mutation(
            episode.id, episode.id, affected, ("panels", "videos")
        )

    def reorder_shots(self, scene_id: str, ids: list[str]):
        scene = self.session.get(models.Scene, scene_id)
        if scene is None:
            return None
        self._ensure_mutable(scene.episode_id)
        shots = list(
            self.session.scalars(
                select(models.Shot)
                .where(models.Shot.scene_id == scene.id)
                .order_by(models.Shot.position)
            )
        )
        by_id = {shot.id: shot for shot in shots}
        if len(ids) != len(shots) or len(set(ids)) != len(ids) or set(ids) != set(by_id):
            raise SceneStructureReferenceError(
                "Shot order must contain every shot in the scene exactly once"
            )
        ordered = [by_id[item_id] for item_id in ids]
        self._normalize_positions(ordered)
        for shot in ordered:
            shot.previous_shot_tail_asset_id = None
        self._invalidate(ordered, panels=True, videos=True)
        self.session.commit()
        return self._mutation(
            scene.episode_id, scene.id, ordered, ("panels", "videos")
        )

    def _assets_for_shots(self, shots: list[models.Shot]) -> list[models.Asset]:
        kinds = {
            *(f"panel:{shot.id}" for shot in shots),
            *(f"video:{shot.id}" for shot in shots),
            *(
                f"dialogue:{line.id}"
                for shot in shots
                for line in shot.dialogue
            ),
        }
        return list(
            self.session.scalars(select(models.Asset).where(models.Asset.kind.in_(kinds)))
        ) if kinds else []

    def _remove_asset_files(self, assets: list[models.Asset]) -> None:
        if self.data_root is None:
            return
        for asset in assets:
            path = (self.data_root / asset.local_path).resolve()
            if self.data_root in path.parents:
                path.unlink(missing_ok=True)

    def delete_shot(self, shot_id: str):
        shot = self.session.get(models.Shot, shot_id)
        if shot is None:
            return None
        scene = shot.scene
        episode_id = scene.episode_id
        self._ensure_mutable(episode_id)
        assets = self._assets_for_shots([shot])
        self.session.delete(shot)
        self.session.flush()
        remaining = list(
            self.session.scalars(
                select(models.Shot)
                .where(models.Shot.scene_id == scene.id)
                .order_by(models.Shot.position)
            )
        )
        self._normalize_positions(remaining)
        for item in remaining:
            item.previous_shot_tail_asset_id = None
        self._invalidate(remaining, panels=True, videos=True)
        for asset in assets:
            self.session.delete(asset)
        self.session.commit()
        self._remove_asset_files(assets)
        return self._mutation(
            episode_id, shot_id, remaining, ("panels", "videos") if remaining else ()
        )

    def delete_scene(self, scene_id: str):
        scene = self.session.get(models.Scene, scene_id)
        if scene is None:
            return None
        episode = scene.episode
        self._ensure_mutable(episode.id)
        deleted_shots = list(scene.shots)
        assets = self._assets_for_shots(deleted_shots)
        self.session.delete(scene)
        self.session.flush()
        remaining_scenes = list(
            self.session.scalars(
                select(models.Scene)
                .where(models.Scene.episode_id == episode.id)
                .order_by(models.Scene.position)
            )
        )
        self._normalize_positions(remaining_scenes)
        affected = [shot for item in remaining_scenes for shot in item.shots]
        for shot in affected:
            shot.previous_shot_tail_asset_id = None
        self._invalidate(affected, panels=True, videos=True)
        for asset in assets:
            self.session.delete(asset)
        self.session.commit()
        self._remove_asset_files(assets)
        return self._mutation(
            episode.id,
            scene_id,
            affected,
            ("panels", "videos") if affected else (),
        )
