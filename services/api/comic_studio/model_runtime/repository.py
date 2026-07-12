from sqlalchemy import select

from comic_studio import models
from comic_studio.jobs import JobStore
from comic_studio.model_runtime.contracts import Capability


class InvocationRepository:
    def __init__(self, session):
        self.session = session

    def start(
        self,
        capability: Capability,
        provider: str,
        model: str,
        target_type: str = "",
        target_id: str = "",
        job_id: str | None = None,
    ) -> models.ModelInvocation:
        item = models.ModelInvocation(
            capability=capability.value,
            provider=provider,
            model=model,
            target_type=target_type,
            target_id=target_id,
            job_id=job_id,
            status="running",
        )
        self.session.add(item)
        self.session.commit()
        self.session.refresh(item)
        return item

    def finish(
        self,
        invocation_id: str,
        *,
        status: str,
        elapsed_ms: int,
        error_code: str = "",
        retryable: bool = False,
    ) -> models.ModelInvocation:
        item = self.session.get(models.ModelInvocation, invocation_id)
        if item is None:
            raise KeyError(invocation_id)
        item.status = status
        item.elapsed_ms = max(0, elapsed_ms)
        item.error_code = error_code
        item.retryable = retryable
        self.session.commit()
        self.session.refresh(item)
        return item

    def list_recent(self, limit: int = 50) -> list[models.ModelInvocation]:
        statement = (
            select(models.ModelInvocation)
            .order_by(models.ModelInvocation.created_at.desc())
            .limit(limit)
        )
        return list(self.session.scalars(statement))

    def recover_running_jobs(self) -> list[str]:
        jobs = list(
            self.session.scalars(
                select(models.Job).where(
                    models.Job.status == "running",
                    models.Job.operation.like("runtime_%"),
                )
            )
        )
        store = JobStore(self.session)
        for job in jobs:
            store.interrupt_running(job.id)
        return [job.id for job in jobs]
