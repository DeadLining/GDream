from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.services.library_assets import (
    DuplicateLibraryAssetError,
    LibraryAssetSceneProjectMismatchError,
    LibraryAssetService,
)


router = APIRouter(tags=["library-assets"])
SessionDependency = Annotated[Session, Depends(get_session)]


def _response(asset) -> schemas.LibraryAssetRead:
    return schemas.LibraryAssetRead(
        id=asset.id,
        project_id=asset.project_id,
        kind=asset.kind,
        name=asset.name,
        description=asset.description,
        tags=asset.tags,
        metadata=asset.asset_metadata,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
    )


@router.get(
    "/api/projects/{project_id}/library-assets",
    response_model=list[schemas.LibraryAssetRead],
)
def list_library_assets(
    project_id: str,
    session: SessionDependency,
    kind: schemas.LibraryAssetKind | None = None,
    q: str = Query(default="", max_length=200),
):
    assets = LibraryAssetService(session).list(project_id, kind=kind, query=q)
    if assets is None:
        raise HTTPException(404, "Project not found")
    return [_response(asset) for asset in assets]


@router.post(
    "/api/projects/{project_id}/library-assets",
    response_model=schemas.LibraryAssetRead,
    status_code=status.HTTP_201_CREATED,
)
def create_library_asset(
    project_id: str, data: schemas.LibraryAssetCreate, session: SessionDependency
):
    try:
        asset = LibraryAssetService(session).create(project_id, data)
    except DuplicateLibraryAssetError as exc:
        raise HTTPException(409, "Library asset name already exists") from exc
    if asset is None:
        raise HTTPException(404, "Project not found")
    return _response(asset)


@router.patch(
    "/api/library-assets/{asset_id}", response_model=schemas.LibraryAssetRead
)
def update_library_asset(
    asset_id: str, data: schemas.LibraryAssetPatch, session: SessionDependency
):
    try:
        asset = LibraryAssetService(session).update(asset_id, data)
    except DuplicateLibraryAssetError as exc:
        raise HTTPException(409, "Library asset name already exists") from exc
    if asset is None:
        raise HTTPException(404, "Library asset not found")
    return _response(asset)


@router.delete(
    "/api/library-assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_library_asset(asset_id: str, session: SessionDependency):
    if not LibraryAssetService(session).delete(asset_id):
        raise HTTPException(404, "Library asset not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/api/scenes/{scene_id}/library-assets",
    response_model=list[schemas.LibraryAssetRead],
)
def list_scene_library_assets(scene_id: str, session: SessionDependency):
    assets = LibraryAssetService(session).list_for_scene(scene_id)
    if assets is None:
        raise HTTPException(404, "Scene not found")
    return [_response(asset) for asset in assets]


@router.put(
    "/api/scenes/{scene_id}/library-assets/{asset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def bind_library_asset_to_scene(
    scene_id: str, asset_id: str, session: SessionDependency
):
    try:
        found = LibraryAssetService(session).bind_to_scene(scene_id, asset_id)
    except LibraryAssetSceneProjectMismatchError as exc:
        raise HTTPException(
            409, "Library asset and scene must belong to the same project"
        ) from exc
    if not found:
        raise HTTPException(404, "Scene or library asset not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/api/scenes/{scene_id}/library-assets/{asset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def unbind_library_asset_from_scene(
    scene_id: str, asset_id: str, session: SessionDependency
):
    try:
        found = LibraryAssetService(session).unbind_from_scene(scene_id, asset_id)
    except LibraryAssetSceneProjectMismatchError as exc:
        raise HTTPException(
            409, "Library asset and scene must belong to the same project"
        ) from exc
    if not found:
        raise HTTPException(404, "Scene or library asset not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
