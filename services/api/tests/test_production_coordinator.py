import asyncio

from comic_studio import models
from comic_studio.production import ProductionStore
from comic_studio.services.production_coordinator import ProductionCoordinator


def seed_run(session, count=5, concurrency=2):
    project=models.Project(title="p",logline="l",story_bible="b",visual_style="v")
    episode=models.Episode(project=project,title="e",premise="p",target_duration_seconds=60)
    session.add(episode);session.commit();store=ProductionStore(session)
    run=store.create_run(episode.id,stages=["panels"],concurrency=concurrency)
    items=[store.add_item(run.id,"panel","shot",f"shot-{i}",position=i) for i in range(count)]
    return run,items


def test_coordinator_respects_concurrency_and_continues_after_failure(db_session):
    run, _ = seed_run(db_session)
    active=0;maximum=0
    async def worker(item):
        nonlocal active,maximum
        active+=1;maximum=max(maximum,active);await asyncio.sleep(0.01);active-=1
        if item.target_id=="shot-2": raise RuntimeError("provider failed")
        return {"target":item.target_id}

    coordinator=ProductionCoordinator(lambda: db_session, {"panel":worker})
    finished=asyncio.run(coordinator.run(run.id))

    assert maximum==2
    assert finished.status=="completed_with_failures"
    assert finished.succeeded_items==4
    assert finished.failed_items==1


def test_coordinator_honors_pause_before_claiming_new_items(db_session):
    run,_=seed_run(db_session,count=3,concurrency=1)
    store=ProductionStore(db_session);store.transition_run(run.id,"paused")
    called=[]
    async def worker(item): called.append(item.id);return {}

    finished=asyncio.run(ProductionCoordinator(lambda:db_session,{"panel":worker}).run(run.id))

    assert called==[]
    assert finished.status=="paused"
    assert finished.queued_items==3


def test_coordinator_reports_generation_gate_skips_as_incomplete(db_session):
    run, items = seed_run(db_session, count=1)
    store = ProductionStore(db_session)
    store.transition_item(
        items[0].id,
        "skipped",
        result_metadata={
            "reason": "generation_not_ready",
            "blockers": ["missing_background", "director_preview_missing"],
        },
    )

    finished = asyncio.run(
        ProductionCoordinator(lambda: db_session, {"panel": lambda _item: None}).run(
            run.id
        )
    )

    assert finished.status == "completed_with_failures"
    assert finished.skipped_items == 1


def test_coordinator_keeps_already_ready_skips_successful(db_session):
    run, items = seed_run(db_session, count=1)
    store = ProductionStore(db_session)
    store.transition_item(
        items[0].id,
        "skipped",
        result_metadata={"reason": "already_ready"},
    )

    finished = asyncio.run(
        ProductionCoordinator(lambda: db_session, {"panel": lambda _item: None}).run(
            run.id
        )
    )

    assert finished.status == "completed"
    assert finished.skipped_items == 1
