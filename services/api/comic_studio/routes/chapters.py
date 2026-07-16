"""Routes for script chapter management and event extraction.

Part of M1.1 (chapter event graph). Splits a script into chapters on import
and exposes on-demand LLM-driven event extraction per chapter.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from comic_studio import models
from comic_studio.db import get_session
from comic_studio.model_runtime.errors import ModelRuntimeError
from comic_studio.services.chapter_events import (
    ChapterEventDraft,
    ChapterEventService,
    build_extraction_context,
    chapters_to_payload,
)


router = APIRouter(tags=["chapters"])
SessionDependency = Annotated[Session, Depends(get_session)]


class ChapterRead(BaseModel):
    id: str
    chapter_index: int
    title: str | None
    source_text: str
    event_summary: dict[str, Any] = Field(default_factory=dict)
    character_ids: list[str] = Field(default_factory=list)
    scene_ids: list[str] = Field(default_factory=list)
    extraction_status: str
    extraction_error: str = ""
    created_at: str | None = None
    updated_at: str | None = None


class ChapterListResponse(BaseModel):
    script_document_id: str
    chapters: list[ChapterRead]


class ChapterReextractRequest(BaseModel):
    """Trigger a deterministic re-split of the document into chapters."""

    force: bool = Field(default=False)


class ChapterExtractRequest(BaseModel):
    """Trigger LLM-driven event extraction for one or all chapters."""

    chapter_ids: list[str] = Field(default_factory=list)
    project_context: dict[str, Any] = Field(default_factory=dict)


class ChapterExtractResponse(BaseModel):
    extracted: list[ChapterRead]
    failed: list[dict[str, Any]]


def _load_document(session: Session, script_document_id: str) -> models.ScriptDocument:
    from sqlalchemy import select

    document = session.scalar(
        select(models.ScriptDocument).where(
            models.ScriptDocument.id == script_document_id
        )
    )
    if document is None:
        raise HTTPException(status_code=404, detail="Script not found")
    return document


def _current_text(session: Session, document: models.ScriptDocument) -> str:
    from sqlalchemy import select

    revision = session.scalar(
        select(models.ScriptRevision).where(
            models.ScriptRevision.id == document.current_revision_id
        )
    )
    if revision is None:
        raise HTTPException(status_code=409, detail="Script has no current revision")
    return revision.content


@router.get(
    "/api/scripts/{script_document_id}/chapters",
    response_model=ChapterListResponse,
)
def list_chapters(
    script_document_id: str,
    session: SessionDependency,
):
    """Return all chapters for a script document in index order."""

    document = _load_document(session, script_document_id)
    service = ChapterEventService(session)
    chapters = service.list_chapters(document.id)
    return ChapterListResponse(
        script_document_id=document.id,
        chapters=[ChapterRead(**payload) for payload in chapters_to_payload(chapters)],
    )


@router.post(
    "/api/scripts/{script_document_id}/chapters/reextract",
    response_model=ChapterListResponse,
)
def reextract_chapters(
    script_document_id: str,
    body: ChapterReextractRequest,
    session: SessionDependency,
):
    """Re-run the deterministic chapter split against the current revision."""

    document = _load_document(session, script_document_id)
    service = ChapterEventService(session)
    text = _current_text(session, document)
    chapters = service.populate_chapters(document.id, text, replace=True)
    session.commit()
    return ChapterListResponse(
        script_document_id=document.id,
        chapters=[ChapterRead(**payload) for payload in chapters_to_payload(chapters)],
    )


@router.post(
    "/api/scripts/{script_document_id}/chapters/extract-events",
    response_model=ChapterExtractResponse,
)
async def extract_events(
    script_document_id: str,
    body: ChapterExtractRequest,
    session: SessionDependency,
    request: Request,
):
    """Run LLM-driven event extraction for the requested chapters.

    If ``chapter_ids`` is empty, all chapters with ``extraction_status !=
    'extracted'`` are processed. Failures are recorded on the chapter row and
    returned in the ``failed`` list so callers can retry individually.
    """

    document = _load_document(session, script_document_id)
    service = ChapterEventService(session)
    all_chapters = service.list_chapters(document.id)

    if body.chapter_ids:
        target_map = {ch.id: ch for ch in all_chapters if ch.id in body.chapter_ids}
    else:
        target_map = {
            ch.id: ch for ch in all_chapters if ch.extraction_status != "extracted"
        }
    if not target_map:
        return ChapterExtractResponse(extracted=[], failed=[])

    runtime = getattr(request.app.state, "model_runtime", None)
    if runtime is None:
        raise HTTPException(
            status_code=503,
            detail="Model runtime is not configured; cannot run extraction",
        )

    extracted: list[ChapterRead] = []
    failed: list[dict[str, Any]] = []
    for chapter in target_map.values():
        context = build_extraction_context(
            chapter, project_context=dict(body.project_context)
        )
        try:
            payload = await runtime.extract_chapter_events(context)
            draft = ChapterEventDraft.model_validate(payload)
            updated = service.store_extraction_result(chapter.id, draft)
            extracted.append(
                ChapterRead(**chapters_to_payload([updated])[0])
            )
        except ModelRuntimeError as error:
            service.mark_extraction_failed(chapter.id, error.message)
            failed.append(
                {
                    "chapter_id": chapter.id,
                    "chapter_index": chapter.chapter_index,
                    "error": error.message,
                    "code": error.code.value,
                }
            )
        except Exception as error:  # noqa: BLE001 — record any provider failure
            service.mark_extraction_failed(chapter.id, str(error))
            failed.append(
                {
                    "chapter_id": chapter.id,
                    "chapter_index": chapter.chapter_index,
                    "error": str(error),
                }
            )
    if extracted:
        service.sync_storyline(document.id)
    session.commit()
    return ChapterExtractResponse(extracted=extracted, failed=failed)


@router.get(
    "/api/episodes/{episode_id}/chapter-events",
    response_model=ChapterListResponse,
)
def episode_chapter_events(
    episode_id: str,
    session: SessionDependency,
):
    """Return chapters that contributed to a given episode.

    Used by planning prompts to scope LLM context to the relevant chapters
    instead of feeding the full novel.
    """

    service = ChapterEventService(session)
    chapters = service.events_for_episode(episode_id)
    # The script_document_id is not always known when the episode has no
    # script provenance; fall back to empty response.
    script_document_id = chapters[0].script_document_id if chapters else ""
    return ChapterListResponse(
        script_document_id=script_document_id,
        chapters=[ChapterRead(**payload) for payload in chapters_to_payload(chapters)],
    )
