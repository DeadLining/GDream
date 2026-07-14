from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from pydantic import ValidationError

from comic_studio import models, schemas


class VisualReviewReferenceError(ValueError):
    pass


class VisualReviewService:
    def __init__(self, session: Session):
        self.session = session

    @staticmethod
    def _shot_project_id(shot: models.Shot) -> str:
        return shot.scene.episode.project_id

    def create_thread(
        self, shot_id: str, data: schemas.VisualReviewThreadCreate
    ):
        shot = self.session.get(models.Shot, shot_id)
        if shot is None:
            return None
        if data.source_asset_id:
            asset = self.session.get(models.Asset, data.source_asset_id)
            if asset is None or asset.project_id != self._shot_project_id(shot):
                raise VisualReviewReferenceError(
                    "Source asset must belong to the shot project"
                )
        thread = models.VisualReviewThread(
            episode_id=shot.scene.episode.id,
            shot_id=shot.id,
            status="open",
            **data.model_dump(),
        )
        self.session.add(thread)
        self.session.commit()
        self.session.refresh(thread)
        return thread

    def list_threads(self, shot_id: str):
        if self.session.get(models.Shot, shot_id) is None:
            return None
        statement = (
            select(models.VisualReviewThread)
            .options(
                selectinload(models.VisualReviewThread.annotations),
                selectinload(models.VisualReviewThread.messages),
                selectinload(models.VisualReviewThread.candidates),
            )
            .where(models.VisualReviewThread.shot_id == shot_id)
            .order_by(models.VisualReviewThread.created_at)
        )
        return list(self.session.scalars(statement))

    def update_thread(
        self, thread_id: str, data: schemas.VisualReviewThreadPatch
    ):
        thread = self.session.get(models.VisualReviewThread, thread_id)
        if thread is None:
            return None
        thread.modification_scope = data.modification_scope
        self.session.commit()
        self.session.refresh(thread)
        return thread

    def add_annotation(
        self, thread_id: str, data: schemas.VisualAnnotationCreate
    ):
        if self.session.get(models.VisualReviewThread, thread_id) is None:
            return None
        annotation = models.VisualAnnotation(thread_id=thread_id, **data.model_dump())
        self.session.add(annotation)
        self.session.commit()
        self.session.refresh(annotation)
        return annotation

    def update_annotation(
        self, annotation_id: str, data: schemas.VisualAnnotationPatch
    ):
        annotation = self.session.get(models.VisualAnnotation, annotation_id)
        if annotation is None:
            return None
        current = {
            "kind": annotation.kind,
            "geometry": annotation.geometry,
            "color": annotation.color,
            "label": annotation.label,
        }
        try:
            merged = schemas.VisualAnnotationCreate.model_validate(
                {**current, **data.model_dump(exclude_unset=True)}
            )
        except ValidationError as exc:
            raise VisualReviewReferenceError("Invalid annotation geometry") from exc
        for key, value in merged.model_dump().items():
            setattr(annotation, key, value)
        self.session.commit()
        self.session.refresh(annotation)
        return annotation

    def delete_annotation(self, annotation_id: str):
        annotation = self.session.get(models.VisualAnnotation, annotation_id)
        if annotation is None:
            return False
        self.session.delete(annotation)
        self.session.commit()
        return True

    def add_message(
        self, thread_id: str, data: schemas.VisualReviewMessageCreate
    ):
        if self.session.get(models.VisualReviewThread, thread_id) is None:
            return None
        message = models.VisualReviewMessage(thread_id=thread_id, **data.model_dump())
        self.session.add(message)
        self.session.commit()
        self.session.refresh(message)
        return message

    def add_candidate(
        self, thread_id: str, data: schemas.VisualReviewCandidateCreate
    ):
        thread = self.session.get(models.VisualReviewThread, thread_id)
        if thread is None:
            return None
        asset = self.session.get(models.Asset, data.asset_id)
        if asset is None or asset.project_id != self._shot_project_id(thread.shot):
            raise VisualReviewReferenceError(
                "Candidate asset must belong to the shot project"
            )
        candidate = models.VisualReviewCandidate(
            thread_id=thread.id, status="ready", **data.model_dump()
        )
        self.session.add(candidate)
        self.session.commit()
        self.session.refresh(candidate)
        return candidate

    def accept_candidate(self, candidate_id: str):
        candidate = self.session.get(models.VisualReviewCandidate, candidate_id)
        if candidate is None:
            return None
        if candidate.status != "ready":
            raise VisualReviewReferenceError("Candidate is not ready for acceptance")
        thread = candidate.thread
        shot = thread.shot
        asset = self.session.get(models.Asset, candidate.asset_id)
        if asset is None or asset.project_id != self._shot_project_id(shot):
            raise VisualReviewReferenceError(
                "Candidate asset must belong to the shot project"
            )
        for other in thread.candidates:
            if other.id != candidate.id and other.status == "ready":
                other.status = "rejected"
        candidate.status = "accepted"
        thread.status = "resolved"
        asset.review_status = "approved"
        shot.active_panel_asset_id = asset.id
        shot.review_status = "draft"
        self.session.commit()
        self.session.refresh(candidate)
        return candidate

    def reject_candidate(self, candidate_id: str):
        candidate = self.session.get(models.VisualReviewCandidate, candidate_id)
        if candidate is None:
            return None
        if candidate.status != "ready":
            raise VisualReviewReferenceError("Candidate is not ready for rejection")
        candidate.status = "rejected"
        self.session.commit()
        self.session.refresh(candidate)
        return candidate
