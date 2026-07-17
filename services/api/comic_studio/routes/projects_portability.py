"""M2.3 — Project ZIP portability routes.

Provides export (project → ZIP) and import (ZIP → new project) endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict

from comic_studio.services.project_portability import (
    MANIFEST_SCHEMA,
    ProjectPortabilityError,
    ProjectPortabilityService,
)


router = APIRouter(tags=["projects-portability"])


class ExportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    project_id: str
    zip_path: str
    bytes_written: int


class ImportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    project_id: str
    warnings: list[str]


@router.post(
    "/api/projects/{project_id}/export",
    response_model=ExportResponse,
    status_code=status.HTTP_201_CREATED,
)
def export_project(project_id: str, request: Request):
    with request.app.state.session_factory() as session:
        service = ProjectPortabilityService(session)
        try:
            result = service.export_project(project_id)
        except ProjectPortabilityError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ExportResponse(
        project_id=result.project_id,
        zip_path=str(result.zip_path),
        bytes_written=result.bytes_written,
    )


@router.get("/api/projects/{project_id}/export/download")
def download_project_export(project_id: str, request: Request):
    with request.app.state.session_factory() as session:
        service = ProjectPortabilityService(session)
        try:
            result = service.export_project(project_id)
        except ProjectPortabilityError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        result.zip_path,
        media_type="application/zip",
        filename=result.zip_path.name,
    )


@router.post(
    "/api/projects/import",
    response_model=ImportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_project(request: Request, archive: UploadFile = File(...)):
    # Read archive into a temp file on disk so the service can ZipFile it.
    data = await archive.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")
    # Validate it looks like a zip before persisting.
    if not (data[:4] == b"PK\x03\x04" or data[:4] == b"PK\x05\x06"):
        raise HTTPException(status_code=400, detail="Not a valid ZIP archive")
    import tempfile
    from pathlib import Path

    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)
    try:
        with request.app.state.session_factory() as session:
            service = ProjectPortabilityService(session)
            try:
                result = service.import_project(tmp_path)
            except ProjectPortabilityError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass
    return ImportResponse(project_id=result.project_id, warnings=result.warnings)


# Re-export for tests / discoverability.
__all__ = ("MANIFEST_SCHEMA", "router")
