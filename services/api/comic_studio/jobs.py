from typing import Any

from sqlalchemy.orm import Session

from comic_studio.models import Job
from comic_studio.redaction import redact


class InvalidJobTransition(ValueError):
    pass


ALLOWED_TRANSITIONS = {
    "queued": {"running"},
    "running": {"succeeded", "failed"},
    "failed": {"queued"},
    "succeeded": set(),
}


class JobStore:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        operation: str,
        target_type: str,
        target_id: str,
        request_payload: dict[str, Any],
    ) -> Job:
        job = Job(
            operation=operation,
            target_type=target_type,
            target_id=target_id,
            request_payload=request_payload,
        )
        self.session.add(job)
        self.session.commit()
        self.session.refresh(job)
        return job

    def get(self, job_id: str) -> Job | None:
        return self.session.get(Job, job_id)

    def transition(
        self,
        job_id: str,
        next_status: str,
        *,
        progress: int | None = None,
        result_metadata: dict[str, Any] | None = None,
        error: str = "",
    ) -> Job:
        job = self.session.get(Job, job_id)
        if job is None:
            raise KeyError(job_id)
        if next_status not in ALLOWED_TRANSITIONS.get(job.status, set()):
            raise InvalidJobTransition(f"Cannot transition {job.status} to {next_status}")
        if job.status == "failed" and next_status == "queued":
            job.retry_count += 1
            job.error = ""
            job.progress = 0
            job.result_metadata = {}
        else:
            job.error = str(redact(error))[:4000]
        job.status = next_status
        if progress is not None:
            job.progress = max(0, min(100, progress))
        elif next_status == "succeeded":
            job.progress = 100
        if result_metadata is not None:
            job.result_metadata = result_metadata
        self.session.commit()
        self.session.refresh(job)
        return job

    def interrupt_running(self, job_id: str) -> Job:
        job = self.get(job_id)
        if job is None or job.status != "running":
            raise InvalidJobTransition("Only running jobs can be interrupted")
        job.status = "failed"
        job.error = "Model runtime was interrupted"
        job.result_metadata = {
            "error_code": "runtime_interrupted",
            "retryable": True,
        }
        self.session.commit()
        self.session.refresh(job)
        return job
