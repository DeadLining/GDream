import asyncio
from collections.abc import Awaitable, Callable

from comic_studio import models
from comic_studio.production import ProductionStore
from comic_studio.services.budgeting import BudgetingService


Worker = Callable[[models.ProductionItem], Awaitable[dict]]
BLOCKING_SKIP_REASONS = {"generation_not_ready", "missing_approved_panel"}


def _has_blocking_skips(items: list[models.ProductionItem]) -> bool:
    return any(
        item.status == "skipped"
        and item.result_metadata.get("reason") in BLOCKING_SKIP_REASONS
        for item in items
    )


class ProductionCoordinator:
    def __init__(self, session_factory, workers: dict[str, Worker]):
        self.session_factory = session_factory; self.workers = workers

    async def run(self, run_id: str):
        session = self.session_factory(); store = ProductionStore(session); run = store.get_run(run_id)
        if run is None: raise KeyError(run_id)
        if run.status == "paused": return store.refresh_counters(run_id)
        if run.status == "queued": run = store.transition_run(run_id, "running")
        while True:
            session.expire_all(); run = store.get_run(run_id)
            if run.pause_requested or run.status == "paused": return store.refresh_counters(run_id)
            # M4.1: pause before the next batch if the budget cap would be exceeded.
            if BudgetingService(session).should_pause_run(run_id):
                run = store.transition_run(run_id, "paused")
                return store.refresh_counters(run_id)
            queued = [item for item in store.list_items(run_id) if item.status == "queued"]
            if not queued: break
            batch = queued[:run.concurrency]
            for item in batch: store.transition_item(item.id, "running")

            async def execute(item_id: str):
                item = store.get_item(item_id)
                try:
                    result = await self.workers[item.stage](item)
                    store.transition_item(item.id, "succeeded", result_metadata=result)
                    BudgetingService(session).record_item_cost(item.run_id, item.stage)
                except Exception as exc:
                    store.transition_item(item.id, "failed", error=f"{type(exc).__name__}: {exc}")

            await asyncio.gather(*(execute(item.id) for item in batch))
            store.refresh_counters(run_id)
        run = store.refresh_counters(run_id)
        terminal = (
            "completed_with_failures"
            if run.failed_items or _has_blocking_skips(store.list_items(run_id))
            else "completed"
        )
        if run.status == "running": run = store.transition_run(run_id, terminal)
        return store.refresh_counters(run_id)
