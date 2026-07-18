from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from comic_studio import models, schemas
from comic_studio.models import utc_now
from comic_studio.services.readiness import ReadinessService
from comic_studio.services.rendering import RenderingService


class ReviewPublicationReferenceError(ValueError):
    pass


class ReleaseBlockedError(RuntimeError):
    pass


class ReleaseConflictError(RuntimeError):
    pass


class ReviewPublicationService:
    def __init__(self, session: Session, data_root: Path | None = None):
        self.session = session
        self.data_root = data_root.resolve() if data_root is not None else None

    def _render_review_for_candidate(
        self, episode: models.Episode, render_path: str
    ) -> models.RenderReviewRecord:
        if self.data_root is None:
            raise ReviewPublicationReferenceError("Render data root is unavailable")
        relative_path = Path(render_path)
        expected_root = Path("projects") / episode.project_id / "episodes" / episode.id / "renders"
        try:
            relative_path.relative_to(expected_root)
        except ValueError as exc:
            raise ReviewPublicationReferenceError(
                "Render path must belong to the release episode"
            ) from exc
        output_path = (self.data_root / relative_path).resolve()
        if not output_path.is_file():
            raise ReviewPublicationReferenceError("Render file does not exist")
        jobs = self.session.scalars(
            select(models.Job)
            .where(
                models.Job.operation == "render_episode",
                models.Job.target_type == "episode",
                models.Job.target_id == episode.id,
                models.Job.status == "succeeded",
            )
            .order_by(models.Job.created_at.desc())
        )
        job = next(
            (
                item
                for item in jobs
                if item.result_metadata.get("output_path") == render_path
            ),
            None,
        )
        if job is None:
            raise ReviewPublicationReferenceError(
                "Render path must come from a successful episode render"
            )
        review = self.session.scalar(
            select(models.RenderReviewRecord)
            .where(
                models.RenderReviewRecord.episode_id == episode.id,
                models.RenderReviewRecord.job_id == job.id,
            )
            .order_by(models.RenderReviewRecord.created_at.desc())
        )
        if review is None:
            raise ReviewPublicationReferenceError(
                "Successful render must have a completed quality review"
            )
        if not self._render_job_is_current(episode, job):
            raise ReviewPublicationReferenceError(
                "Successful render does not match current episode inputs"
            )
        stored_path = Path(review.render_path)
        if not stored_path.is_absolute():
            stored_path = self.data_root / stored_path
        if stored_path.resolve() != output_path:
            raise ReviewPublicationReferenceError(
                "Quality review does not match the rendered file"
            )
        return review

    def _render_job_is_current(
        self,
        episode: models.Episode,
        job: models.Job | None,
    ) -> bool:
        if self.data_root is None or job is None:
            return False
        stored_hash = job.result_metadata.get("input_snapshot_hash")
        if not isinstance(stored_hash, str) or not stored_hash:
            return False
        try:
            current_hash = RenderingService(
                self.session,
                self.data_root,
                self.data_root,
            ).input_snapshot_hash(episode.id)
        except (KeyError, RuntimeError, ValueError):
            return False
        return stored_hash == current_hash

    def _candidate_render_is_current(
        self,
        candidate: models.ReleaseCandidate,
    ) -> bool:
        job_id = candidate.qc_snapshot.get("job_id")
        job = self.session.get(models.Job, job_id) if isinstance(job_id, str) else None
        episode = self.session.get(models.Episode, candidate.episode_id)
        return episode is not None and self._render_job_is_current(episode, job)

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
        episode = self.session.get(models.Episode, episode_id)
        if episode is None:
            return None
        from comic_studio.services.render_review import review_to_payload

        review = self._render_review_for_candidate(episode, data.render_path)
        candidate = models.ReleaseCandidate(
            episode_id=episode_id,
            status="draft",
            version=data.version,
            render_path=data.render_path,
            qc_snapshot=review_to_payload(review),
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
        production_ready = bool(readiness and readiness["video_ready"])
        qc_pass = candidate.qc_snapshot.get("overall_pass") is True
        render_current = self._candidate_render_is_current(candidate)
        blockers = dict((readiness or {}).get("blockers", {}))
        if not render_current:
            blockers["stale_render"] = [candidate.id]
        return schemas.ReleaseGateRead(
            ready=production_ready and qc_pass and render_current and not open_critical,
            production_ready=production_ready,
            production_blockers=blockers,
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
        if not self.gate(candidate.id).ready:
            raise ReleaseBlockedError("blocked")
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
