from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from comic_studio import models
from comic_studio.services.episode_ai_runs import EpisodeAIRunService


@dataclass(frozen=True)
class EpisodeAIStageContext:
    run_id: str
    episode_id: str
    stage: str
    automation_policy: dict


class EpisodeAIStageNeedsReview(RuntimeError):
    def __init__(self, message: str, *, metadata: dict | None = None):
        super().__init__(message)
        self.metadata = metadata or {}


def shot_generation_needs_review(
    blocked_shots: dict[str, dict],
) -> EpisodeAIStageNeedsReview:
    return EpisodeAIStageNeedsReview(
        "Shot generation is not ready",
        metadata={
            "code": "shot_generation_not_ready",
            "blocked_shots": blocked_shots,
        },
    )


EpisodeAIStageHandler = Callable[[EpisodeAIStageContext], Awaitable[dict]]


class EpisodeAIOrchestrator:
    def __init__(self, session_factory, handlers: dict[str, EpisodeAIStageHandler]):
        self.session_factory = session_factory
        self.handlers = handlers

    async def run_once(self, run_id: str) -> models.EpisodeAIRun:
        with self.session_factory() as session:
            service = EpisodeAIRunService(session)
            run = service.get(run_id)
            if run is None:
                raise KeyError(run_id)
            if run.status != "queued" or run.pause_requested:
                return run
            running = service.start_current(run_id)
            context = EpisodeAIStageContext(
                run_id=running.id,
                episode_id=running.episode_id,
                stage=running.current_stage,
                automation_policy=dict(running.automation_policy),
            )

        try:
            handler = self.handlers[context.stage]
            output = await handler(context)
        except EpisodeAIStageNeedsReview as exc:
            with self.session_factory() as session:
                return EpisodeAIRunService(session).fail_current(
                    run_id,
                    str(exc),
                    needs_review=True,
                    output_metadata=exc.metadata,
                )
        except Exception as exc:
            with self.session_factory() as session:
                return EpisodeAIRunService(session).fail_current(
                    run_id, f"{type(exc).__name__}: {exc}"
                )

        with self.session_factory() as session:
            return EpisodeAIRunService(session).complete_current(run_id, output)

    async def run(self, run_id: str) -> models.EpisodeAIRun:
        while True:
            run = await self.run_once(run_id)
            if run.status != "queued" or run.pause_requested:
                return run

    def recover_interrupted(self) -> list[str]:
        with self.session_factory() as session:
            runs = list(
                session.scalars(
                    select(models.EpisodeAIRun)
                    .options(selectinload(models.EpisodeAIRun.stages))
                    .where(models.EpisodeAIRun.status == "running")
                    .order_by(models.EpisodeAIRun.created_at)
                )
            )
            recovered = []
            for run in runs:
                stage = next(
                    (
                        item
                        for item in run.stages
                        if item.stage == run.current_stage and item.status == "running"
                    ),
                    None,
                )
                if stage is None:
                    continue
                error = "AI stage was interrupted by API restart"
                stage.status = "failed"
                stage.error = error
                stage.output_metadata = {
                    "error_code": "api_interrupted",
                    "retryable": True,
                }
                stage.completed_at = models.utc_now()
                run.status = "failed"
                run.error = error
                recovered.append(run.id)
            session.commit()
            return recovered
