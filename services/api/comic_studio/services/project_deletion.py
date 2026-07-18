from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shutil

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models


@dataclass(frozen=True)
class ProjectDeletionImpact:
    project_id: str
    title: str
    episodes: int
    characters: int
    assets: int


@dataclass(frozen=True)
class ProjectDeletionResult:
    impact: ProjectDeletionImpact
    cleanup_warnings: tuple[str, ...]


class ProjectDeletionService:
    def __init__(self, session: Session, data_root: Path):
        self.session = session
        self.data_root = data_root.resolve()

    def preview(self, project_id: str) -> ProjectDeletionImpact | None:
        project = self.session.get(models.Project, project_id)
        if project is None:
            return None
        episode_ids = tuple(
            self.session.scalars(
                select(models.Episode.id).where(
                    models.Episode.project_id == project_id
                )
            )
        )
        character_ids = tuple(
            self.session.scalars(
                select(models.Character.id).where(
                    models.Character.project_id == project_id
                )
            )
        )
        asset_ids = tuple(
            self.session.scalars(
                select(models.Asset.id).where(models.Asset.project_id == project_id)
            )
        )
        return ProjectDeletionImpact(
            project_id=project.id,
            title=project.title,
            episodes=len(episode_ids),
            characters=len(character_ids),
            assets=len(asset_ids),
        )

    def delete(self, project_id: str) -> ProjectDeletionResult | None:
        project = self.session.scalar(
            select(models.Project)
            .where(models.Project.id == project_id)
            .options(
                selectinload(models.Project.episodes)
                .selectinload(models.Episode.scenes)
                .selectinload(models.Scene.shots)
                .selectinload(models.Shot.dialogue),
                selectinload(models.Project.characters),
                selectinload(models.Project.script_imports),
                selectinload(models.Project.scripts),
                selectinload(models.Project.volumes),
                selectinload(models.Project.library_assets),
                selectinload(models.Project.storylines),
                selectinload(models.Project.asset_requirements),
            )
        )
        if project is None:
            return None
        impact = self.preview(project_id)
        if impact is None:
            return None

        episode_ids = tuple(item.id for item in project.episodes)
        scene_ids = tuple(
            scene.id for episode in project.episodes for scene in episode.scenes
        )
        shot_ids = tuple(
            shot.id
            for episode in project.episodes
            for scene in episode.scenes
            for shot in scene.shots
        )
        dialogue_ids = tuple(
            line.id
            for episode in project.episodes
            for scene in episode.scenes
            for shot in scene.shots
            for line in shot.dialogue
        )
        character_ids = tuple(item.id for item in project.characters)
        asset_ids = tuple(
            self.session.scalars(
                select(models.Asset.id).where(models.Asset.project_id == project_id)
            )
        )
        target_ids = {
            project_id,
            *episode_ids,
            *scene_ids,
            *shot_ids,
            *dialogue_ids,
            *character_ids,
            *asset_ids,
        }
        job_ids = tuple(
            self.session.scalars(
                select(models.Job.id).where(models.Job.target_id.in_(target_ids))
            )
        )
        production_run_ids = (
            tuple(
                self.session.scalars(
                    select(models.ProductionRun.id).where(
                        models.ProductionRun.episode_id.in_(episode_ids)
                    )
                )
            )
            if episode_ids
            else ()
        )
        ai_run_ids = (
            tuple(
                self.session.scalars(
                    select(models.EpisodeAIRun.id).where(
                        models.EpisodeAIRun.episode_id.in_(episode_ids)
                    )
                )
            )
            if episode_ids
            else ()
        )

        try:
            if job_ids or target_ids:
                self.session.execute(
                    delete(models.ModelInvocation).where(
                        or_(
                            models.ModelInvocation.target_id.in_(target_ids),
                            models.ModelInvocation.job_id.in_(job_ids),
                        )
                    )
                )
            if job_ids:
                self.session.execute(
                    delete(models.Job).where(models.Job.id.in_(job_ids))
                )
            if production_run_ids:
                self.session.execute(
                    delete(models.ProductionItem).where(
                        models.ProductionItem.run_id.in_(production_run_ids)
                    )
                )
                self.session.execute(
                    delete(models.ProductionRun).where(
                        models.ProductionRun.id.in_(production_run_ids)
                    )
                )
            if ai_run_ids:
                self.session.execute(
                    delete(models.EpisodeAIRunStage).where(
                        models.EpisodeAIRunStage.run_id.in_(ai_run_ids)
                    )
                )
                self.session.execute(
                    delete(models.EpisodeAIRun).where(
                        models.EpisodeAIRun.id.in_(ai_run_ids)
                    )
                )
            if episode_ids:
                for model in (
                    models.EpisodeVersion,
                    models.ProductionCanvasLayout,
                    models.RenderReviewRecord,
                ):
                    self.session.execute(
                        delete(model).where(model.episode_id.in_(episode_ids))
                    )
            for model in (
                models.DeliveryPackage,
                models.ProductionTask,
                models.TrashItem,
                models.ProjectMember,
                models.ProductionWorkflowBinding,
            ):
                self.session.execute(
                    delete(model).where(model.project_id == project_id)
                )
            self.session.delete(project)
            self.session.flush()
            self.session.execute(
                delete(models.Asset).where(models.Asset.project_id == project_id)
            )
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

        return ProjectDeletionResult(
            impact=impact,
            cleanup_warnings=self._cleanup_project_directory(project_id),
        )

    def _cleanup_project_directory(self, project_id: str) -> tuple[str, ...]:
        candidate = (self.data_root / "projects" / project_id).resolve()
        if candidate == self.data_root or self.data_root not in candidate.parents:
            return ("Skipped unsafe project directory",)
        if not candidate.exists():
            return ()
        try:
            shutil.rmtree(candidate)
        except OSError:
            return ("Could not remove the local project directory",)
        return ()
