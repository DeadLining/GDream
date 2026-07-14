from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.services.production_canvas import ProductionCanvasService


router = APIRouter(tags=["production-canvas"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get(
    "/api/episodes/{episode_id}/production-graph",
    response_model=schemas.EpisodeProductionGraphRead,
)
def get_production_graph(episode_id: str, session: SessionDependency):
    try:
        return ProductionCanvasService(session).graph(episode_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="episode_not_found") from exc


@router.get(
    "/api/episodes/{episode_id}/production-canvas-layout",
    response_model=schemas.ProductionCanvasLayoutRead,
)
def get_production_canvas_layout(episode_id: str, session: SessionDependency):
    try:
        return ProductionCanvasService(session).read_layout(episode_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="episode_not_found") from exc


@router.put(
    "/api/episodes/{episode_id}/production-canvas-layout",
    response_model=schemas.ProductionCanvasLayoutRead,
)
def put_production_canvas_layout(
    episode_id: str,
    data: schemas.ProductionCanvasLayoutPayload,
    session: SessionDependency,
):
    try:
        return ProductionCanvasService(session).save_layout(episode_id, data)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="episode_not_found") from exc


@router.get(
    "/api/projects/{project_id}/production-workflows",
    response_model=list[schemas.ProductionWorkflowBindingRead],
)
def list_production_workflows(project_id: str, session: SessionDependency):
    try:
        return ProductionCanvasService(session).list_workflow_bindings(project_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="project_not_found") from exc


@router.put(
    "/api/projects/{project_id}/production-workflows/{capability}/{name}",
    response_model=schemas.ProductionWorkflowBindingRead,
)
def put_production_workflow(
    project_id: str,
    capability: Literal["panel", "video"],
    name: str,
    data: schemas.ProductionWorkflowBindingUpdate,
    session: SessionDependency,
):
    try:
        return ProductionCanvasService(session).save_workflow_binding(
            project_id, capability, name, data
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="project_not_found") from exc
