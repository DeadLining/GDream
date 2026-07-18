from sqlalchemy import select
from sqlalchemy.orm import Session

from comic_studio import models, schemas
from comic_studio.production import ProductionStore
from comic_studio.repositories import EpisodeRepository
from comic_studio.services.asset_requirements import (
    AssetRequirementService,
    CurrentScriptRevisionMissing,
)
from comic_studio.services.production_decision import (
    ACTIVE_RUN_STATUSES,
    ProductionDecisionService,
)


class ProductionRunService:
    """Execution layer of the three-tier agent contract (M2.2).

    Creates and advances runs/items; delegates admission policy to
    ``ProductionDecisionService``. The execution layer never decides *whether*
    a run should exist — only *how* to materialize it once admitted.
    """

    def __init__(self, session: Session): self.session = session

    def active_episode_run(self, episode_id: str):
        """An active episode-scope run, if any. Shot-group runs do not count."""
        return self.session.scalar(select(models.ProductionRun).where(
            models.ProductionRun.episode_id == episode_id,
            models.ProductionRun.scope_type == "episode",
            models.ProductionRun.status.in_(ACTIVE_RUN_STATUSES),
        ).order_by(models.ProductionRun.created_at.desc()))

    def active_shot_group_runs(self, episode_id: str):
        """All active shot-group runs for an episode."""
        return list(self.session.scalars(select(models.ProductionRun).where(
            models.ProductionRun.episode_id == episode_id,
            models.ProductionRun.scope_type == "shot_group",
            models.ProductionRun.status.in_(ACTIVE_RUN_STATUSES),
        ).order_by(models.ProductionRun.created_at.desc())))

    def create(self, episode_id: str, data: schemas.ProductionRunCreate):
        episode = EpisodeRepository(self.session).get(episode_id)
        if episode is None: return None

        # M2.2: delegate admission policy to the decision layer.
        decision = ProductionDecisionService(self.session).validate_create(episode_id, data)
        if decision.rejection is not None:
            # Re-use the existing RuntimeError contract so routes keep mapping
            # rejection codes to HTTP 409 unchanged.
            raise RuntimeError(decision.rejection)
        scope_type = decision.scope_type
        shot_ids = decision.shot_ids

        store = ProductionStore(self.session)
        run = store.create_run(
            episode_id, stages=list(data.stages), concurrency=data.concurrency,
            regenerate_panels=data.regenerate_panels, regenerate_speech=data.regenerate_speech,
            regenerate_videos=data.regenerate_videos,
            panel_generation_mode=data.panel_generation_mode,
            budget_cap_usd=data.budget_cap_usd,
            budget_mode=data.budget_mode,
            scope_type=scope_type, shot_ids=shot_ids,
        )
        position = 0
        all_shots = [shot for scene in episode.scenes for shot in scene.shots]
        # For shot_group scope, only snapshot the selected shots (and their dialogue).
        selected = set(shot_ids) if shot_ids is not None else None
        shots = [s for s in all_shots if selected is None or s.id in selected]
        generation_readiness: dict[str, dict | None] = {}

        def shot_generation_readiness(shot: models.Shot) -> dict | None:
            if shot.id not in generation_readiness:
                try:
                    generation_readiness[shot.id] = AssetRequirementService(
                        self.session
                    ).shot_readiness(shot.id)
                except CurrentScriptRevisionMissing:
                    generation_readiness[shot.id] = None
            return generation_readiness[shot.id]

        def panel_state(shot: models.Shot, *, regenerate: bool):
            already_ready = bool(
                shot.active_panel_asset_id and shot.review_status == "approved"
            )
            if already_ready and not regenerate:
                return "skipped", {"reason": "already_ready"}
            readiness = shot_generation_readiness(shot)
            if readiness is not None and not readiness["ready"]:
                return "skipped", {
                    "reason": "generation_not_ready",
                    "blockers": readiness["blockers"],
                }
            return "queued", {}

        if "panels" in data.stages:
            if data.panel_generation_mode == "grid":
                for scene in episode.scenes:
                    scene_shots = [s for s in scene.shots if selected is None or s.id in selected]
                    if not scene_shots:
                        continue
                    # 2x2 grid cells per image.
                    for index in range(0, len(scene_shots), 4):
                        chunk = scene_shots[index : index + 4]
                        position += 1
                        already_ready = all(
                            bool(s.active_panel_asset_id and s.review_status == "approved")
                            for s in chunk
                        )
                        if already_ready and not data.regenerate_panels:
                            status, metadata = "skipped", {"reason": "already_ready"}
                        else:
                            blocked_shots = {
                                shot.id: readiness["blockers"]
                                for shot in chunk
                                if (readiness := shot_generation_readiness(shot))
                                is not None
                                and not readiness["ready"]
                            }
                            if blocked_shots:
                                status, metadata = "skipped", {
                                    "reason": "generation_not_ready",
                                    "blocked_shots": blocked_shots,
                                }
                            else:
                                status, metadata = "queued", {}
                        store.add_item(
                            run.id,
                            "panel",
                            "grid_panel",
                            ",".join(s.id for s in chunk),
                            position=position,
                            status=status,
                            result_metadata=metadata,
                        )
            else:
                for shot in shots:
                    position += 1
                    status, metadata = panel_state(
                        shot, regenerate=data.regenerate_panels
                    )
                    store.add_item(run.id, "panel", "shot", shot.id, position=position, status=status, result_metadata=metadata)
        if "speech" in data.stages:
            for shot in shots:
                for line in shot.dialogue:
                    if not line.text.strip(): continue
                    position += 1
                    ready = bool(line.audio_asset_id and line.duration_seconds > 0)
                    status = "queued" if data.regenerate_speech or not ready else "skipped"
                    metadata = {} if status == "queued" else {"reason": "already_ready"}
                    store.add_item(run.id, "speech", "dialogue", line.id, position=position, status=status, result_metadata=metadata)
        if "videos" in data.stages:
            for shot in shots:
                position += 1
                eligible = bool(shot.active_panel_asset_id and shot.review_status == "approved")
                ready = bool(shot.active_video_asset_id)
                if not eligible:
                    status, metadata = "skipped", {"reason": "missing_approved_panel"}
                elif data.regenerate_videos or not ready:
                    status, metadata = "queued", {}
                else:
                    status, metadata = "skipped", {"reason": "already_ready"}
                store.add_item(run.id, "video", "shot", shot.id, position=position, status=status, result_metadata=metadata)
        return store.refresh_counters(run.id)

