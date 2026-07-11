import pytest
from sqlalchemy.exc import IntegrityError

from comic_studio import models
from comic_studio.production import InvalidProductionTransition, ProductionStore


def seed_episode(session):
    project = models.Project(
        title="霓虹夜行", logline="寻找记忆", story_bible="近未来重庆",
        visual_style="Chinese noir", aspect_ratio="9:16",
    )
    episode = models.Episode(
        project=project, title="雨夜", premise="寻找芯片", target_duration_seconds=60,
    )
    session.add(episode)
    session.commit()
    return episode


def test_production_store_tracks_items_counters_and_redacted_failures(db_session):
    episode = seed_episode(db_session)
    store = ProductionStore(db_session)
    run = store.create_run(episode.id, stages=["panels", "speech"], concurrency=2)
    panel = store.add_item(run.id, "panel", "shot", "shot-1", position=1)
    speech = store.add_item(run.id, "speech", "dialogue", "line-1", position=2)

    store.transition_item(panel.id, "running")
    store.transition_item(panel.id, "failed", error="Authorization Bearer sk-secret")
    store.transition_item(speech.id, "skipped", result_metadata={"reason": "already_ready"})
    refreshed = store.refresh_counters(run.id)

    assert refreshed.total_items == 2
    assert refreshed.failed_items == 1
    assert refreshed.skipped_items == 1
    assert store.get_item(panel.id).error == "Authorization Bearer [REDACTED]"


def test_production_store_enforces_transitions_and_item_uniqueness(db_session):
    episode = seed_episode(db_session)
    store = ProductionStore(db_session)
    run = store.create_run(episode.id, stages=["panels"], concurrency=1)
    store.add_item(run.id, "panel", "shot", "shot-1", position=1)

    with pytest.raises(IntegrityError):
        store.add_item(run.id, "panel", "shot", "shot-1", position=2)
    db_session.rollback()
    store.transition_run(run.id, "running")
    store.transition_run(run.id, "completed")

    with pytest.raises(InvalidProductionTransition):
        store.transition_run(run.id, "running")
