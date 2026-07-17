from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.services.delivery import (
    DeliveryCandidateNotApproved,
    DeliveryPackageService,
    DeliveryValidationError,
)
from comic_studio.services.operations import OperationsService, OperationsValidationError


router = APIRouter(tags=["operations"])
SessionDependency = Annotated[Session, Depends(get_session)]


def _unprocessable(exc: ValueError):
    raise HTTPException(status_code=422, detail=str(exc)) from exc


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


@router.delete("/api/production-tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: str, session: SessionDependency):
    if not OperationsService(session).delete_task(task_id):
        raise HTTPException(status_code=404, detail="Production task not found")


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
def create_delivery_package(episode_id: str, data: schemas.DeliveryPackageCreate, request: Request, session: SessionDependency):
    try:
        package = DeliveryPackageService(
            session, request.app.state.settings.data_root
        ).create(episode_id, data)
    except DeliveryValidationError as exc:
        _unprocessable(exc)
    except DeliveryCandidateNotApproved as exc:
        raise HTTPException(status_code=409, detail="Delivery package requires an approved release candidate") from exc
    if package is None: raise HTTPException(status_code=404, detail="Episode not found")
    return package


@router.get("/api/episodes/{episode_id}/delivery-packages", response_model=list[schemas.DeliveryPackageRead])
def list_delivery_packages(episode_id: str, request: Request, session: SessionDependency):
    packages = DeliveryPackageService(
        session, request.app.state.settings.data_root
    ).list(episode_id)
    if packages is None: raise HTTPException(status_code=404, detail="Episode not found")
    return packages


@router.get("/api/delivery-packages/{package_id}/download")
def download_delivery_package(package_id: str, request: Request, session: SessionDependency):
    artifact = DeliveryPackageService(
        session, request.app.state.settings.data_root
    ).artifact(package_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Delivery artifact not found")
    package, path = artifact
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"delivery-{package.id[:8]}.zip",
    )
