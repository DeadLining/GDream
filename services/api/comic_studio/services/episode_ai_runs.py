from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from comic_studio import models, schemas
from comic_studio.redaction import redact


EPISODE_AI_STAGES = [
    "scripting",
    "structuring",
    "references",
    "panels",
    "panel_review",
    "speech",
    "videos",
    "rendering",
    "quality_review",
    "release_candidate",
    "release_gate",
    "published",
]


class EpisodeAIRunConflict(RuntimeError):
    pass


class InvalidEpisodeAIRunTransition(RuntimeError):
    pass


class EpisodeAIRunService:
    def __init__(self, session: Session):
        self.session = session

    def get(self, run_id: str) -> models.EpisodeAIRun | None:
        return self.session.scalar(
            select(models.EpisodeAIRun)
            .options(selectinload(models.EpisodeAIRun.stages))
            .where(models.EpisodeAIRun.id == run_id)
        )

    def active(self, episode_id: str) -> models.EpisodeAIRun | None:
        return self.session.scalar(
            select(models.EpisodeAIRun)
            .options(selectinload(models.EpisodeAIRun.stages))
            .where(
                models.EpisodeAIRun.episode_id == episode_id,
                models.EpisodeAIRun.active_slot == "active",
            )
            .order_by(models.EpisodeAIRun.created_at.desc())
        )

    def create(
        self, episode_id: str, data: schemas.EpisodeAIRunCreate
    ) -> tuple[models.EpisodeAIRun | None, bool]:
        if self.session.get(models.Episode, episode_id) is None:
            return None, False
        existing = self.session.scalar(
            select(models.EpisodeAIRun)
            .options(selectinload(models.EpisodeAIRun.stages))
            .where(
                models.EpisodeAIRun.episode_id == episode_id,
                models.EpisodeAIRun.idempotency_key == data.idempotency_key,
            )
        )
        if existing is not None:
            return existing, False
        if self.active(episode_id) is not None:
            raise EpisodeAIRunConflict("active_run")

        run = models.EpisodeAIRun(
            episode_id=episode_id,
            status="queued",
            current_stage="references",
            progress=0,
            automation_policy=data.automation_policy,
            idempotency_key=data.idempotency_key,
            active_slot="active",
        )
        self.session.add(run)
        self.session.flush()
        for position, stage in enumerate(EPISODE_AI_STAGES, start=1):
            skipped = stage in {"scripting", "structuring"}
            self.session.add(
                models.EpisodeAIRunStage(
                    run_id=run.id,
                    stage=stage,
                    position=position,
                    status="skipped" if skipped else "pending",
                    output_metadata={"reason": "existing_structure"} if skipped else {},
                    completed_at=models.utc_now() if skipped else None,
                )
            )
        run.progress = self._progress(2)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise EpisodeAIRunConflict("active_run") from exc
        return self.get(run.id), True

    @staticmethod
    def _progress(done: int) -> int:
        return int(done * 100 / len(EPISODE_AI_STAGES))

    @staticmethod
    def _current(run: models.EpisodeAIRun) -> models.EpisodeAIRunStage:
        stage = next((item for item in run.stages if item.stage == run.current_stage), None)
        if stage is None:
            raise InvalidEpisodeAIRunTransition("current_stage_missing")
        return stage

    def _save(self, run: models.EpisodeAIRun) -> models.EpisodeAIRun:
        self.session.commit()
        return self.get(run.id)

    def pause(self, run_id: str) -> models.EpisodeAIRun | None:
        run = self.get(run_id)
        if run is None:
            return None
        if run.status not in {"queued", "running"}:
            raise InvalidEpisodeAIRunTransition("run_cannot_pause")
        run.status = "paused"
        run.pause_requested = True
        return self._save(run)

    def resume(self, run_id: str) -> models.EpisodeAIRun | None:
        run = self.get(run_id)
        if run is None:
            return None
        if run.status != "paused":
            raise InvalidEpisodeAIRunTransition("run_cannot_continue")
        run.status = "queued"
        run.pause_requested = False
        return self._save(run)

    def cancel(self, run_id: str) -> models.EpisodeAIRun | None:
        run = self.get(run_id)
        if run is None:
            return None
        if run.active_slot is None:
            raise InvalidEpisodeAIRunTransition("run_not_active")
        run.status = "cancelled"
        run.active_slot = None
        run.pause_requested = False
        return self._save(run)

    def start_current(self, run_id: str) -> models.EpisodeAIRun:
        run = self.get(run_id)
        if run is None:
            raise KeyError(run_id)
        if run.status not in {"queued", "running"}:
            raise InvalidEpisodeAIRunTransition("run_cannot_start")
        stage = self._current(run)
        if stage.status != "pending":
            raise InvalidEpisodeAIRunTransition("stage_not_pending")
        run.status = "running"
        run.error = ""
        stage.status = "running"
        stage.attempt_count += 1
        stage.started_at = models.utc_now()
        stage.completed_at = None
        return self._save(run)

    def fail_current(
        self,
        run_id: str,
        error: str,
        *,
        needs_review: bool = False,
        output_metadata: dict | None = None,
    ) -> models.EpisodeAIRun:
        run = self.get(run_id)
        if run is None:
            raise KeyError(run_id)
        stage = self._current(run)
        if stage.status != "running":
            raise InvalidEpisodeAIRunTransition("stage_not_running")
        status = "needs_review" if needs_review else "failed"
        safe_error = str(redact(error))[:4000]
        stage.status = status
        stage.error = safe_error
        stage.output_metadata = redact(output_metadata or {})
        stage.completed_at = models.utc_now()
        run.status = status
        run.error = safe_error
        return self._save(run)

    def retry(self, run_id: str) -> models.EpisodeAIRun | None:
        run = self.get(run_id)
        if run is None:
            return None
        if run.status not in {"failed", "needs_review"}:
            raise InvalidEpisodeAIRunTransition("run_cannot_retry")
        stage = self._current(run)
        if stage.status not in {"failed", "needs_review"}:
            raise InvalidEpisodeAIRunTransition("stage_cannot_retry")
        stage.status = "pending"
        stage.error = ""
        stage.output_metadata = {}
        stage.completed_at = None
        run.status = "queued"
        run.error = ""
        return self._save(run)

    def complete_current(
        self, run_id: str, output_metadata: dict
    ) -> models.EpisodeAIRun:
        run = self.get(run_id)
        if run is None:
            raise KeyError(run_id)
        stage = self._current(run)
        if stage.status != "running":
            raise InvalidEpisodeAIRunTransition("stage_not_running")
        stage.status = "succeeded"
        stage.output_metadata = redact(output_metadata)
        stage.error = ""
        stage.completed_at = models.utc_now()
        done = sum(item.status in {"succeeded", "skipped"} for item in run.stages)
        run.progress = self._progress(done)
        next_stage = next(
            (item for item in run.stages if item.position > stage.position and item.status == "pending"),
            None,
        )
        if run.status == "cancelled":
            pass
        elif next_stage is None:
            run.status = "completed"
            run.active_slot = None
            run.progress = 100
        else:
            run.current_stage = next_stage.stage
            run.status = "paused" if run.pause_requested else "queued"
        run.error = ""
        return self._save(run)
