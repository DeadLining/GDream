from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from comic_studio import models, schemas
from comic_studio.models import utc_now
from comic_studio.services.readiness import ReadinessService


class ReviewPublicationReferenceError(ValueError):
    pass


class ReleaseBlockedError(RuntimeError):
    pass


class ReleaseConflictError(RuntimeError):
    pass


class ReviewPublicationService:
    def __init__(self, session: Session):
        self.session = session

    def create_review_thread(
        self, episode_id: str, data: schemas.ReviewThreadCreate
    ):
        episode = self.session.get(models.Episode, episode_id)
        if episode is None:
            return None
        if data.shot_id:
            shot = self.session.get(models.Shot, data.shot_id)
            if shot is None or shot.scene.episode_id != episode.id:
                raise ReviewPublicationReferenceError(
                    "Shot must belong to the review episode"
                )
        thread = models.ReviewThread(
            episode_id=episode.id, status="open", **data.model_dump()
        )
        self.session.add(thread)
        self.session.commit()
        self.session.refresh(thread)
        return thread

    def list_review_threads(self, episode_id: str):
        if self.session.get(models.Episode, episode_id) is None:
            return None
        statement = (
            select(models.ReviewThread)
            .options(selectinload(models.ReviewThread.messages))
            .where(models.ReviewThread.episode_id == episode_id)
            .order_by(models.ReviewThread.created_at)
        )
        return list(self.session.scalars(statement))

    def update_review_thread(
        self, thread_id: str, data: schemas.ReviewThreadPatch
    ):
        thread = self.session.get(models.ReviewThread, thread_id)
        if thread is None:
            return None
        thread.status = data.status
        self.session.commit()
        self.session.refresh(thread)
        return thread

    def add_review_message(
        self, thread_id: str, data: schemas.ReviewMessageCreate
    ):
        if self.session.get(models.ReviewThread, thread_id) is None:
            return None
        message = models.ReviewMessage(thread_id=thread_id, **data.model_dump())
        self.session.add(message)
        self.session.commit()
        self.session.refresh(message)
        return message

    def create_release_candidate(
        self, episode_id: str, data: schemas.ReleaseCandidateCreate
    ):
        if self.session.get(models.Episode, episode_id) is None:
            return None
        candidate = models.ReleaseCandidate(
            episode_id=episode_id, status="draft", **data.model_dump()
        )
        self.session.add(candidate)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise ReleaseConflictError("version") from exc
        self.session.refresh(candidate)
        return candidate

    def list_release_candidates(self, episode_id: str):
        if self.session.get(models.Episode, episode_id) is None:
            return None
        statement = (
            select(models.ReleaseCandidate)
            .where(models.ReleaseCandidate.episode_id == episode_id)
            .order_by(models.ReleaseCandidate.version, models.ReleaseCandidate.created_at)
        )
        return list(self.session.scalars(statement))

    def gate(self, candidate_id: str):
        candidate = self.session.get(models.ReleaseCandidate, candidate_id)
        if candidate is None:
            return None
        readiness = ReadinessService(self.session).inspect(candidate.episode_id)
        statement = select(models.ReviewThread.id).where(
            models.ReviewThread.episode_id == candidate.episode_id,
            models.ReviewThread.severity == "critical",
            models.ReviewThread.status == "open",
        )
        open_critical = list(self.session.scalars(statement))
        production_ready = bool(readiness and readiness["ready"])
        return schemas.ReleaseGateRead(
            ready=production_ready and not open_critical,
            production_ready=production_ready,
            production_blockers=(readiness or {}).get("blockers", {}),
            open_critical_threads=open_critical,
        )

    def approve(self, candidate_id: str):
        candidate = self.session.get(models.ReleaseCandidate, candidate_id)
        if candidate is None:
            return None
        gate = self.gate(candidate.id)
        if not gate.ready:
            raise ReleaseBlockedError("blocked")
        candidate.status = "approved"
        self.session.commit()
        self.session.refresh(candidate)
        return candidate

    def publish(
        self, candidate_id: str, data: schemas.PublicationCreate
    ):
        candidate = self.session.get(models.ReleaseCandidate, candidate_id)
        if candidate is None:
            return None, False
        statement = select(models.PublicationRecord).where(
            models.PublicationRecord.candidate_id == candidate.id,
            models.PublicationRecord.platform == data.platform,
            models.PublicationRecord.idempotency_key == data.idempotency_key,
        )
        existing = self.session.scalar(statement)
        if existing is not None:
            return existing, False
        if candidate.status not in {"approved", "published"}:
            raise ReleaseBlockedError("candidate_not_approved")
        record = models.PublicationRecord(
            candidate_id=candidate.id,
            platform=data.platform,
            idempotency_key=data.idempotency_key,
            external_reference=f"local:{candidate.id}:{data.platform}",
            status="published",
            published_at=utc_now(),
        )
        candidate.status = "published"
        self.session.add(record)
        self.session.commit()
        self.session.refresh(record)
        return record, True
