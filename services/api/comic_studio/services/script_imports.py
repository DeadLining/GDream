from __future__ import annotations

from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models
from comic_studio.redaction import redact
from comic_studio.script_imports import ScriptImportDraft


class ScriptImportPlanner(Protocol):
    async def parse_script_import(self, context: dict) -> ScriptImportDraft: ...


class ScriptImportParserService:
    def __init__(self, session: Session, planner: ScriptImportPlanner):
        self.session = session
        self.planner = planner

    async def parse(self, import_id: str) -> models.ScriptImport:
        statement = (
            select(models.ScriptImport)
            .options(
                selectinload(models.ScriptImport.project).selectinload(
                    models.Project.characters
                )
            )
            .where(models.ScriptImport.id == import_id)
        )
        script_import = self.session.scalar(statement)
        if script_import is None:
            raise KeyError(import_id)
        if script_import.status in {"parsing", "applying", "applied"}:
            raise RuntimeError(f"import_not_parseable:{script_import.status}")

        previous_draft = script_import.structured_draft
        script_import.status = "parsing"
        script_import.error = ""
        script_import.error_category = ""
        self.session.commit()
        context = {
            "mode": script_import.mode,
            "text": script_import.extracted_text,
            "project": {
                "title": script_import.project.title,
                "story_bible": script_import.project.story_bible,
                "visual_style": script_import.project.visual_style,
                "aspect_ratio": script_import.project.aspect_ratio,
            },
            "existing_characters": [
                character.name for character in script_import.project.characters
            ],
            "desired_episode_duration_seconds": 60,
        }
        try:
            draft = await self.planner.parse_script_import(context)
            script_import.structured_draft = draft.model_dump(mode="json")
            script_import.status = "ready"
            self.session.commit()
            self.session.refresh(script_import)
            return script_import
        except Exception as exc:
            self.session.rollback()
            script_import = self.session.get(models.ScriptImport, import_id)
            if script_import is not None:
                script_import.structured_draft = previous_draft
                script_import.status = "failed"
                script_import.error_category = "provider_failure"
                script_import.error = str(redact(str(exc)))[:1000]
                self.session.commit()
            raise
