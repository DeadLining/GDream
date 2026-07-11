from sqlalchemy import select
from sqlalchemy.orm import Session

from comic_studio import models, schemas
from comic_studio.production import ProductionStore
from comic_studio.repositories import EpisodeRepository


ACTIVE_RUN_STATUSES = {"queued", "running", "paused"}


class ProductionRunService:
    def __init__(self, session: Session): self.session = session

    def active_run(self, episode_id: str):
        return self.session.scalar(select(models.ProductionRun).where(
            models.ProductionRun.episode_id == episode_id,
            models.ProductionRun.status.in_(ACTIVE_RUN_STATUSES),
        ).order_by(models.ProductionRun.created_at.desc()))

    def create(self, episode_id: str, data: schemas.ProductionRunCreate):
        episode = EpisodeRepository(self.session).get(episode_id)
        if episode is None: return None
        if self.active_run(episode_id) is not None: raise RuntimeError("active_run")
        store = ProductionStore(self.session)
        run = store.create_run(
            episode_id, stages=list(data.stages), concurrency=data.concurrency,
            regenerate_panels=data.regenerate_panels, regenerate_speech=data.regenerate_speech,
        )
        position = 0
        shots = [shot for scene in episode.scenes for shot in scene.shots]
        if "panels" in data.stages:
            for shot in shots:
                position += 1
                ready = bool(shot.active_panel_asset_id and shot.review_status == "approved")
                status = "queued" if data.regenerate_panels or not ready else "skipped"
                metadata = {} if status == "queued" else {"reason": "already_ready"}
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
        return store.refresh_counters(run.id)
