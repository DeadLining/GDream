from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session

from comic_studio import models, schemas
from comic_studio.services.readiness import ReadinessService


WORKSPACE_TIMEZONE = ZoneInfo("Asia/Shanghai")


def updated_on_workspace_today(
    updated_at: datetime | None, *, now: datetime | None = None
) -> bool:
    if updated_at is None:
        return False
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    return updated_at.astimezone(WORKSPACE_TIMEZONE).date() == current.astimezone(
        WORKSPACE_TIMEZONE
    ).date()


class DiscoveryService:
    def __init__(self, session: Session):
        self.session = session

    def workspace_summary(self) -> schemas.WorkspaceSummaryRead:
        projects = list(
            self.session.scalars(
                select(models.Project).order_by(
                    models.Project.updated_at.desc(), models.Project.created_at.desc()
                )
            )
        )
        rows: list[schemas.WorkspaceProjectSummary] = []
        total_tasks = 0
        total_pending = 0
        updated_today = 0
        for project in projects:
            volume_count = self._count(models.Volume.id, models.Volume.project_id == project.id)
            episode_ids = tuple(
                self.session.scalars(
                    select(models.Episode.id).where(models.Episode.project_id == project.id)
                )
            )
            episode_count = len(episode_ids)
            scene_ids = (
                tuple(
                    self.session.scalars(
                        select(models.Scene.id).where(models.Scene.episode_id.in_(episode_ids))
                    )
                )
                if episode_ids
                else ()
            )
            scene_count = len(scene_ids)
            shot_count = self._count(models.Shot.id, models.Shot.scene_id.in_(scene_ids)) if scene_ids else 0
            pending_review = self._count(
                models.Shot.id,
                models.Shot.scene_id.in_(scene_ids),
                models.Shot.review_status != "approved",
            ) if scene_ids else 0
            task_query = (
                select(models.ProductionTask)
                .where(
                    models.ProductionTask.project_id == project.id,
                    models.ProductionTask.status.in_(("todo", "in_progress", "review")),
                )
                .order_by(models.ProductionTask.updated_at.desc())
            )
            tasks = list(self.session.scalars(task_query))
            open_tasks = len(tasks)
            completion, stage = self._production_progress(episode_ids)
            total_tasks += open_tasks
            total_pending += pending_review
            if updated_on_workspace_today(project.updated_at):
                updated_today += 1
            rows.append(
                schemas.WorkspaceProjectSummary(
                    project_id=project.id,
                    title=project.title,
                    logline=project.logline,
                    volume_count=volume_count,
                    episode_count=episode_count,
                    scene_count=scene_count,
                    shot_count=shot_count,
                    open_task_count=open_tasks,
                    pending_review_count=pending_review,
                    completion_percent=completion,
                    current_stage=stage,
                    latest_task_titles=[task.title for task in tasks[:3]],
                    updated_at=project.updated_at,
                )
            )
        return schemas.WorkspaceSummaryRead(
            active_project_count=len(projects),
            active_task_count=total_tasks,
            pending_review_count=total_pending,
            updated_today_count=updated_today,
            projects=rows,
        )

    def _production_progress(self, episode_ids: tuple[str, ...]) -> tuple[int, str]:
        if not episode_ids:
            return 0, "项目初始化"
        readiness = ReadinessService(self.session)
        reports = [readiness.inspect(episode_id) for episode_id in episode_ids]
        reports = [report for report in reports if report is not None]
        total_shots = sum(report["totals"]["shots"] for report in reports)
        total_dialogue = sum(report["totals"]["dialogue"] for report in reports)
        total_steps = total_shots * 3 + total_dialogue
        ready_steps = sum(
            report["ready_counts"]["panels"]
            + report["ready_counts"]["approved"]
            + report["ready_counts"]["videos"]
            + report["ready_counts"]["speech"]
            for report in reports
        )
        completion = round((ready_steps / total_steps) * 100) if total_steps else 0
        blockers = {
            key: any(report["blockers"][key] for report in reports)
            for key in (
                "missing_panels",
                "stale_panels",
                "unapproved_shots",
                "missing_speech",
                "missing_videos",
            )
        }
        if total_shots == 0:
            stage = "分镜规划"
        elif blockers["missing_panels"] or blockers["stale_panels"]:
            stage = "画面制作"
        elif blockers["unapproved_shots"]:
            stage = "镜头审核"
        elif blockers["missing_speech"]:
            stage = "配音制作"
        elif blockers["missing_videos"]:
            stage = "视频制作"
        else:
            stage = "素材就绪"
        return completion, stage

    def _count(self, column, *conditions) -> int:
        return int(self.session.scalar(select(func.count(column)).where(*conditions)) or 0)

    def _variant_lineage(self, variant: models.AssetVariant) -> list[str]:
        labels = [variant.label]
        parent_id = variant.parent_variant_id
        seen = {variant.id}
        while parent_id and parent_id not in seen:
            seen.add(parent_id)
            parent = self.session.get(models.AssetVariant, parent_id)
            if parent is None:
                break
            labels.insert(0, parent.label)
            parent_id = parent.parent_variant_id
        return labels

    def search(self, project_id: str, query: str):
        project = self.session.get(models.Project, project_id)
        if project is None:
            return None
        term = query.strip()
        if not term:
            raise ValueError("Search query is required")
        like = f"%{term}%"
        results: list[schemas.ProjectSearchResult] = []

        characters = self.session.scalars(
            select(models.Character).where(
                models.Character.project_id == project_id,
                or_(
                    models.Character.name.ilike(like),
                    models.Character.appearance_bible.ilike(like),
                    models.Character.continuity_rules.ilike(like),
                ),
            ).limit(12)
        )
        for item in characters:
            results.append(self._result("character", item.id, item.name, item.role, project_id, character_id=item.id))

        variants = self.session.scalars(
            select(models.AssetVariant)
            .join(models.Character, models.Character.id == models.AssetVariant.character_id)
            .where(
                models.Character.project_id == project_id,
                models.AssetVariant.deleted_at.is_(None),
                models.AssetVariant.label.ilike(like),
            ).limit(12)
        )
        for item in variants:
            character = self.session.get(models.Character, item.character_id)
            results.append(self._result("asset_variant", item.id, item.label, character.name if character else "角色资产", project_id, episode_id=item.episode_id, character_id=item.character_id, variant_id=item.id, hierarchy=self._variant_lineage(item), status=item.review_status, reference_count=self._count(models.AssetVariantUsage.id, models.AssetVariantUsage.variant_id == item.id)))

        states = self.session.scalars(
            select(models.AssetVariantState)
            .join(models.AssetVariant, models.AssetVariant.id == models.AssetVariantState.variant_id)
            .join(models.Character, models.Character.id == models.AssetVariant.character_id)
            .where(
                models.Character.project_id == project_id,
                models.AssetVariant.deleted_at.is_(None),
                models.AssetVariantState.deleted_at.is_(None),
                models.AssetVariantState.label.ilike(like),
            ).limit(12)
        )
        for item in states:
            variant = self.session.get(models.AssetVariant, item.variant_id)
            if variant is None:
                continue
            results.append(self._result("asset_state", item.id, item.label, variant.label, project_id, episode_id=variant.episode_id, character_id=variant.character_id, variant_id=variant.id, state_id=item.id, hierarchy=[*self._variant_lineage(variant), item.label], reference_count=self._count(models.AssetVariantUsage.id, models.AssetVariantUsage.state_id == item.id)))

        library_assets = self.session.scalars(
            select(models.LibraryAsset).where(
                models.LibraryAsset.project_id == project_id,
                or_(
                    models.LibraryAsset.name.ilike(like),
                    models.LibraryAsset.description.ilike(like),
                    cast(models.LibraryAsset.tags, String).ilike(like),
                ),
            ).limit(12)
        )
        library_kind_labels = {
            "scene": "场景资产",
            "prop": "道具资产",
            "costume": "服装资产",
            "sound": "声音资产",
        }
        for item in library_assets:
            results.append(
                self._result(
                    "library_asset",
                    item.id,
                    item.name,
                    item.description,
                    project_id,
                    library_asset_id=item.id,
                    library_asset_kind=item.kind,
                    hierarchy=[project.title, library_kind_labels[item.kind], item.name],
                    status="ready" if item.media_asset_id else "pending",
                    reference_count=self._count(
                        models.LibraryAssetSceneBinding.id,
                        models.LibraryAssetSceneBinding.library_asset_id == item.id,
                    ),
                )
            )

        episodes = self.session.scalars(select(models.Episode).where(models.Episode.project_id == project_id, or_(models.Episode.title.ilike(like), models.Episode.premise.ilike(like))).limit(12))
        for item in episodes:
            results.append(self._result("episode", item.id, item.title, item.premise, project_id, episode_id=item.id, hierarchy=[project.title, item.title], status=item.status))

        scenes = self.session.execute(
            select(models.Scene, models.Episode).join(models.Episode, models.Episode.id == models.Scene.episode_id).where(models.Episode.project_id == project_id, or_(models.Scene.location.ilike(like), models.Scene.summary.ilike(like))).limit(12)
        )
        for item, episode in scenes:
            results.append(self._result("scene", item.id, item.location, item.summary, project_id, episode_id=episode.id, scene_id=item.id, hierarchy=[project.title, episode.title, item.location]))

        shots = self.session.execute(
            select(models.Shot, models.Scene, models.Episode).join(models.Scene, models.Scene.id == models.Shot.scene_id).join(models.Episode, models.Episode.id == models.Scene.episode_id).where(models.Episode.project_id == project_id, or_(models.Shot.composition.ilike(like), models.Shot.image_prompt.ilike(like), models.Shot.video_prompt.ilike(like))).limit(12)
        )
        for item, scene, episode in shots:
            results.append(self._result("shot", item.id, f"镜头 {item.position:02d}", item.composition, project_id, episode_id=episode.id, scene_id=scene.id, shot_id=item.id, hierarchy=[project.title, episode.title, scene.location, f"镜头 {item.position:02d}"], status=item.review_status))

        tasks = self.session.scalars(select(models.ProductionTask).where(models.ProductionTask.project_id == project_id, or_(models.ProductionTask.title.ilike(like), models.ProductionTask.description.ilike(like))).limit(12))
        for item in tasks:
            results.append(self._result("task", item.id, item.title, item.description, project_id, episode_id=item.episode_id, scene_id=item.scene_id, shot_id=item.shot_id, status=item.status))

        reviews = self.session.execute(select(models.ReviewThread, models.Episode).join(models.Episode, models.Episode.id == models.ReviewThread.episode_id).where(models.Episode.project_id == project_id, models.ReviewThread.title.ilike(like)).limit(12))
        for item, episode in reviews:
            results.append(self._result("review", item.id, item.title, f"{item.severity} · {item.status}", project_id, episode_id=episode.id, shot_id=item.shot_id, hierarchy=[project.title, episode.title], status=item.status))

        scripts = self.session.scalars(select(models.ScriptDocument).where(models.ScriptDocument.project_id == project_id, models.ScriptDocument.title.ilike(like)).limit(12))
        for item in scripts:
            results.append(self._result("script", item.id, item.title, item.status, project_id, status=item.status))
        return schemas.ProjectSearchRead(query=term, results=results[:50])

    @staticmethod
    def _result(kind, id, title, subtitle, project_id, **extra):
        return schemas.ProjectSearchResult(kind=kind, id=id, title=title, subtitle=subtitle or "", project_id=project_id, **extra)
