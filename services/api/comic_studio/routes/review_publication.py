from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.services.review_publication import (
    ReleaseBlockedError,
    ReleaseConflictError,
    ReviewPublicationReferenceError,
    ReviewPublicationService,
)


router = APIRouter(tags=["review-publication"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("/api/episodes/{episode_id}/review-threads",response_model=schemas.ReviewThreadRead,status_code=status.HTTP_201_CREATED)
def create_review_thread(episode_id:str,data:schemas.ReviewThreadCreate,session:SessionDependency):
    try: thread=ReviewPublicationService(session).create_review_thread(episode_id,data)
    except ReviewPublicationReferenceError as exc: raise HTTPException(422,str(exc)) from exc
    if thread is None: raise HTTPException(404,"Episode not found")
    return thread


@router.get("/api/episodes/{episode_id}/review-threads",response_model=list[schemas.ReviewThreadRead])
def list_review_threads(episode_id:str,session:SessionDependency):
    threads=ReviewPublicationService(session).list_review_threads(episode_id)
    if threads is None: raise HTTPException(404,"Episode not found")
    return threads


@router.patch("/api/review-threads/{thread_id}",response_model=schemas.ReviewThreadRead)
def update_review_thread(thread_id:str,data:schemas.ReviewThreadPatch,session:SessionDependency):
    thread=ReviewPublicationService(session).update_review_thread(thread_id,data)
    if thread is None: raise HTTPException(404,"Review thread not found")
    return thread


@router.post("/api/review-threads/{thread_id}/messages",response_model=schemas.ReviewMessageRead,status_code=status.HTTP_201_CREATED)
def add_review_message(thread_id:str,data:schemas.ReviewMessageCreate,session:SessionDependency):
    message=ReviewPublicationService(session).add_review_message(thread_id,data)
    if message is None: raise HTTPException(404,"Review thread not found")
    return message


@router.post("/api/episodes/{episode_id}/release-candidates",response_model=schemas.ReleaseCandidateRead,status_code=status.HTTP_201_CREATED)
def create_release_candidate(episode_id:str,data:schemas.ReleaseCandidateCreate,request:Request,session:SessionDependency):
    try: candidate=ReviewPublicationService(session,request.app.state.settings.data_root).create_release_candidate(episode_id,data)
    except ReviewPublicationReferenceError as exc: raise HTTPException(422,str(exc)) from exc
    except ReleaseConflictError as exc: raise HTTPException(409,"Release version already exists") from exc
    if candidate is None: raise HTTPException(404,"Episode not found")
    return candidate


@router.get("/api/episodes/{episode_id}/release-candidates",response_model=list[schemas.ReleaseCandidateRead])
def list_release_candidates(episode_id:str,session:SessionDependency):
    candidates=ReviewPublicationService(session).list_release_candidates(episode_id)
    if candidates is None: raise HTTPException(404,"Episode not found")
    return candidates


@router.get("/api/release-candidates/{candidate_id}/gate",response_model=schemas.ReleaseGateRead)
def release_gate(candidate_id:str,request:Request,session:SessionDependency):
    gate=ReviewPublicationService(session,request.app.state.settings.data_root).gate(candidate_id)
    if gate is None: raise HTTPException(404,"Release candidate not found")
    return gate


@router.post("/api/release-candidates/{candidate_id}/approve",response_model=schemas.ReleaseCandidateRead)
def approve_release(candidate_id:str,request:Request,session:SessionDependency):
    try: candidate=ReviewPublicationService(session,request.app.state.settings.data_root).approve(candidate_id)
    except ReleaseBlockedError as exc: raise HTTPException(409,"Release candidate is blocked") from exc
    if candidate is None: raise HTTPException(404,"Release candidate not found")
    return candidate


@router.post("/api/release-candidates/{candidate_id}/publish",response_model=schemas.PublicationRead,status_code=status.HTTP_201_CREATED)
def publish_release(candidate_id:str,data:schemas.PublicationCreate,request:Request,response:Response,session:SessionDependency):
    try: record,created=ReviewPublicationService(session,request.app.state.settings.data_root).publish(candidate_id,data)
    except ReleaseBlockedError as exc: raise HTTPException(409,"Release candidate is blocked" if str(exc)=="blocked" else "Release candidate must be approved") from exc
    if record is None: raise HTTPException(404,"Release candidate not found")
    if not created: response.status_code=status.HTTP_200_OK
    return record
