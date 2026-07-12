from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ScriptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    source_type: Literal["ai", "paste"]
    content: str = Field(default="", max_length=500_000)


class ScriptPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, max_length=500_000)
    expected_checksum: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def require_checksum_for_content(self):
        if self.content is not None and self.expected_checksum is None:
            raise ValueError("expected_checksum_required")
        return self


class ScriptRevisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    revision_number: int
    status: str
    content: str
    checksum: str
    creation_method: str
    original_filename: str
    source_file_path: str
    source_media_type: str
    generation_brief: str
    generation_metadata: dict
    created_at: datetime


class ScriptDocumentSummary(BaseModel):
    id: str
    project_id: str
    title: str
    source_type: str
    status: str
    revision_count: int
    current_revision_id: str | None
    created_at: datetime
    updated_at: datetime


class ScriptDocumentRead(ScriptDocumentSummary):
    current_revision: ScriptRevisionRead
    latest_import_id: str | None = None
    parse_is_stale: bool = False
