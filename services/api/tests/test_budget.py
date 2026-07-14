import asyncio

from comic_studio import models
from comic_studio.production import ProductionStore
from comic_studio.services.budgeting import BudgetingService
from comic_studio.services.production_coordinator import ProductionCoordinator


def _seed_run(session, item_count=3, concurrency=1, budget_cap_usd=None, budget_mode="observe"):
    project = models.Project(title="p", logline="l", story_bible="b", visual_style="v")
    episode = models.Episode(project=project, title="e", premise="p", target_duration_seconds=60)
    session.add(episode)
    session.commit()
    store = ProductionStore(session)
    run = store.create_run(
        episode.id,
        stages=["panels"],
        concurrency=concurrency,
        budget_cap_usd=budget_cap_usd,
        budget_mode=budget_mode,
    )
    items = [store.add_item(run.id, "panel", "shot", f"shot-{i}", position=i) for i in range(item_count)]
    return run, items


async def _noop_worker(item):
    return {"target": item.target_id}


def test_budget_service_item_cost_estimates(db_session):
    svc = BudgetingService(db_session)
    assert svc.estimate_item_cost("panel") == 0.01
    assert svc.estimate_item_cost("speech") == 0.005
    assert svc.estimate_item_cost("video") == 0.05
    assert svc.estimate_item_cost("unknown") == 0.0


def test_budget_service_records_spend_on_run(db_session):
    run, items = _seed_run(db_session, item_count=2)
    BudgetingService(db_session).record_item_cost(run.id, "panel")
    assert float(run.spent_usd) == 0.01
    BudgetingService(db_session).record_item_cost(run.id, "speech", cost_usd=0.012)
    assert float(run.spent_usd) == 0.022


def test_budget_service_should_pause_honors_cap_mode(db_session):
    run, _ = _seed_run(db_session, item_count=2, budget_cap_usd=0.015, budget_mode="cap")
    svc = BudgetingService(db_session)
    assert not svc.should_pause_run(run.id)
    svc.record_item_cost(run.id, "panel")
    assert svc.should_pause_run(run.id)


def test_budget_service_does_not_pause_in_observe_or_warn(db_session):
    run, _ = _seed_run(db_session, item_count=2, budget_cap_usd=0.001, budget_mode="observe")
    assert not BudgetingService(db_session).should_pause_run(run.id)
    run2, _ = _seed_run(db_session, item_count=2, budget_cap_usd=0.001, budget_mode="warn")
    assert not BudgetingService(db_session).should_pause_run(run2.id)


def test_budget_service_reconcile_invocation_cost(db_session):
    invocation = models.ModelInvocation(
        capability="image",
        provider="test",
        model="test-model",
        target_type="shot",
        target_id="shot-1",
        status="succeeded",
    )
    db_session.add(invocation)
    db_session.commit()
    BudgetingService(db_session).reconcile_invocation(invocation.id, cost_usd=0.123)
    assert float(invocation.cost_usd) == 0.123


def test_coordinator_pauses_run_when_budget_cap_exceeded(db_session):
    run, _ = _seed_run(db_session, item_count=3, concurrency=1, budget_cap_usd=0.015, budget_mode="cap")
    finished = asyncio.run(ProductionCoordinator(lambda: db_session, {"panel": _noop_worker}).run(run.id))
    assert finished.status == "paused"
    assert float(finished.spent_usd) == 0.01
    assert finished.succeeded_items == 1
    assert finished.queued_items == 2


def test_coordinator_completes_when_budget_under_cap(db_session):
    run, _ = _seed_run(db_session, item_count=3, concurrency=1, budget_cap_usd=0.05, budget_mode="cap")
    finished = asyncio.run(ProductionCoordinator(lambda: db_session, {"panel": _noop_worker}).run(run.id))
    assert finished.status == "completed"
    assert float(finished.spent_usd) == 0.03
    assert finished.succeeded_items == 3


def test_coordinator_does_not_pause_in_observe_mode(db_session):
    run, _ = _seed_run(db_session, item_count=3, concurrency=1, budget_cap_usd=0.001, budget_mode="observe")
    finished = asyncio.run(ProductionCoordinator(lambda: db_session, {"panel": _noop_worker}).run(run.id))
    assert finished.status == "completed"
    assert float(finished.spent_usd) == 0.03


def test_coordinator_does_not_pause_in_warn_mode(db_session):
    run, _ = _seed_run(db_session, item_count=3, concurrency=1, budget_cap_usd=0.001, budget_mode="warn")
    finished = asyncio.run(ProductionCoordinator(lambda: db_session, {"panel": _noop_worker}).run(run.id))
    assert finished.status == "completed"
    assert float(finished.spent_usd) == 0.03
