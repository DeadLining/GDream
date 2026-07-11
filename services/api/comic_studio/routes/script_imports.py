from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select

from comic_studio import models
from comic_studio.script_imports import (
    ScriptImportConfirm,
    ScriptImportCreate,
    ScriptImportDraft,
    ScriptImportModeForm,
    ScriptImportRead,
)
from comic_studio.services.script_extraction import (
    ScriptSourceError,
    extract_generation_brief,
    extract_pasted_text,
    extract_uploaded_script,
)
from comic_studio.services.script_imports import (
    ScriptImportConfirmationService,
    ScriptImportParserService,
    build_script_project_context,
    script_project_load_options,
)


router = APIRouter(tags=["script-imports"])


class ScriptGenerationRequest(BaseModel):
    brief: str = Field(default="", max_length=20_000)
    existing_draft: str = Field(default="", max_length=500_000)


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _source_error(exc: ScriptSourceError) -> HTTPException:
    status_code = 413 if exc.category == "source_too_large" else 422
    return HTTPException(status_code=status_code, detail=exc.category)


@router.post("/api/projects/{project_id}/script-generation/stream")
def stream_script_generation(
    project_id: str,
    payload: ScriptGenerationRequest,
    request: Request,
):
    with request.app.state.session_factory() as session:
        project = session.scalar(
            select(models.Project)
            .options(*script_project_load_options())
            .where(models.Project.id == project_id)
        )
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        context = {
            **build_script_project_context(project),
            "brief": payload.brief.strip(),
            "existing_draft": payload.existing_draft,
        }
    provider = request.app.state.provider_factory.create_llm()

    async def events():
        try:
            async for chunk in provider.stream_script(context):
                yield _sse("chunk", {"text": chunk})
            yield _sse("done", {"finish_reason": "stop"})
        except Exception:
            yield _sse("error", {"message": "Script generation failed"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/api/projects/{project_id}/script-imports",
    response_model=ScriptImportRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_script_import(project_id: str, request: Request):
    with request.app.state.session_factory() as session:
        if session.get(models.Project, project_id) is None:
            raise HTTPException(status_code=404, detail="Project not found")
        content_type = request.headers.get("content-type", "").lower()
        try:
            if content_type.startswith("application/json"):
                data = ScriptImportCreate.model_validate(await request.json())
                source = (
                    extract_generation_brief(data.text)
                    if data.mode == "generate"
                    else extract_pasted_text(data.text)
                )
                mode = data.mode
            elif content_type.startswith("multipart/form-data"):
                form = await request.form()
                mode = ScriptImportModeForm(mode=form.get("mode", "auto")).mode
                upload = form.get("file")
                if upload is None or not hasattr(upload, "read"):
                    raise HTTPException(status_code=422, detail="file_required")
                source = extract_uploaded_script(upload.filename or "", await upload.read())
            else:
                raise HTTPException(status_code=415, detail="unsupported_content_type")
        except ScriptSourceError as exc:
            raise _source_error(exc) from exc
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc

        script_import = models.ScriptImport(
            project_id=project_id,
            status="uploaded",
            mode=mode,
            source_format=source.source_format,
            original_filename=source.filename,
            checksum=source.checksum,
            extracted_text=source.text,
        )
        session.add(script_import)
        session.commit()
        session.refresh(script_import)
        return script_import


@router.get("/api/script-imports/{import_id}", response_model=ScriptImportRead)
def get_script_import(import_id: str, request: Request):
    with request.app.state.session_factory() as session:
        script_import = session.get(models.ScriptImport, import_id)
        if script_import is None:
            raise HTTPException(status_code=404, detail="Script import not found")
        return script_import


async def _parse_import(import_id: str, request: Request):
    with request.app.state.session_factory() as session:
        try:
            planner = request.app.state.provider_factory.create_llm()
            return await ScriptImportParserService(session, planner).parse(import_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Script import not found") from exc
        except RuntimeError as exc:
            if str(exc).startswith("import_not_parseable"):
                raise HTTPException(status_code=409, detail=str(exc)) from exc
            raise


@router.post("/api/script-imports/{import_id}/parse", response_model=ScriptImportRead)
async def parse_script_import(import_id: str, request: Request):
    return await _parse_import(import_id, request)


@router.post("/api/script-imports/{import_id}/retry", response_model=ScriptImportRead)
async def retry_script_import(import_id: str, request: Request):
    return await _parse_import(import_id, request)


@router.patch("/api/script-imports/{import_id}/draft", response_model=ScriptImportRead)
def patch_script_import_draft(
    import_id: str,
    draft: ScriptImportDraft,
    request: Request,
):
    with request.app.state.session_factory() as session:
        script_import = session.get(models.ScriptImport, import_id)
        if script_import is None:
            raise HTTPException(status_code=404, detail="Script import not found")
        if script_import.status != "ready":
            raise HTTPException(status_code=409, detail="import_not_ready")
        script_import.structured_draft = draft.model_dump(mode="json")
        session.commit()
        session.refresh(script_import)
        return script_import


@router.post("/api/script-imports/{import_id}/confirm", response_model=ScriptImportRead)
def confirm_script_import(
    import_id: str,
    confirmation: ScriptImportConfirm,
    request: Request,
):
    with request.app.state.session_factory() as session:
        try:
            return ScriptImportConfirmationService(session).confirm(
                import_id, confirmation
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Script import not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
