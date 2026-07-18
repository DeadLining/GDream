from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.repositories import ProjectRepository
from comic_studio.services.project_deletion import (
    ProjectDeletionImpact,
    ProjectDeletionService,
)


router = APIRouter(prefix="/api/projects", tags=["projects"])
character_router = APIRouter(prefix="/api/characters", tags=["characters"])
SessionDependency = Annotated[Session, Depends(get_session)]


class ProjectDeletionCounts(BaseModel):
    episodes: int
    characters: int
    assets: int


class ProjectDeletionPreview(BaseModel):
    project_id: str
    title: str
    deleted: ProjectDeletionCounts


class ProjectDeletionRead(ProjectDeletionPreview):
    deleted_project_id: str
    cleanup_warnings: list[str]


def _deletion_preview(impact: ProjectDeletionImpact) -> ProjectDeletionPreview:
    return ProjectDeletionPreview(
        project_id=impact.project_id,
        title=impact.title,
        deleted=ProjectDeletionCounts(
            episodes=impact.episodes,
            characters=impact.characters,
            assets=impact.assets,
        ),
    )


@router.post("", response_model=schemas.ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(data: schemas.ProjectCreate, session: SessionDependency):
    return ProjectRepository(session).create(data)


@router.get("", response_model=list[schemas.ProjectRead])
def list_projects(session: SessionDependency):
    return ProjectRepository(session).list()


@router.get(
    "/{project_id}/deletion-preview",
    response_model=ProjectDeletionPreview,
)
def preview_project_deletion(
    project_id: str, request: Request, session: SessionDependency
):
    impact = ProjectDeletionService(
        session, request.app.state.settings.data_root
    ).preview(project_id)
    if impact is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _deletion_preview(impact)


@router.delete("/{project_id}", response_model=ProjectDeletionRead)
def delete_project(project_id: str, request: Request, session: SessionDependency):
    result = ProjectDeletionService(
        session, request.app.state.settings.data_root
    ).delete(project_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    preview = _deletion_preview(result.impact)
    return ProjectDeletionRead(
        **preview.model_dump(),
        deleted_project_id=result.impact.project_id,
        cleanup_warnings=list(result.cleanup_warnings),
    )


@router.get("/{project_id}", response_model=schemas.ProjectDetail)
def get_project(project_id: str, session: SessionDependency):
    project = ProjectRepository(session).get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get(
    "/{project_id}/overview-metrics",
    response_model=schemas.ProjectOverviewMetrics,
)
def get_project_overview_metrics(project_id: str, session: SessionDependency):
    metrics = ProjectRepository(session).overview_metrics(project_id)
    if metrics is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return metrics


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
