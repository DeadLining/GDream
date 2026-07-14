"""M2.2 — Decision layer tests.

Verifies the decision layer is pure: it never raises, never mutates state, and
returns short rejection codes the execution layer maps to HTTP 409.
"""

from __future__ import annotations

from comic_studio import models, schemas
from comic_studio.services.production_decision import ProductionDecisionService


def _create_payload(**overrides) -> schemas.ProductionRunCreate:
    base = {
        "stages": ["panels"],
        "concurrency": 2,
        "regenerate_panels": False,
        "regenerate_speech": False,
        "regenerate_videos": False,
    }
    base.update(overrides)
    return schemas.ProductionRunCreate(**base)


def _seed_episode(session) -> tuple[str, str, str]:
    """Seed project + episode + two shots. Returns (episode_id, shot_a, shot_b)."""
    project = models.Project(title="P", logline="", story_bible="", visual_style="")
    episode = models.Episode(
        project=project, title="E", premise="t", target_duration_seconds=60
    )
    scene = models.Scene(
        episode=episode, position=1, location="L", summary="S",
        estimated_duration_seconds=8,
    )
    shot_a = models.Shot(
        scene=scene, position=1, shot_type="wide", duration_seconds=4,
        composition="A",
    )
    shot_b = models.Shot(
        scene=scene, position=2, shot_type="close_up", duration_seconds=4,
        composition="B",
    )
    session.add_all([shot_a, shot_b])
    session.flush()
    return episode.id, shot_a.id, shot_b.id


def test_validate_admits_episode_scope_when_no_active_run(db_session):
    episode_id, _, _ = _seed_episode(db_session)
    outcome = ProductionDecisionService(db_session).validate_create(
        episode_id, _create_payload()
    )
    assert outcome.rejection is None
    assert outcome.scope_type == "episode"
    assert outcome.shot_ids is None


def test_validate_rejects_second_episode_scope_active_run(db_session):
    episode_id, _, _ = _seed_episode(db_session)
    db_session.add(models.ProductionRun(
        episode_id=episode_id, stages=["panels"], concurrency=2,
        status="running", scope_type="episode",
    ))
    db_session.flush()
    outcome = ProductionDecisionService(db_session).validate_create(
        episode_id, _create_payload()
    )
    assert outcome.rejection == "active_run"


def test_validate_admits_shot_group_alongside_active_episode_run(db_session):
    episode_id, shot_a, _ = _seed_episode(db_session)
    db_session.add(models.ProductionRun(
        episode_id=episode_id, stages=["panels"], concurrency=2,
        status="running", scope_type="episode",
    ))
    db_session.flush()
    outcome = ProductionDecisionService(db_session).validate_create(
        episode_id, _create_payload(shot_ids=[shot_a])
    )
    assert outcome.rejection is None
    assert outcome.scope_type == "shot_group"
    assert outcome.shot_ids == [shot_a]


def test_validate_rejects_overlapping_shot_group(db_session):
    episode_id, shot_a, shot_b = _seed_episode(db_session)
    db_session.add(models.ProductionRun(
        episode_id=episode_id, stages=["panels"], concurrency=2,
        status="running", scope_type="shot_group", shot_ids=[shot_a, shot_b],
    ))
    db_session.flush()
    outcome = ProductionDecisionService(db_session).validate_create(
        episode_id, _create_payload(shot_ids=[shot_a])
    )
    assert outcome.rejection == "shot_overlap"


def test_validate_admits_non_overlapping_shot_group(db_session):
    episode_id, shot_a, shot_b = _seed_episode(db_session)
    db_session.add(models.ProductionRun(
        episode_id=episode_id, stages=["panels"], concurrency=2,
        status="running", scope_type="shot_group", shot_ids=[shot_a],
    ))
    db_session.flush()
    outcome = ProductionDecisionService(db_session).validate_create(
        episode_id, _create_payload(shot_ids=[shot_b])
    )
    assert outcome.rejection is None
    assert outcome.scope_type == "shot_group"


def test_decision_layer_does_not_mutate_state(db_session):
    episode_id, shot_a, _ = _seed_episode(db_session)
    before = db_session.query(models.ProductionRun).count()
    ProductionDecisionService(db_session).validate_create(
        episode_id, _create_payload(shot_ids=[shot_a])
    )
    after = db_session.query(models.ProductionRun).count()
    assert before == after
