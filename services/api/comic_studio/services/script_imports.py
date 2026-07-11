from __future__ import annotations

from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from comic_studio import models
from comic_studio.redaction import redact
from comic_studio.script_imports import ScriptImportConfirm, ScriptImportDraft


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


def _normalized_name(value: str) -> str:
    return "".join(value.split()).casefold()


def _translate_character_state(value: dict, character_ids: dict[str, str]) -> dict:
    return {
        character_ids.get(key, key): item
        for key, item in value.items()
    }


class ScriptImportConfirmationService:
    def __init__(self, session: Session):
        self.session = session

    def confirm(
        self,
        import_id: str,
        confirmation: ScriptImportConfirm,
    ) -> models.ScriptImport:
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
        if script_import.status == "applied":
            raise RuntimeError("already_applied")
        if script_import.status != "ready":
            raise RuntimeError(f"import_not_ready:{script_import.status}")

        draft = ScriptImportDraft.model_validate(script_import.structured_draft)
        project = script_import.project
        existing_by_id = {character.id: character for character in project.characters}
        existing_by_name = {
            _normalized_name(character.name): character for character in project.characters
        }
        draft_ids = {character.draft_id for character in draft.characters}
        unknown_mappings = set(confirmation.character_mappings) - draft_ids
        if unknown_mappings:
            raise ValueError("unknown_draft_character_mapping")

        script_import.status = "applying"
        try:
            character_ids: dict[str, str] = {}
            for character in draft.characters:
                mapped_id = confirmation.character_mappings.get(character.draft_id)
                if mapped_id:
                    mapped = existing_by_id.get(mapped_id)
                    if mapped is None:
                        raise ValueError("mapped_character_not_in_project")
                else:
                    mapped = existing_by_name.get(_normalized_name(character.name))
                if mapped is None:
                    mapped = models.Character(
                        project_id=project.id,
                        name=character.name.strip(),
                        role=character.role,
                        appearance_bible=character.appearance_bible,
                        personality=character.personality,
                        continuity_rules=character.continuity_rules,
                        negative_constraints=character.negative_constraints,
                        voice_speaker=character.voice_speaker,
                        voice_instruction=character.voice_instruction,
                    )
                    self.session.add(mapped)
                    self.session.flush()
                character_ids[character.draft_id] = mapped.id

            for planned_episode in draft.episodes:
                if not planned_episode.enabled:
                    continue
                episode = models.Episode(
                    project_id=project.id,
                    title=planned_episode.title,
                    premise=planned_episode.premise,
                    target_duration_seconds=planned_episode.target_duration_seconds,
                    status="planned",
                )
                self.session.add(episode)
                self.session.flush()
                for scene_position, planned_scene in enumerate(
                    planned_episode.scenes, start=1
                ):
                    scene = models.Scene(
                        episode_id=episode.id,
                        position=scene_position,
                        location=planned_scene.location,
                        time_of_day=planned_scene.time_of_day,
                        summary=planned_scene.summary,
                        continuity_state=planned_scene.continuity_state,
                        estimated_duration_seconds=planned_scene.estimated_duration_seconds,
                    )
                    self.session.add(scene)
                    self.session.flush()
                    for shot_position, planned_shot in enumerate(
                        planned_scene.shots, start=1
                    ):
                        shot = models.Shot(
                            scene_id=scene.id,
                            position=shot_position,
                            shot_type=planned_shot.shot_type,
                            duration_seconds=planned_shot.duration_seconds,
                            composition=planned_shot.composition,
                            camera_motion=planned_shot.camera_motion,
                            character_state=_translate_character_state(
                                planned_shot.character_state, character_ids
                            ),
                            image_prompt=planned_shot.image_prompt,
                            negative_prompt=planned_shot.negative_prompt,
                        )
                        self.session.add(shot)
                        self.session.flush()
                        for line_position, planned_line in enumerate(
                            planned_shot.dialogue, start=1
                        ):
                            character_id = (
                                None
                                if planned_line.narration
                                else character_ids[planned_line.speaker_draft_id]
                            )
                            self.session.add(
                                models.DialogueLine(
                                    shot_id=shot.id,
                                    character_id=character_id,
                                    position=line_position,
                                    text=planned_line.text,
                                    subtitle_text=planned_line.subtitle_text,
                                    emotion=planned_line.emotion,
                                    performance_instruction=planned_line.performance_instruction,
                                )
                            )
            script_import.status = "applied"
            script_import.applied_at = models.utc_now()
            self.session.commit()
            self.session.refresh(script_import)
            return script_import
        except Exception:
            self.session.rollback()
            raise
