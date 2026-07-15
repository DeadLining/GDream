from fastapi import APIRouter, HTTPException, Response, status

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.services.episode_ai_runs import (
    EpisodeAIRunConflict,
    EpisodeAIRunService,
    InvalidEpisodeAIRunTransition,
)
from typing import Annotated
from fastapi import Depends
from sqlalchemy.orm import Session


router = APIRouter(tags=["episode-ai-runs"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "/api/episodes/{episode_id}/ai-runs",
    response_model=schemas.EpisodeAIRunRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_episode_ai_run(
    episode_id: str,
    data: schemas.EpisodeAIRunCreate,
    response: Response,
    session: SessionDependency,
):
    try:
        run, _created = EpisodeAIRunService(session).create(episode_id, data)
    except EpisodeAIRunConflict as exc:
        raise HTTPException(409, "Episode already has an active AI run") from exc
    if run is None:
        raise HTTPException(404, "Episode not found")
    response.status_code = status.HTTP_202_ACCEPTED
    return run


@router.get(
    "/api/episodes/{episode_id}/ai-runs/active",
    response_model=schemas.EpisodeAIRunRead,
)
def get_active_episode_ai_run(episode_id: str, session: SessionDependency):
    run = EpisodeAIRunService(session).active(episode_id)
    if run is None:
        raise HTTPException(404, "Active episode AI run not found")
    return run


@router.get("/api/episode-ai-runs/{run_id}", response_model=schemas.EpisodeAIRunRead)
def get_episode_ai_run(run_id: str, session: SessionDependency):
    run = EpisodeAIRunService(session).get(run_id)
    if run is None:
        raise HTTPException(404, "Episode AI run not found")
    return run


def _transition(action, run_id: str):
    try:
        run = action(run_id)
    except InvalidEpisodeAIRunTransition as exc:
        raise HTTPException(409, str(exc)) from exc
    if run is None:
        raise HTTPException(404, "Episode AI run not found")
    return run


@router.post("/api/episode-ai-runs/{run_id}/pause", response_model=schemas.EpisodeAIRunRead)
def pause_episode_ai_run(run_id: str, session: SessionDependency):
    return _transition(EpisodeAIRunService(session).pause, run_id)


@router.post(
    "/api/episode-ai-runs/{run_id}/continue",
    response_model=schemas.EpisodeAIRunRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def continue_episode_ai_run(run_id: str, session: SessionDependency):
    return _transition(EpisodeAIRunService(session).resume, run_id)


@router.post("/api/episode-ai-runs/{run_id}/cancel", response_model=schemas.EpisodeAIRunRead)
def cancel_episode_ai_run(run_id: str, session: SessionDependency):
    return _transition(EpisodeAIRunService(session).cancel, run_id)


@router.post(
    "/api/episode-ai-runs/{run_id}/retry",
    response_model=schemas.EpisodeAIRunRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_episode_ai_run(run_id: str, session: SessionDependency):
    return _transition(EpisodeAIRunService(session).retry, run_id)
