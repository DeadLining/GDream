"""M2.1 — Skill file management routes.

Lets the operator list, read, and edit Markdown prompt skills under
`data/skills/*.md` without restarting the API. The SkillLoader enforces
path-traversal protection and fallback defaults.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from comic_studio.services.skill_loader import (
    SKILL_NAMES,
    SkillLoader,
    UnknownSkillError,
    get_skill_loader,
)


router = APIRouter(tags=["skills"])


class SkillRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    body: str
    source: str  # "disk" or "default"
    updated_at: str | None = None  # ISO timestamp from file mtime when on disk


class SkillSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    source: str
    updated_at: str | None = None


class SkillWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = Field(min_length=1)


def _to_summary(snapshot) -> SkillSummary:
    updated_at = (
        datetime.fromtimestamp(snapshot.mtime, tz=timezone.utc).isoformat()
        if snapshot.mtime is not None
        else None
    )
    return SkillSummary(name=snapshot.name, source=snapshot.source, updated_at=updated_at)


def _to_read(snapshot) -> SkillRead:
    updated_at = (
        datetime.fromtimestamp(snapshot.mtime, tz=timezone.utc).isoformat()
        if snapshot.mtime is not None
        else None
    )
    return SkillRead(
        name=snapshot.name, body=snapshot.body, source=snapshot.source, updated_at=updated_at
    )


@router.get("/api/skills", response_model=list[SkillSummary])
def list_skills():
    return [_to_summary(snapshot) for snapshot in get_skill_loader().list_skills()]


@router.get("/api/skills/{name}", response_model=SkillRead)
def get_skill(name: str):
    if name not in SKILL_NAMES:
        raise HTTPException(status_code=404, detail="Unknown skill")
    try:
        snapshot = get_skill_loader().get_snapshot(name)
    except UnknownSkillError:
        raise HTTPException(status_code=404, detail="Unknown skill") from None
    return _to_read(snapshot)


@router.put("/api/skills/{name}", response_model=SkillRead)
def write_skill(name: str, data: SkillWrite):
    if name not in SKILL_NAMES:
        raise HTTPException(status_code=404, detail="Unknown skill")
    try:
        snapshot = get_skill_loader().write(name, data.body)
    except UnknownSkillError:
        raise HTTPException(status_code=404, detail="Unknown skill") from None
    return _to_read(snapshot)


# Suppress unused-import warning for SkillLoader (re-exported for tests).
__all__ = ("router", "SkillLoader")
