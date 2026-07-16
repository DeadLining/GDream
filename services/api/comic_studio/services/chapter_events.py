"""Chapter event extraction service for script documents.

Splits a long script into chapters and extracts structured event summaries
per chapter. Designed so that downstream planning prompts can inject only
the chapters relevant to a given episode instead of feeding the full novel
to the LLM (which degrades on long-form Chinese serial fiction).

The chapter splitting is deterministic and unit-testable without an LLM.
Event extraction is LLM-driven via ModelRuntime.TEXT, with a graceful
fallback that leaves ``extraction_status='skipped'`` when no provider is
configured.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable

from pydantic import BaseModel, Field
from sqlalchemy import select

from comic_studio import models


# --- Chapter splitting -----------------------------------------------------

# Chinese chapter headings: 第一章 / 第123章 / 第1回 / 第一节 / 序章 / 楔子 / 尾声
# English headings: Chapter 1 / CHAPTER II
_CHAPTER_PATTERNS = [
    re.compile(r"^\s*第\s*[零一二三四五六七八九十百千0-9]+\s*[章回节卷]\s*[::、\.\s]*([^\n]*)$", re.MULTILINE),
    re.compile(r"^\s*(序\s*章|楔\s*子|尾\s*声|前\s*传|后\s*记|番\s*外)\s*[:：]?\s*([^\n]*)$", re.MULTILINE),
    re.compile(r"^\s*Chapter\s+([0-9]+|[IVXLCDM]+)\s*[:：.\-\s]*([^\n]*)$", re.MULTILINE | re.IGNORECASE),
    re.compile(r"^\s*CHAPTER\s+([0-9]+|[IVXLCDM]+)\s*[:：.\-\s]*([^\n]*)$", re.MULTILINE),
]

# If no headings found, fall back to splitting on long runs of blank lines or
# explicit scene separators.
_FALLBACK_SEPARATOR = re.compile(r"\n{3,}|^\s*[*＊*]{3}\s*$", re.MULTILINE)

# Minimum chapter length (characters) to avoid creating one-line "chapters"
# from stray headings inside dialogue.
_MIN_CHAPTER_CHARS = 200
# Maximum chapters to create from a single document (safety valve).
_MAX_CHAPTERS = 500
# Fallback target chapter length when no headings are found.
_FALLBACK_TARGET_CHARS = 4000


@dataclass(frozen=True)
class ChapterDraft:
    """A chapter slice produced by the deterministic splitter."""

    index: int
    title: str | None
    source_text: str


def split_chapters(text: str) -> list[ChapterDraft]:
    """Split ``text`` into chapters.

    Strategy:
      1. Scan for Chinese/English chapter headings. If found, slice by
         heading boundaries.
      2. Otherwise, if the document is long enough, split on blank-line or
         ``***`` separators, then merge tiny fragments.
      3. As a last resort, split by approximate character budget.

    The function never raises; an empty or very short input yields a single
    chapter covering the whole text.
    """

    normalized = (text or "").strip()
    if not normalized:
        return [ChapterDraft(index=0, title=None, source_text="")]

    # Step 1: heading-based split.
    matches: list[tuple[int, int, str]] = []  # (start, end, title)
    for pattern in _CHAPTER_PATTERNS:
        for m in pattern.finditer(normalized):
            # Prefer the last non-numeric capture group as the title.
            # For "Chapter 1 The Arrival", group 1="1" (skip), group 2="The Arrival".
            # For "第一章 初遇", group 1="初遇".
            title = ""
            for group in reversed(m.groups()):
                if group and group.strip() and not group.strip().isdigit():
                    title = group.strip()
                    break
            matches.append((m.start(), m.end(), title))
    if matches:
        matches.sort(key=lambda item: item[0])
        # Deduplicate overlapping matches from different patterns.
        deduped: list[tuple[int, int, str]] = []
        last_start = -1
        for start, end, title in matches:
            if start < last_start:
                continue
            deduped.append((start, end, title))
            last_start = start
        chapters: list[ChapterDraft] = []
        for i, (start, end, title) in enumerate(deduped[:_MAX_CHAPTERS]):
            body_start = end
            body_end = deduped[i + 1][0] if i + 1 < len(deduped) else len(normalized)
            body = normalized[body_start:body_end].strip()
            if not body:
                continue
            chapters.append(
                ChapterDraft(index=len(chapters), title=title or None, source_text=body)
            )
        # If the heading scan produced nothing usable, fall through.
        if chapters:
            return chapters

    # Step 2: separator-based fallback for long text without headings.
    if len(normalized) >= _FALLBACK_TARGET_CHARS:
        parts = _FALLBACK_SEPARATOR.split(normalized)
        parts = [p.strip() for p in parts if p and p.strip()]
        # Merge tiny fragments into the previous chunk.
        merged: list[str] = []
        for part in parts:
            if merged and len(part) < _MIN_CHAPTER_CHARS:
                merged[-1] = merged[-1] + "\n\n" + part
            else:
                merged.append(part)
        if len(merged) > 1:
            return [
                ChapterDraft(index=i, title=None, source_text=chunk)
                for i, chunk in enumerate(merged[:_MAX_CHAPTERS])
            ]

    # Step 3: whole-text single chapter.
    return [ChapterDraft(index=0, title=None, source_text=normalized)]


# --- Event extraction schemas ---------------------------------------------


class ChapterBeat(BaseModel):
    """A single narrative beat inside a chapter."""

    order: int = Field(..., ge=1)
    summary: str = Field(..., min_length=1)
    characters: list[str] = Field(default_factory=list)
    stakes: str = Field(default="")


class ChapterEventDraft(BaseModel):
    """Structured event summary the LLM returns for one chapter."""

    chapter_index: int = Field(..., ge=0)
    title: str | None = None
    beats: list[ChapterBeat] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    open_threads: list[str] = Field(default_factory=list)
    payoff_candidates: list[str] = Field(default_factory=list)
    character_mentions: list[str] = Field(default_factory=list)


# --- Service ---------------------------------------------------------------


class ChapterEventService:
    """Persists chapters for a ScriptDocument and drives event extraction."""

    def __init__(self, session):
        self.session = session

    # -- Reading ------------------------------------------------------------

    def list_chapters(self, script_document_id: str) -> list[models.ScriptChapter]:
        rows = self.session.scalars(
            select(models.ScriptChapter)
            .where(models.ScriptChapter.script_document_id == script_document_id)
            .order_by(models.ScriptChapter.chapter_index)
        ).all()
        return list(rows)

    def events_for_episode(self, episode_id: str) -> list[models.ScriptChapter]:
        """Return chapters referenced by the script that produced this episode.

        Currently resolves via the episode's script import provenance; if no
        link exists, returns an empty list (callers should degrade gracefully).
        """

        episode = self.session.scalar(
            select(models.Episode).where(models.Episode.id == episode_id)
        )
        if episode is None:
            return []
        # Prefer explicit script_document_id if the project tracks one.
        project = self.session.scalar(
            select(models.Project).where(models.Project.id == episode.project_id)
        )
        if project is None:
            return []
        script_document = self.session.scalar(
            select(models.ScriptDocument)
            .where(models.ScriptDocument.project_id == project.id)
            .order_by(models.ScriptDocument.updated_at.desc())
        )
        if script_document is None:
            return []
        return self.list_chapters(script_document.id)

    # -- Writing ------------------------------------------------------------

    def populate_chapters(
        self,
        script_document_id: str,
        text: str,
        *,
        replace: bool = True,
    ) -> list[models.ScriptChapter]:
        """Split ``text`` and persist the resulting chapters.

        Existing chapters for the document are deleted first when
        ``replace=True`` (the default), making this idempotent on re-import.
        """

        document = self.session.scalar(
            select(models.ScriptDocument).where(
                models.ScriptDocument.id == script_document_id
            )
        )
        if document is None:
            raise KeyError(script_document_id)

        if replace:
            existing = self.session.scalars(
                select(models.ScriptChapter).where(
                    models.ScriptChapter.script_document_id == script_document_id
                )
            ).all()
            for row in existing:
                self.session.delete(row)
            self.session.flush()

        drafts = split_chapters(text)
        rows: list[models.ScriptChapter] = []
        for draft in drafts:
            chapter = models.ScriptChapter(
                script_document_id=script_document_id,
                chapter_index=draft.index,
                title=draft.title,
                source_text=draft.source_text,
                event_summary={},
                character_ids=[],
                scene_ids=[],
                extraction_status="pending",
                extraction_error="",
            )
            self.session.add(chapter)
            rows.append(chapter)
        self.session.flush()
        return rows

    def store_extraction_result(
        self,
        chapter_id: str,
        draft: ChapterEventDraft,
    ) -> models.ScriptChapter:
        """Persist a successful LLM extraction result onto a chapter row."""

        chapter = self.session.scalar(
            select(models.ScriptChapter).where(models.ScriptChapter.id == chapter_id)
        )
        if chapter is None:
            raise KeyError(chapter_id)

        chapter.event_summary = draft.model_dump()
        chapter.character_ids = list(draft.character_mentions)
        chapter.extraction_status = "extracted"
        chapter.extraction_error = ""
        self.session.add(chapter)
        self.session.flush()
        return chapter

    def mark_extraction_failed(self, chapter_id: str, error: str) -> models.ScriptChapter:
        chapter = self.session.scalar(
            select(models.ScriptChapter).where(models.ScriptChapter.id == chapter_id)
        )
        if chapter is None:
            raise KeyError(chapter_id)
        chapter.extraction_status = "failed"
        chapter.extraction_error = (error or "")[:2000]
        self.session.add(chapter)
        self.session.flush()
        return chapter

    def sync_storyline(self, script_document_id: str) -> models.Storyline | None:
        """Rebuild the system-managed storyline from extracted chapter beats."""

        document = self.session.scalar(
            select(models.ScriptDocument).where(
                models.ScriptDocument.id == script_document_id
            )
        )
        if document is None:
            raise KeyError(script_document_id)

        episodes = list(
            self.session.scalars(
                select(models.Episode)
                .where(models.Episode.project_id == document.project_id)
                .order_by(models.Episode.position, models.Episode.created_at)
            )
        )
        if not episodes:
            return None

        marker = f"[system:chapter-extraction:{script_document_id}]"
        storyline = self.session.scalar(
            select(models.Storyline).where(
                models.Storyline.project_id == document.project_id,
                models.Storyline.description == marker,
            )
        )
        if storyline is None:
            storyline = models.Storyline(
                project_id=document.project_id,
                title="AI 章节事件",
                kind="foreshadowing",
                color="#B9473E",
                description=marker,
            )
            self.session.add(storyline)
            self.session.flush()

        existing_events = list(
            self.session.scalars(
                select(models.StorylineEvent).where(
                    models.StorylineEvent.storyline_id == storyline.id
                )
            )
        )
        generated_events = [
            event
            for event in existing_events
            if (
                event.event_metadata.get("source") == "chapter_extraction"
                and event.event_metadata.get("script_document_id")
                == script_document_id
            )
        ]
        for event in generated_events:
            self.session.delete(event)
        self.session.flush()

        reserved_positions = {
            event.position
            for event in existing_events
            if event not in generated_events
        }
        next_position = 1
        chapters = [
            chapter
            for chapter in self.list_chapters(script_document_id)
            if chapter.extraction_status == "extracted"
        ]
        for chapter in chapters:
            summary = chapter.event_summary or {}
            beats = list(summary.get("beats") or [])
            for beat_index, beat in enumerate(beats):
                while next_position in reserved_positions:
                    next_position += 1
                episode = episodes[min(chapter.chapter_index, len(episodes) - 1)]
                metadata = {
                    "source": "chapter_extraction",
                    "script_document_id": script_document_id,
                    "chapter_id": chapter.id,
                    "chapter_index": chapter.chapter_index,
                    "beat_order": beat.get("order", beat_index + 1),
                    "characters": list(beat.get("characters") or []),
                    "stakes": str(beat.get("stakes") or ""),
                    "conflicts": list(summary.get("conflicts") or []),
                    "open_threads": list(summary.get("open_threads") or []),
                    "payoff_candidates": list(
                        summary.get("payoff_candidates") or []
                    ),
                }
                event = models.StorylineEvent(
                    storyline_id=storyline.id,
                    episode_id=episode.id,
                    position=next_position,
                    stage="setup" if beat_index == 0 else "development",
                    title=str(beat.get("summary") or chapter.title or "章节事件")[:200],
                    description=str(beat.get("stakes") or ""),
                    event_metadata=metadata,
                )
                self.session.add(event)
                reserved_positions.add(next_position)
                next_position += 1
        self.session.flush()
        return storyline


def build_extraction_context(
    chapter: models.ScriptChapter,
    *,
    project_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the context payload handed to the TEXT provider."""

    return {
        "chapter_id": chapter.id,
        "chapter_index": chapter.chapter_index,
        "chapter_title": chapter.title or "",
        "chapter_text": chapter.source_text,
        "project_context": project_context or {},
    }


def chapters_to_payload(chapters: Iterable[models.ScriptChapter]) -> list[dict[str, Any]]:
    """Serialize chapters for API responses."""

    payload: list[dict[str, Any]] = []
    for chapter in chapters:
        payload.append(
            {
                "id": chapter.id,
                "chapter_index": chapter.chapter_index,
                "title": chapter.title,
                "source_text": chapter.source_text,
                "event_summary": chapter.event_summary,
                "character_ids": chapter.character_ids,
                "scene_ids": chapter.scene_ids,
                "extraction_status": chapter.extraction_status,
                "extraction_error": chapter.extraction_error,
                "created_at": chapter.created_at.isoformat() if chapter.created_at else None,
                "updated_at": chapter.updated_at.isoformat() if chapter.updated_at else None,
            }
        )
    return payload
