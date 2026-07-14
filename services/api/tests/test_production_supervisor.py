"""M2.2 — Supervision layer tests.

Verifies the supervisor is read-only, aggregates progress + render-review
signals, and produces advisory suggestions without mutating state.
"""

from __future__ import annotations

from comic_studio import models
from comic_studio.services.production_supervisor import ProductionSupervisorService


def _seed_run_with_items(session) -> tuple[str, str]:
    """Seed one run with 2 succeeded + 1 failed item. Returns (run_id, episode_id)."""
    project = models.Project(title="P", logline="", story_bible="", visual_style="")
    episode = models.Episode(
        project=project, title="E", premise="t", target_duration_seconds=60
    )
    session.add_all([project, episode])
    session.flush()  # ensure episode.id is populated before run references it
    run = models.ProductionRun(
        episode_id=episode.id, stages=["panels"], concurrency=2,
        status="completed_with_failures", scope_type="episode",
        total_items=3, succeeded_items=2, failed_items=1,
    )
    session.add(run)
    session.flush()  # ensure run.id is populated before items reference it
    session.add_all([
        models.ProductionItem(run_id=run.id, stage="panel", target_type="shot",
                              target_id="shot-1", position=1, status="succeeded"),
        models.ProductionItem(run_id=run.id, stage="panel", target_type="shot",
                              target_id="shot-2", position=2, status="succeeded"),
        models.ProductionItem(run_id=run.id, stage="panel", target_type="shot",
                              target_id="shot-3", position=3, status="failed",
                              error="provider 500"),
    ])
    session.flush()
    return run.id, episode.id


def test_summarize_run_returns_progress_and_failed_items(db_session):
    run_id, _ = _seed_run_with_items(db_session)
    summary = ProductionSupervisorService(db_session).summarize_run(run_id)

    assert summary is not None
    assert summary.run_id == run_id
    assert summary.progress["total"] == 3
    assert summary.progress["succeeded"] == 2
    assert summary.progress["failed"] == 1
    assert len(summary.failed_items) == 1
    assert summary.failed_items[0]["target_id"] == "shot-3"
    assert "provider 500" in summary.failed_items[0]["error"]


def test_summarize_run_includes_render_reviews(db_session):
    run_id, episode_id = _seed_run_with_items(db_session)
    db_session.add(models.RenderReviewRecord(
        episode_id=episode_id, render_path="/tmp/x.mp4",
        overall_pass=False, findings=[{"code": "black_frames", "severity": "critical"}],
        slideshow_risk={"score": 0.8, "level": "critical", "dimensions": {}, "triggered": []},
    ))
    db_session.flush()
    summary = ProductionSupervisorService(db_session).summarize_run(run_id)
    assert summary is not None
    assert len(summary.render_reviews) == 1
    review = summary.render_reviews[0]
    assert review["overall_pass"] is False
    assert review["slideshow_risk_level"] == "critical"
    assert review["slideshow_risk_score"] == 0.8


def test_summarize_run_suggestions_advisory_only(db_session):
    run_id, episode_id = _seed_run_with_items(db_session)
    db_session.add(models.RenderReviewRecord(
        episode_id=episode_id, render_path="/tmp/x.mp4",
        overall_pass=False, findings=[],
        slideshow_risk={"score": 0.8, "level": "critical", "dimensions": {}, "triggered": []},
    ))
    db_session.flush()
    summary = ProductionSupervisorService(db_session).summarize_run(run_id)
    # Should suggest retry because of failed items, and flag render review.
    assert any("failed" in s for s in summary.suggestions)
    assert any("self-check" in s for s in summary.suggestions)
    assert any("slideshow-critical" in s for s in summary.suggestions)

    # Crucially: the supervisor must NOT transition the run or items.
    run = db_session.get(models.ProductionRun, run_id)
    assert run.status == "completed_with_failures"  # unchanged


def test_summarize_run_returns_none_for_unknown_run(db_session):
    assert ProductionSupervisorService(db_session).summarize_run("nope") is None


def test_summarize_run_does_not_mutate_state(db_session):
    run_id, _ = _seed_run_with_items(db_session)
    items_before = db_session.query(models.ProductionItem).filter_by(run_id=run_id).all()
    statuses_before = {item.id: item.status for item in items_before}

    ProductionSupervisorService(db_session).summarize_run(run_id)

    items_after = db_session.query(models.ProductionItem).filter_by(run_id=run_id).all()
    statuses_after = {item.id: item.status for item in items_after}
    assert statuses_before == statuses_after
