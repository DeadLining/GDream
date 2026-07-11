from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models


@dataclass(frozen=True)
class EpisodeDeletionImpact:
    episode_id: str
    title: str
    scenes: int
    shots: int
    dialogue_lines: int
    assets: int
    shot_ids: tuple[str, ...]
    dialogue_ids: tuple[str, ...]
    asset_ids: tuple[str, ...]
    local_paths: tuple[str, ...]


class EpisodeDeletionService:
    def __init__(self, session: Session, data_root: Path):
        self.session = session
        self.data_root = data_root.resolve()

    def preview(self, episode_id: str) -> EpisodeDeletionImpact | None:
        episode = self.session.scalar(
            select(models.Episode)
            .options(
                selectinload(models.Episode.scenes)
                .selectinload(models.Scene.shots)
                .selectinload(models.Shot.dialogue)
            )
            .where(models.Episode.id == episode_id)
        )
        if episode is None:
            return None

        shots = [shot for scene in episode.scenes for shot in scene.shots]
        dialogue = [line for shot in shots for line in shot.dialogue]
        shot_ids = tuple(shot.id for shot in shots)
        dialogue_ids = tuple(line.id for line in dialogue)
        asset_kinds = {
            *(f"panel:{shot_id}" for shot_id in shot_ids),
            *(f"video:{shot_id}" for shot_id in shot_ids),
            *(f"dialogue:{dialogue_id}" for dialogue_id in dialogue_ids),
        }
        assets = (
            list(
                self.session.scalars(
                    select(models.Asset).where(models.Asset.kind.in_(asset_kinds))
                )
            )
            if asset_kinds
            else []
        )
        return EpisodeDeletionImpact(
            episode_id=episode.id,
            title=episode.title,
            scenes=len(episode.scenes),
            shots=len(shots),
            dialogue_lines=len(dialogue),
            assets=len(assets),
            shot_ids=shot_ids,
            dialogue_ids=dialogue_ids,
            asset_ids=tuple(asset.id for asset in assets),
            local_paths=tuple(asset.local_path for asset in assets if asset.local_path),
        )
