from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from comic_studio import models, schemas
from comic_studio.db import get_session
from comic_studio.model_runtime.contracts import Capability, RuntimeJobRead
from comic_studio.services.visual_review import (
    VisualReviewReferenceError,
    VisualReviewService,
)


router = APIRouter(tags=["visual-review"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "/api/shots/{shot_id}/visual-review-threads",
    response_model=schemas.VisualReviewThreadRead,
    status_code=status.HTTP_201_CREATED,
)
def create_thread(
    shot_id: str,
    data: schemas.VisualReviewThreadCreate,
    session: SessionDependency,
):
    try:
        thread = VisualReviewService(session).create_thread(shot_id, data)
    except VisualReviewReferenceError as exc:
        raise HTTPException(422, str(exc)) from exc
    if thread is None:
        raise HTTPException(404, "Shot not found")
    return thread


@router.get(
    "/api/shots/{shot_id}/visual-review-threads",
    response_model=list[schemas.VisualReviewThreadRead],
)
def list_threads(shot_id: str, session: SessionDependency):
    threads = VisualReviewService(session).list_threads(shot_id)
    if threads is None:
        raise HTTPException(404, "Shot not found")
    return threads


@router.patch(
    "/api/visual-review-threads/{thread_id}",
    response_model=schemas.VisualReviewThreadRead,
)
def update_thread(
    thread_id: str,
    data: schemas.VisualReviewThreadPatch,
    session: SessionDependency,
):
    thread = VisualReviewService(session).update_thread(thread_id, data)
    if thread is None:
        raise HTTPException(404, "Visual review thread not found")
    return thread


@router.post(
    "/api/visual-review-threads/{thread_id}/annotations",
    response_model=schemas.VisualAnnotationRead,
    status_code=status.HTTP_201_CREATED,
)
def add_annotation(
    thread_id: str,
    data: schemas.VisualAnnotationCreate,
    session: SessionDependency,
):
    annotation = VisualReviewService(session).add_annotation(thread_id, data)
    if annotation is None:
        raise HTTPException(404, "Visual review thread not found")
    return annotation


@router.patch(
    "/api/visual-annotations/{annotation_id}",
    response_model=schemas.VisualAnnotationRead,
)
def update_annotation(
    annotation_id: str,
    data: schemas.VisualAnnotationPatch,
    session: SessionDependency,
):
    try:
        annotation = VisualReviewService(session).update_annotation(annotation_id, data)
    except VisualReviewReferenceError as exc:
        raise HTTPException(422, str(exc)) from exc
    if annotation is None:
        raise HTTPException(404, "Visual annotation not found")
    return annotation


@router.delete(
    "/api/visual-annotations/{annotation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_annotation(annotation_id: str, session: SessionDependency):
    if not VisualReviewService(session).delete_annotation(annotation_id):
        raise HTTPException(404, "Visual annotation not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/visual-review-threads/{thread_id}/messages",
    response_model=schemas.VisualReviewMessageRead,
    status_code=status.HTTP_201_CREATED,
)
def add_message(
    thread_id: str,
    data: schemas.VisualReviewMessageCreate,
    session: SessionDependency,
):
    message = VisualReviewService(session).add_message(thread_id, data)
    if message is None:
        raise HTTPException(404, "Visual review thread not found")
    return message


@router.post(
    "/api/visual-review-threads/{thread_id}/generate",
    response_model=RuntimeJobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def generate_candidate(
    thread_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    session: SessionDependency,
):
    if session.get(models.VisualReviewThread, thread_id) is None:
        raise HTTPException(404, "Visual review thread not found")
    job = request.app.state.model_runtime.create_media_job(
        Capability.IMAGE, "visual_review", thread_id, {"activate": False}
    )
    background_tasks.add_task(request.app.state.model_runtime.run_media_job, job.id)
    return RuntimeJobRead(
        job_id=job.id, capability=Capability.IMAGE, status=job.status
    )


@router.post(
    "/api/visual-review-threads/{thread_id}/candidates",
    response_model=schemas.VisualReviewCandidateRead,
    status_code=status.HTTP_201_CREATED,
)
def add_candidate(
    thread_id: str,
    data: schemas.VisualReviewCandidateCreate,
    session: SessionDependency,
):
    try:
        candidate = VisualReviewService(session).add_candidate(thread_id, data)
    except VisualReviewReferenceError as exc:
        raise HTTPException(422, str(exc)) from exc
    if candidate is None:
        raise HTTPException(404, "Visual review thread not found")
    return candidate


@router.post(
    "/api/visual-review-candidates/{candidate_id}/accept",
    response_model=schemas.VisualReviewCandidateRead,
)
def accept_candidate(
    candidate_id: str,
    session: SessionDependency,
    data: schemas.VisualReviewCandidateAccept | None = None,
):
    try:
        candidate = VisualReviewService(session).accept_candidate(
            candidate_id,
            target_character_id=data.target_character_id if data else None,
        )
    except VisualReviewReferenceError as exc:
        raise HTTPException(409, str(exc)) from exc
    if candidate is None:
        raise HTTPException(404, "Visual review candidate not found")
    return candidate


@router.post(
    "/api/visual-review-candidates/{candidate_id}/reject",
    response_model=schemas.VisualReviewCandidateRead,
)
def reject_candidate(candidate_id: str, session: SessionDependency):
    try:
        candidate = VisualReviewService(session).reject_candidate(candidate_id)
    except VisualReviewReferenceError as exc:
        raise HTTPException(409, str(exc)) from exc
    if candidate is None:
        raise HTTPException(404, "Visual review candidate not found")
    return candidate
