import asyncio

from comic_studio import models, schemas
from comic_studio.db import create_session_factory, create_tables
from comic_studio.services.episode_ai_orchestrator import (
    EpisodeAIOrchestrator,
    EpisodeAIStageContext,
    EpisodeAIStageNeedsReview,
)
from comic_studio.services.episode_ai_runs import EpisodeAIRunService


def _seed_run(tmp_path):
    session_factory = create_session_factory(f"sqlite:///{tmp_path / 'orchestrator.db'}")
    create_tables(session_factory)
    with session_factory() as session:
        project = models.Project(
            title="整集编排",
            logline="模型自动完成整集",
            story_bible="保持角色与空间连续",
            visual_style="comic",
            aspect_ratio="9:16",
            language="Chinese",
        )
        episode = models.Episode(
            project=project,
            title="第一集",
            premise="发现关键线索",
            target_duration_seconds=30,
        )
        session.add(episode)
        session.commit()
        run, created = EpisodeAIRunService(session).create(
            episode.id,
            schemas.EpisodeAIRunCreate(idempotency_key="orchestrator-test"),
        )
        assert created is True
        return session_factory, run.id, episode.id


def test_run_once_dispatches_only_current_stage_and_persists_output(tmp_path):
    session_factory, run_id, episode_id = _seed_run(tmp_path)
    calls = []

    async def references(context: EpisodeAIStageContext):
        calls.append((context.stage, context.run_id, context.episode_id))
        return {"reference_ids": ["reference-1"]}

    async def panels(context: EpisodeAIStageContext):
        calls.append((context.stage, context.run_id, context.episode_id))
        return {"panel_ids": ["panel-1"]}

    orchestrator = EpisodeAIOrchestrator(
        session_factory,
        {"references": references, "panels": panels},
    )
    advanced = asyncio.run(orchestrator.run_once(run_id))

    assert calls == [("references", run_id, episode_id)]
    assert advanced.status == "queued"
    assert advanced.current_stage == "panels"
    references_stage = next(item for item in advanced.stages if item.stage == "references")
    panels_stage = next(item for item in advanced.stages if item.stage == "panels")
    assert references_stage.status == "succeeded"
    assert references_stage.output_metadata == {"reference_ids": ["reference-1"]}
    assert panels_stage.status == "pending"


def test_run_stops_after_pause_requested_during_current_stage(tmp_path):
    session_factory, run_id, _episode_id = _seed_run(tmp_path)
    calls = []

    async def references(context: EpisodeAIStageContext):
        calls.append(context.stage)
        with session_factory() as session:
            EpisodeAIRunService(session).pause(context.run_id)
        return {"reference_ids": ["reference-1"]}

    async def panels(context: EpisodeAIStageContext):
        calls.append(context.stage)
        return {"panel_ids": ["panel-1"]}

    stopped = asyncio.run(
        EpisodeAIOrchestrator(
            session_factory,
            {"references": references, "panels": panels},
        ).run(run_id)
    )

    assert calls == ["references"]
    assert stopped.status == "paused"
    assert stopped.pause_requested is True
    assert stopped.current_stage == "panels"
    assert next(item for item in stopped.stages if item.stage == "references").status == "succeeded"


def test_critical_stage_failure_requires_review_and_preserves_attempt(tmp_path):
    session_factory, run_id, _episode_id = _seed_run(tmp_path)

    async def references(_context: EpisodeAIStageContext):
        raise EpisodeAIStageNeedsReview(
            "角色参考图连续性不足",
            metadata={
                "code": "shot_generation_not_ready",
                "blocked_shots": {
                    "shot-1": {
                        "blockers": ["missing_character_reference"],
                        "requirement_ids": ["requirement-1"],
                    }
                },
            },
        )

    blocked = asyncio.run(
        EpisodeAIOrchestrator(session_factory, {"references": references}).run_once(run_id)
    )

    stage = next(item for item in blocked.stages if item.stage == "references")
    assert blocked.status == "needs_review"
    assert blocked.error == "角色参考图连续性不足"
    assert stage.status == "needs_review"
    assert stage.attempt_count == 1
    assert stage.output_metadata == {
        "code": "shot_generation_not_ready",
        "blocked_shots": {
            "shot-1": {
                "blockers": ["missing_character_reference"],
                "requirement_ids": ["requirement-1"],
            }
        },
    }


def test_unexpected_stage_failure_is_retryable_failed_run(tmp_path):
    session_factory, run_id, _episode_id = _seed_run(tmp_path)

    async def references(_context: EpisodeAIStageContext):
        raise RuntimeError("provider unavailable")

    failed = asyncio.run(
        EpisodeAIOrchestrator(session_factory, {"references": references}).run_once(run_id)
    )

    stage = next(item for item in failed.stages if item.stage == "references")
    assert failed.status == "failed"
    assert failed.error == "RuntimeError: provider unavailable"
    assert stage.status == "failed"
    assert stage.attempt_count == 1


def test_recovery_marks_interrupted_running_stage_as_retryable(tmp_path):
    session_factory, run_id, _episode_id = _seed_run(tmp_path)
    with session_factory() as session:
        EpisodeAIRunService(session).start_current(run_id)

    recovered_ids = EpisodeAIOrchestrator(session_factory, {}).recover_interrupted()

    assert recovered_ids == [run_id]
    with session_factory() as session:
        recovered = EpisodeAIRunService(session).get(run_id)
        stage = next(item for item in recovered.stages if item.stage == "references")
        assert recovered.status == "failed"
        assert recovered.error == "AI stage was interrupted by API restart"
        assert stage.status == "failed"
        assert stage.output_metadata == {
            "error_code": "api_interrupted",
            "retryable": True,
        }
        assert stage.attempt_count == 1
