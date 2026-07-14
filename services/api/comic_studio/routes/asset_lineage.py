from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.services.asset_lineage import (
    AssetLineageConflictError,
    AssetLineageReferenceError,
    AssetLineageService,
)
from comic_studio.services.recycle_bin import RecycleBinService


router = APIRouter(tags=["asset-lineage"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "/api/characters/{character_id}/variants",
    response_model=schemas.AssetVariantRead,
    status_code=status.HTTP_201_CREATED,
)
def create_variant(
    character_id: str,
    data: schemas.AssetVariantCreate,
    session: SessionDependency,
):
    try:
        variant = AssetLineageService(session).create_variant(character_id, data)
    except AssetLineageReferenceError as exc:
        raise HTTPException(422, str(exc)) from exc
    if variant is None:
        raise HTTPException(404, "Character not found")
    return variant


@router.get(
    "/api/characters/{character_id}/variants",
    response_model=list[schemas.AssetVariantRead],
)
def list_variants(character_id: str, session: SessionDependency):
    variants = AssetLineageService(session).list_variants(character_id)
    if variants is None:
        raise HTTPException(404, "Character not found")
    return variants


@router.patch(
    "/api/asset-variants/{variant_id}",
    response_model=schemas.AssetVariantRead,
)
def update_variant(
    variant_id: str,
    data: schemas.AssetVariantPatch,
    session: SessionDependency,
):
    try:
        variant = AssetLineageService(session).update_variant(variant_id, data)
    except AssetLineageReferenceError as exc:
        raise HTTPException(422, str(exc)) from exc
    if variant is None:
        raise HTTPException(404, "Asset variant not found")
    return variant


@router.delete(
    "/api/asset-variants/{variant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_variant(variant_id: str, session: SessionDependency):
    deleted = RecycleBinService(session).soft_delete_variant(variant_id)
    if not deleted:
        raise HTTPException(404, "Asset variant not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/asset-variants/{variant_id}/states",
    response_model=schemas.AssetVariantStateRead,
    status_code=status.HTTP_201_CREATED,
)
def create_state(
    variant_id: str,
    data: schemas.AssetVariantStateCreate,
    session: SessionDependency,
):
    state = AssetLineageService(session).create_state(variant_id, data)
    if state is None:
        raise HTTPException(404, "Asset variant not found")
    return state


@router.patch(
    "/api/asset-variant-states/{state_id}",
    response_model=schemas.AssetVariantStateRead,
)
def update_state(
    state_id: str,
    data: schemas.AssetVariantStatePatch,
    session: SessionDependency,
):
    state = AssetLineageService(session).update_state(state_id, data)
    if state is None:
        raise HTTPException(404, "Asset variant state not found")
    return state


@router.delete(
    "/api/asset-variant-states/{state_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_state(state_id: str, session: SessionDependency):
    deleted = RecycleBinService(session).soft_delete_state(state_id)
    if not deleted:
        raise HTTPException(404, "Asset variant state not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/asset-variants/{variant_id}/usages",
    response_model=schemas.AssetVariantUsageRead,
    status_code=status.HTTP_201_CREATED,
)
def create_usage(
    variant_id: str,
    data: schemas.AssetVariantUsageCreate,
    session: SessionDependency,
):
    try:
        usage = AssetLineageService(session).create_usage(variant_id, data)
    except AssetLineageReferenceError as exc:
        raise HTTPException(422, str(exc)) from exc
    except AssetLineageConflictError as exc:
        raise HTTPException(409, "Variant usage already exists") from exc
    if usage is None:
        raise HTTPException(404, "Asset variant not found")
    return usage


@router.get(
    "/api/asset-variants/{variant_id}/impact",
    response_model=schemas.AssetVariantImpactRead,
)
def variant_impact(variant_id: str, session: SessionDependency):
    impact = AssetLineageService(session).impact(variant_id)
    if impact is None:
        raise HTTPException(404, "Asset variant not found")
    return impact
