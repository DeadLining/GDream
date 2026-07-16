from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.services.narrative import (
    DuplicatePositionError,
    NarrativeReferenceError,
    NarrativeService,
)


router = APIRouter(tags=["narrative"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "/api/projects/{project_id}/volumes",
    response_model=schemas.VolumeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_volume(
    project_id: str, data: schemas.VolumeCreate, session: SessionDependency
):
    try:
        volume = NarrativeService(session).create_volume(project_id, data)
    except DuplicatePositionError as exc:
        raise HTTPException(409, "Volume position already exists") from exc
    if volume is None:
        raise HTTPException(404, "Project not found")
    return volume


@router.get(
    "/api/projects/{project_id}/volumes", response_model=list[schemas.VolumeRead]
)
def list_volumes(project_id: str, session: SessionDependency):
    volumes = NarrativeService(session).list_volumes(project_id)
    if volumes is None:
        raise HTTPException(404, "Project not found")
    return volumes


@router.patch("/api/volumes/{volume_id}", response_model=schemas.VolumeRead)
def update_volume(volume_id: str, data: schemas.VolumePatch, session: SessionDependency):
    try:
        volume = NarrativeService(session).update_volume(volume_id, data)
    except DuplicatePositionError as exc:
        raise HTTPException(409, "Volume position already exists") from exc
    if volume is None:
        raise HTTPException(404, "Volume not found")
    return volume


@router.delete("/api/volumes/{volume_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_volume(volume_id: str, session: SessionDependency):
    if not NarrativeService(session).delete_volume(volume_id):
        raise HTTPException(404, "Volume not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/api/episodes/{episode_id}/volume", response_model=schemas.EpisodeRead)
def move_episode(
    episode_id: str, data: schemas.EpisodeVolumeUpdate, session: SessionDependency
):
    try:
        episode = NarrativeService(session).move_episode(episode_id, data.volume_id)
    except NarrativeReferenceError as exc:
        raise HTTPException(422, str(exc)) from exc
    if episode is None:
        raise HTTPException(404, "Episode not found")
    return episode


@router.post(
    "/api/volumes/{volume_id}/episodes",
    response_model=schemas.EpisodeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_volume_episode(
    volume_id: str, data: schemas.VolumeEpisodeCreate, session: SessionDependency
):
    try:
        episode = NarrativeService(session).create_volume_episode(volume_id, data)
    except DuplicatePositionError as exc:
        raise HTTPException(409, "Episode position already exists") from exc
    if episode is None:
        raise HTTPException(404, "Volume not found")
    return episode


@router.post(
    "/api/projects/{project_id}/storylines",
    response_model=schemas.StorylineRead,
    status_code=status.HTTP_201_CREATED,
)
def create_storyline(
    project_id: str, data: schemas.StorylineCreate, session: SessionDependency
):
    storyline = NarrativeService(session).create_storyline(project_id, data)
    if storyline is None:
        raise HTTPException(404, "Project not found")
    return storyline


@router.get(
    "/api/projects/{project_id}/storylines",
    response_model=list[schemas.StorylineRead],
)
def list_storylines(project_id: str, session: SessionDependency):
    storylines = NarrativeService(session).list_storylines(project_id)
    if storylines is None:
        raise HTTPException(404, "Project not found")
    return storylines


@router.patch("/api/storylines/{storyline_id}", response_model=schemas.StorylineRead)
def update_storyline(storyline_id: str, data: schemas.StorylinePatch, session: SessionDependency):
    storyline = NarrativeService(session).update_storyline(storyline_id, data)
    if storyline is None:
        raise HTTPException(404, "Storyline not found")
    return storyline


@router.delete("/api/storylines/{storyline_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_storyline(storyline_id: str, session: SessionDependency):
    if not NarrativeService(session).delete_storyline(storyline_id):
        raise HTTPException(404, "Storyline not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/storylines/{storyline_id}/events",
    response_model=schemas.StorylineEventRead,
    status_code=status.HTTP_201_CREATED,
)
def create_storyline_event(
    storyline_id: str,
    data: schemas.StorylineEventCreate,
    session: SessionDependency,
):
    try:
        event = NarrativeService(session).create_storyline_event(storyline_id, data)
    except NarrativeReferenceError as exc:
        raise HTTPException(422, str(exc)) from exc
    except DuplicatePositionError as exc:
        raise HTTPException(409, "Storyline event position already exists") from exc
    if event is None:
        raise HTTPException(404, "Storyline not found")
    return event


@router.patch("/api/storyline-events/{event_id}", response_model=schemas.StorylineEventRead)
def update_storyline_event(event_id: str, data: schemas.StorylineEventPatch, session: SessionDependency):
    try:
        event = NarrativeService(session).update_storyline_event(event_id, data)
    except NarrativeReferenceError as exc:
        raise HTTPException(422, str(exc)) from exc
    except DuplicatePositionError as exc:
        raise HTTPException(409, "Storyline event position already exists") from exc
    if event is None:
        raise HTTPException(404, "Storyline event not found")
    return event


@router.delete("/api/storyline-events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_storyline_event(event_id: str, session: SessionDependency):
    if not NarrativeService(session).delete_storyline_event(event_id):
        raise HTTPException(404, "Storyline event not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
