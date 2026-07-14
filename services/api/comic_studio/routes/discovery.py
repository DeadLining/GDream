from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.services.discovery import DiscoveryService


router = APIRouter(tags=["discovery"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/api/workspace/summary", response_model=schemas.WorkspaceSummaryRead)
def workspace_summary(session: SessionDependency):
    return DiscoveryService(session).workspace_summary()


@router.get("/api/projects/{project_id}/search", response_model=schemas.ProjectSearchRead)
def project_search(
    project_id: str,
    session: SessionDependency,
    q: str = Query(min_length=1, max_length=120),
):
    try:
        result = DiscoveryService(session).search(project_id, q)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if result is None:
        raise HTTPException(404, "Project not found")
    return result
