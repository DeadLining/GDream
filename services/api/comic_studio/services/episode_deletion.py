from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from sqlalchemy import and_, delete, or_, select
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
    cleanup_warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class EpisodeDeletionResult:
    impact: EpisodeDeletionImpact
    cleanup_warnings: tuple[str, ...]


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
        render_paths: list[str] = []
        cleanup_warnings: list[str] = []
        render_jobs = self.session.scalars(
            select(models.Job).where(
                models.Job.operation == "render_episode",
                models.Job.target_type == "episode",
                models.Job.target_id == episode.id,
            )
        )
        expected_prefix = (
            "projects",
            episode.project_id,
            "episodes",
            episode.id,
            "renders",
        )
        for job in render_jobs:
            output_path = job.result_metadata.get("output_path")
            if not isinstance(output_path, str):
                continue
            relative = PurePosixPath(output_path)
            if relative.is_absolute() or relative.parts[:5] != expected_prefix:
                if "Skipped unsafe media path" not in cleanup_warnings:
                    cleanup_warnings.append("Skipped unsafe media path")
                continue
            render_paths.extend(
                [str(relative), str(relative.with_suffix(".manifest.json"))]
            )
        delivery_paths: list[str] = []
        delivery_packages = self.session.scalars(
            select(models.DeliveryPackage).where(
                models.DeliveryPackage.episode_id == episode.id
            )
        )
        expected_delivery_prefix = (
            "projects",
            episode.project_id,
            "episodes",
            episode.id,
            "delivery",
        )
        for package in delivery_packages:
            if not package.artifact_path:
                continue
            relative = PurePosixPath(package.artifact_path)
            if (
                relative.is_absolute()
                or relative.parts[:5] != expected_delivery_prefix
            ):
                if "Skipped unsafe media path" not in cleanup_warnings:
                    cleanup_warnings.append("Skipped unsafe media path")
                continue
            delivery_paths.append(str(relative))
        return EpisodeDeletionImpact(
            episode_id=episode.id,
            title=episode.title,
            scenes=len(episode.scenes),
            shots=len(shots),
            dialogue_lines=len(dialogue),
            assets=len(assets) + len(render_paths) // 2 + len(delivery_paths),
            shot_ids=shot_ids,
            dialogue_ids=dialogue_ids,
            asset_ids=tuple(asset.id for asset in assets),
            local_paths=(
                *(asset.local_path for asset in assets if asset.local_path),
                *render_paths,
                *delivery_paths,
            ),
            cleanup_warnings=tuple(cleanup_warnings),
        )

    def delete(self, episode_id: str) -> EpisodeDeletionResult | None:
        impact = self.preview(episode_id)
        if impact is None:
            return None
        episode = self.session.get(models.Episode, episode_id)
        if episode is None:
            return None

        run_ids = tuple(
            self.session.scalars(
                select(models.ProductionRun.id).where(
                    models.ProductionRun.episode_id == episode_id
                )
            )
        )
        try:
            self.session.execute(
                delete(models.DeliveryPackage).where(
                    models.DeliveryPackage.episode_id == episode_id
                )
            )
            if impact.asset_ids:
                self.session.execute(
                    delete(models.Asset).where(models.Asset.id.in_(impact.asset_ids))
                )
            job_targets = [
                and_(
                    models.Job.target_type == "episode",
                    models.Job.target_id == episode_id,
                )
            ]
            if impact.shot_ids:
                job_targets.append(
                    and_(
                        models.Job.target_type == "shot",
                        models.Job.target_id.in_(impact.shot_ids),
                    )
                )
            if impact.dialogue_ids:
                job_targets.append(
                    and_(
                        models.Job.target_type == "dialogue",
                        models.Job.target_id.in_(impact.dialogue_ids),
                    )
                )
            self.session.execute(delete(models.Job).where(or_(*job_targets)))
            if run_ids:
                self.session.execute(
                    delete(models.ProductionItem).where(
                        models.ProductionItem.run_id.in_(run_ids)
                    )
                )
                self.session.execute(
                    delete(models.ProductionRun).where(
                        models.ProductionRun.id.in_(run_ids)
                    )
                )
            self.session.delete(episode)
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

        return EpisodeDeletionResult(
            impact=impact,
            cleanup_warnings=tuple(
                dict.fromkeys(
                    (*impact.cleanup_warnings, *self._cleanup_files(impact.local_paths))
                )
            ),
        )

    def _cleanup_files(self, local_paths: tuple[str, ...]) -> tuple[str, ...]:
        warnings: list[str] = []
        for local_path in local_paths:
            candidate = (self.data_root / local_path).resolve()
            if candidate == self.data_root or self.data_root not in candidate.parents:
                if "Skipped unsafe media path" not in warnings:
                    warnings.append("Skipped unsafe media path")
                continue
            try:
                candidate.unlink(missing_ok=True)
            except OSError:
                if "Could not remove one local media file" not in warnings:
                    warnings.append("Could not remove one local media file")
                continue
            self._remove_empty_parents(candidate.parent)
        return tuple(warnings)

    def _remove_empty_parents(self, directory: Path) -> None:
        current = directory
        while current != self.data_root and self.data_root in current.parents:
            try:
                current.rmdir()
            except OSError:
                return
            current = current.parent
