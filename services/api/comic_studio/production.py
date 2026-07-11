from collections import Counter
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from comic_studio import models
from comic_studio.redaction import redact


class InvalidProductionTransition(ValueError):
    pass


RUN_TRANSITIONS = {
    "queued": {"running", "paused"},
    "running": {"paused", "completed", "completed_with_failures"},
    "paused": {"running"},
    "completed": set(),
    "completed_with_failures": {"running"},
}
ITEM_TRANSITIONS = {
    "queued": {"running", "skipped"},
    "running": {"succeeded", "failed", "queued"},
    "failed": {"queued"},
    "succeeded": set(),
    "skipped": set(),
}


class ProductionStore:
    def __init__(self, session: Session):
        self.session = session

    def create_run(self, episode_id: str, *, stages: list[str], concurrency: int,
                   regenerate_panels: bool = False, regenerate_speech: bool = False):
        run = models.ProductionRun(
            episode_id=episode_id, stages=stages, concurrency=concurrency,
            regenerate_panels=regenerate_panels, regenerate_speech=regenerate_speech,
        )
        self.session.add(run); self.session.commit(); self.session.refresh(run); return run

    def get_run(self, run_id: str): return self.session.get(models.ProductionRun, run_id)
    def get_item(self, item_id: str): return self.session.get(models.ProductionItem, item_id)

    def add_item(self, run_id: str, stage: str, target_type: str, target_id: str,
                 *, position: int, status: str = "queued", result_metadata: dict | None = None):
        item = models.ProductionItem(
            run_id=run_id, stage=stage, target_type=target_type, target_id=target_id,
            position=position, status=status, result_metadata=result_metadata or {},
        )
        self.session.add(item); self.session.commit(); self.session.refresh(item); return item

    def list_items(self, run_id: str):
        return list(self.session.scalars(select(models.ProductionItem).where(
            models.ProductionItem.run_id == run_id).order_by(models.ProductionItem.position)))

    def transition_run(self, run_id: str, status: str):
        run = self.get_run(run_id)
        if run is None: raise KeyError(run_id)
        if status not in RUN_TRANSITIONS.get(run.status, set()):
            raise InvalidProductionTransition(f"Cannot transition run {run.status} to {status}")
        run.status = status; run.pause_requested = status == "paused"
        self.session.commit(); self.session.refresh(run); return run

    def transition_item(self, item_id: str, status: str, *, error: str = "",
                        result_metadata: dict[str, Any] | None = None):
        item = self.get_item(item_id)
        if item is None: raise KeyError(item_id)
        if status not in ITEM_TRANSITIONS.get(item.status, set()):
            raise InvalidProductionTransition(f"Cannot transition item {item.status} to {status}")
        if status == "running": item.attempt_count += 1
        item.status = status; item.error = str(redact(error))[:4000]
        if result_metadata is not None: item.result_metadata = redact(result_metadata)
        if status == "queued": item.error = ""; item.result_metadata = {}
        self.session.commit(); self.session.refresh(item); return item

    def refresh_counters(self, run_id: str):
        run = self.get_run(run_id)
        if run is None: raise KeyError(run_id)
        counts = Counter(item.status for item in self.list_items(run_id))
        run.total_items = sum(counts.values())
        for status in ["queued", "running", "succeeded", "failed", "skipped"]:
            setattr(run, f"{status}_items", counts[status])
        self.session.commit(); self.session.refresh(run); return run
