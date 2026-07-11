from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.repositories import EpisodeRepository


router = APIRouter(tags=["episodes"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "/api/projects/{project_id}/episodes",
    response_model=schemas.EpisodeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_episode(
    project_id: str, data: schemas.EpisodeCreate, session: SessionDependency
):
    episode = EpisodeRepository(session).create(project_id, data)
    if episode is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return episode


@router.get("/api/episodes/{episode_id}", response_model=schemas.EpisodeDetail)
def get_episode(episode_id: str, session: SessionDependency):
    episode = EpisodeRepository(session).get(episode_id)
    if episode is None:
        raise HTTPException(status_code=404, detail="Episode not found")
    return episode
