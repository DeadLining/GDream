from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from comic_studio import schemas
from comic_studio.db import get_session
from comic_studio.services.recycle_bin import RecycleBinConflictError, RecycleBinService


router = APIRouter(tags=["recycle-bin"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get(
    "/api/projects/{project_id}/trash-items",
    response_model=list[schemas.TrashItemRead],
)
def list_trash_items(project_id: str, session: SessionDependency):
    items = RecycleBinService(session).list_for_project(project_id)
    if items is None:
        raise HTTPException(404, "Project not found")
    return items


@router.post(
    "/api/trash-items/{item_id}/restore",
    response_model=schemas.TrashRestoreRead,
)
def restore_trash_item(item_id: str, session: SessionDependency):
    try:
        restored = RecycleBinService(session).restore(item_id)
    except RecycleBinConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    if restored is None:
        raise HTTPException(404, "Trash item not found")
    return restored


@router.delete(
    "/api/trash-items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def permanently_delete_trash_item(item_id: str, session: SessionDependency):
    try:
        deleted = RecycleBinService(session).permanently_delete(item_id)
    except RecycleBinConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    if not deleted:
        raise HTTPException(404, "Trash item not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
