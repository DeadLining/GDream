from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.repositories import ProjectRepository


router = APIRouter(prefix="/api/projects", tags=["projects"])
character_router = APIRouter(prefix="/api/characters", tags=["characters"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=schemas.ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(data: schemas.ProjectCreate, session: SessionDependency):
    return ProjectRepository(session).create(data)


@router.get("", response_model=list[schemas.ProjectRead])
def list_projects(session: SessionDependency):
    return ProjectRepository(session).list()


@router.get("/{project_id}", response_model=schemas.ProjectDetail)
def get_project(project_id: str, session: SessionDependency):
    project = ProjectRepository(session).get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=schemas.ProjectRead)
def update_project(
    project_id: str, data: schemas.ProjectPatch, session: SessionDependency
):
    project = ProjectRepository(session).update(project_id, data)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post(
    "/{project_id}/characters",
    response_model=schemas.CharacterRead,
    status_code=status.HTTP_201_CREATED,
)
def create_character(
    project_id: str, data: schemas.CharacterCreate, session: SessionDependency
):
    character = ProjectRepository(session).create_character(project_id, data)
    if character is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return character


@character_router.patch("/{character_id}", response_model=schemas.CharacterRead)
def update_character(
    character_id: str, data: schemas.CharacterPatch, session: SessionDependency
):
    character = ProjectRepository(session).update_character(character_id, data)
    if character is None:
        raise HTTPException(status_code=404, detail="Character not found")
    return character
