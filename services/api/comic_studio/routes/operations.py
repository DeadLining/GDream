from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.services.operations import OperationsService, OperationsValidationError


router = APIRouter(tags=["operations"])
SessionDependency = Annotated[Session, Depends(get_session)]


def _unprocessable(exc: OperationsValidationError):
    raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/api/projects/{project_id}/members", response_model=schemas.ProjectMemberRead, status_code=status.HTTP_201_CREATED)
def create_member(project_id: str, data: schemas.ProjectMemberCreate, session: SessionDependency):
    try:
        member = OperationsService(session).create_member(project_id, data)
    except OperationsValidationError as exc:
        _unprocessable(exc)
    if member is None: raise HTTPException(status_code=404, detail="Project not found")
    return member


@router.get("/api/projects/{project_id}/members", response_model=list[schemas.ProjectMemberRead])
def list_members(project_id: str, session: SessionDependency):
    members = OperationsService(session).list_members(project_id)
    if members is None: raise HTTPException(status_code=404, detail="Project not found")
    return members


@router.patch("/api/project-members/{member_id}", response_model=schemas.ProjectMemberRead)
def update_member(member_id: str, data: schemas.ProjectMemberPatch, session: SessionDependency):
    try:
        member = OperationsService(session).update_member(member_id, data)
    except OperationsValidationError as exc:
        _unprocessable(exc)
    if member is None: raise HTTPException(status_code=404, detail="Project member not found")
    return member


@router.post("/api/projects/{project_id}/tasks", response_model=schemas.ProductionTaskRead, status_code=status.HTTP_201_CREATED)
def create_task(project_id: str, data: schemas.ProductionTaskCreate, session: SessionDependency):
    try:
        task = OperationsService(session).create_task(project_id, data)
    except OperationsValidationError as exc:
        _unprocessable(exc)
    if task is None: raise HTTPException(status_code=404, detail="Project not found")
    return task


@router.get("/api/projects/{project_id}/tasks", response_model=list[schemas.ProductionTaskRead])
def list_tasks(project_id: str, session: SessionDependency):
    tasks = OperationsService(session).list_tasks(project_id)
    if tasks is None: raise HTTPException(status_code=404, detail="Project not found")
    return tasks


@router.patch("/api/production-tasks/{task_id}", response_model=schemas.ProductionTaskRead)
def update_task(task_id: str, data: schemas.ProductionTaskPatch, session: SessionDependency):
    task = OperationsService(session).update_task(task_id, data)
    if task is None: raise HTTPException(status_code=404, detail="Production task not found")
    return task


@router.post("/api/episodes/{episode_id}/versions", response_model=schemas.EpisodeVersionRead, status_code=status.HTTP_201_CREATED)
def create_version(episode_id: str, data: schemas.EpisodeVersionCreate, session: SessionDependency):
    version = OperationsService(session).create_version(episode_id, data)
    if version is None: raise HTTPException(status_code=404, detail="Episode not found")
    return version


@router.get("/api/episodes/{episode_id}/versions", response_model=list[schemas.EpisodeVersionRead])
def list_versions(episode_id: str, session: SessionDependency):
    versions = OperationsService(session).list_versions(episode_id)
    if versions is None: raise HTTPException(status_code=404, detail="Episode not found")
    return versions


@router.post("/api/episode-versions/{version_id}/restore", response_model=schemas.EpisodeVersionRead, status_code=status.HTTP_201_CREATED)
def restore_version(version_id: str, session: SessionDependency):
    try:
        version = OperationsService(session).restore_version(version_id)
    except OperationsValidationError as exc:
        _unprocessable(exc)
    except RuntimeError as exc:
        if str(exc) == "episode_restore_active_production":
            raise HTTPException(status_code=409, detail="Cannot restore an episode while production is active") from exc
        raise
    if version is None: raise HTTPException(status_code=404, detail="Episode version not found")
    return version


@router.post("/api/episodes/{episode_id}/delivery-packages", response_model=schemas.DeliveryPackageRead, status_code=status.HTTP_201_CREATED)
def create_delivery_package(episode_id: str, data: schemas.DeliveryPackageCreate, session: SessionDependency):
    try:
        package = OperationsService(session).create_delivery_package(episode_id, data)
    except OperationsValidationError as exc:
        _unprocessable(exc)
    except RuntimeError as exc:
        if str(exc) == "candidate_not_approved":
            raise HTTPException(status_code=409, detail="Delivery package requires an approved release candidate") from exc
        raise
    if package is None: raise HTTPException(status_code=404, detail="Episode not found")
    return package


@router.get("/api/episodes/{episode_id}/delivery-packages", response_model=list[schemas.DeliveryPackageRead])
def list_delivery_packages(episode_id: str, session: SessionDependency):
    packages = OperationsService(session).list_delivery_packages(episode_id)
    if packages is None: raise HTTPException(status_code=404, detail="Episode not found")
    return packages


