from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.services.asset_requirements import (
    AssetRequirementService,
    CurrentScriptRevisionMissing,
)


router = APIRouter(tags=["asset-requirements"])
SessionDependency = Annotated[Session, Depends(get_session)]


def _read(item) -> schemas.AssetRequirementRead:
    return schemas.AssetRequirementRead(
        id=item.id,
        project_id=item.project_id,
        script_revision_id=item.script_revision_id,
        kind=item.kind,
        canonical_key=item.canonical_key,
        name=item.name,
        description=item.description,
        required=item.required,
        status=item.status,
        binding_type=item.binding_type,
        binding_id=item.binding_id,
        source_context=item.source_context,
        metadata=item.requirement_metadata,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get(
    "/api/projects/{project_id}/asset-requirements",
    response_model=list[schemas.AssetRequirementRead],
)
def list_asset_requirements(
    project_id: str,
    session: SessionDependency,
    kind: schemas.AssetRequirementKind | None = None,
):
    try:
        requirements = AssetRequirementService(session).list(project_id, kind=kind)
    except CurrentScriptRevisionMissing as exc:
        raise HTTPException(409, str(exc)) from exc
    if requirements is None:
        raise HTTPException(404, "Project not found")
    return [_read(item) for item in requirements]


@router.post(
    "/api/projects/{project_id}/asset-requirements/sync",
    response_model=list[schemas.AssetRequirementRead],
)
def sync_asset_requirements(project_id: str, session: SessionDependency):
    try:
        requirements = AssetRequirementService(session).sync(project_id)
    except CurrentScriptRevisionMissing as exc:
        raise HTTPException(409, str(exc)) from exc
    if requirements is None:
        raise HTTPException(404, "Project not found")
    return [_read(item) for item in requirements]


@router.get(
    "/api/shots/{shot_id}/generation-readiness",
    response_model=schemas.ShotGenerationReadiness,
)
def get_shot_generation_readiness(shot_id: str, session: SessionDependency):
    try:
        readiness = AssetRequirementService(session).shot_readiness(shot_id)
    except CurrentScriptRevisionMissing as exc:
        raise HTTPException(409, str(exc)) from exc
    if readiness is None:
        raise HTTPException(404, "Shot not found")
    return schemas.ShotGenerationReadiness.model_validate(readiness)
