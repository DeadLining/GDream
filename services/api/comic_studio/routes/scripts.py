from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from comic_studio import models
from comic_studio.db import get_session
from comic_studio.script_library import (
    ScriptCreate,
    ScriptDocumentRead,
    ScriptDocumentSummary,
    ScriptPatch,
    ScriptRevisionRead,
)
from comic_studio.services.script_documents import (
    ScriptDocumentHasEpisodes,
    ScriptDocumentService,
    ScriptRevisionConflict,
)
from comic_studio.services.script_extraction import ScriptSourceError, extract_uploaded_script
from comic_studio.services.script_files import ScriptFilePathError, ScriptFileStore


router = APIRouter(tags=["scripts"])
SessionDependency = Annotated[Session, Depends(get_session)]


def _current(document: models.ScriptDocument) -> models.ScriptRevision:
    revision = next(
        (item for item in document.revisions if item.id == document.current_revision_id),
        None,
    )
    if revision is None:
        raise RuntimeError("current_revision_missing")
    return revision


def _summary(document: models.ScriptDocument) -> ScriptDocumentSummary:
    return ScriptDocumentSummary(
        id=document.id,
        project_id=document.project_id,
        title=document.title,
        source_type=document.source_type,
        status=document.status,
        revision_count=len(document.revisions),
        current_revision_id=document.current_revision_id,
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


def _read(document: models.ScriptDocument) -> ScriptDocumentRead:
    return ScriptDocumentRead(
        **_summary(document).model_dump(),
        current_revision=ScriptRevisionRead.model_validate(_current(document)),
    )


def _not_found(exc: KeyError) -> HTTPException:
    return HTTPException(status_code=404, detail="Script not found")


@router.get(
    "/api/projects/{project_id}/scripts",
    response_model=list[ScriptDocumentSummary],
)
def list_scripts(project_id: str, session: SessionDependency):
    if session.get(models.Project, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return [_summary(item) for item in ScriptDocumentService(session).list_for_project(project_id)]


@router.post(
    "/api/projects/{project_id}/scripts",
    response_model=ScriptDocumentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_script(project_id: str, data: ScriptCreate, session: SessionDependency):
    try:
        document = ScriptDocumentService(session).create(
            project_id, data.title, data.source_type, data.content, data.source_type
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    return _read(document)


@router.post(
    "/api/projects/{project_id}/scripts/upload",
    response_model=ScriptDocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_script(project_id: str, request: Request):
    form = await request.form()
    upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(status_code=422, detail="file_required")
    content = await upload.read()
    try:
        extracted = extract_uploaded_script(upload.filename or "", content)
    except ScriptSourceError as exc:
        code = 413 if exc.category == "source_too_large" else 422
        raise HTTPException(status_code=code, detail=exc.category) from exc
    title = str(form.get("title") or extracted.filename.rsplit(".", 1)[0] or "未命名剧本")
    with request.app.state.session_factory() as session:
        service = ScriptDocumentService(
            session, ScriptFileStore(request.app.state.settings.data_root)
        )
        try:
            document = service.create(
                project_id, title, "upload", extracted.text, "upload"
            )
            saved = service.file_store.persist_upload(
                project_id, document.id, extracted.filename, content
            )
            revision = _current(document)
            revision.original_filename = extracted.filename
            revision.source_file_path = saved.relative_path
            revision.source_media_type = getattr(upload, "content_type", "") or ""
            session.commit()
            return _read(service.get(document.id))
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Project not found") from exc
        except ScriptFilePathError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/api/scripts/{script_id}", response_model=ScriptDocumentRead)
def get_script(script_id: str, session: SessionDependency):
    try:
        return _read(ScriptDocumentService(session).get(script_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.patch("/api/scripts/{script_id}", response_model=ScriptDocumentRead)
def patch_script(script_id: str, data: ScriptPatch, session: SessionDependency):
    service = ScriptDocumentService(session)
    try:
        if data.title is not None:
            service.rename(script_id, data.title)
        if data.content is not None:
            service.save(script_id, data.content, data.expected_checksum or "")
        return _read(service.get(script_id))
    except KeyError as exc:
        raise _not_found(exc) from exc
    except ScriptRevisionConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "revision_conflict", "latest_checksum": exc.latest_checksum},
        ) from exc


@router.post("/api/scripts/{script_id}/finalize", response_model=ScriptDocumentRead)
def finalize_script(script_id: str, session: SessionDependency):
    service = ScriptDocumentService(session)
    try:
        service.finalize(script_id)
        return _read(service.get(script_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.get(
    "/api/scripts/{script_id}/revisions",
    response_model=list[ScriptRevisionRead],
)
def list_script_revisions(script_id: str, session: SessionDependency):
    try:
        document = ScriptDocumentService(session).get(script_id)
    except KeyError as exc:
        raise _not_found(exc) from exc
    return [
        ScriptRevisionRead.model_validate(item)
        for item in sorted(document.revisions, key=lambda item: item.revision_number, reverse=True)
    ]


@router.post(
    "/api/scripts/{script_id}/revisions/{revision_id}/restore",
    response_model=ScriptDocumentRead,
)
def restore_script(script_id: str, revision_id: str, session: SessionDependency):
    service = ScriptDocumentService(session)
    try:
        service.restore(script_id, revision_id)
        return _read(service.get(script_id))
    except KeyError as exc:
        raise _not_found(exc) from exc


@router.delete("/api/scripts/{script_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_script(script_id: str, request: Request):
    with request.app.state.session_factory() as session:
        service = ScriptDocumentService(
            session, ScriptFileStore(request.app.state.settings.data_root)
        )
        try:
            service.delete(script_id)
        except KeyError as exc:
            raise _not_found(exc) from exc
        except ScriptDocumentHasEpisodes as exc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "script_has_episodes",
                    "episodes": [
                        {"id": episode_id, "title": title}
                        for episode_id, title in exc.episodes
                    ],
                },
            ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
