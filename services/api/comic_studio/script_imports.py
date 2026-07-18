from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictDraftModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ScriptImportProjectSuggestion(StrictDraftModel):
    title: str = Field(min_length=1, max_length=200)
    logline: str = Field(min_length=1)


class ScriptImportCharacter(StrictDraftModel):
    draft_id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    aliases: list[str] = []
    role: str = Field(min_length=1, max_length=80)
    appearance_bible: str = Field(min_length=1)
    personality: str = Field(min_length=1)
    continuity_rules: str = Field(min_length=1)
    negative_constraints: str = ""
    voice_speaker: str = Field(min_length=1, max_length=80)
    voice_instruction: str = ""


class ScriptImportDialogue(StrictDraftModel):
    speaker_draft_id: str | None = None
    narration: bool = False
    text: str = Field(min_length=1)
    subtitle_text: str = Field(min_length=1)
    emotion: str = "neutral"
    performance_instruction: str = ""

    @model_validator(mode="after")
    def validate_speaker(self):
        if self.narration and self.speaker_draft_id is not None:
            raise ValueError("narration cannot have speaker_draft_id")
        if not self.narration and self.speaker_draft_id is None:
            raise ValueError("spoken dialogue requires speaker_draft_id")
        return self


class ScriptImportShot(StrictDraftModel):
    shot_type: str = Field(min_length=1)
    duration_seconds: float = Field(gt=0, le=30)
    composition: str = Field(min_length=1)
    camera_motion: str = "push_in"
    character_state: dict = {}
    image_prompt: str = Field(min_length=1)
    negative_prompt: str = ""
    dialogue: list[ScriptImportDialogue] = []


class ScriptImportProp(StrictDraftModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    required: bool = True


class ScriptImportScene(StrictDraftModel):
    location: str = Field(min_length=1, max_length=200)
    time_of_day: str = ""
    summary: str = Field(min_length=1)
    continuity_state: dict = {}
    props: list[ScriptImportProp] = []
    estimated_duration_seconds: float = Field(gt=0)
    shots: list[ScriptImportShot] = Field(min_length=1)


class ScriptImportEpisode(StrictDraftModel):
    draft_id: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    title: str = Field(min_length=1, max_length=200)
    premise: str = Field(min_length=1)
    target_duration_seconds: int = Field(ge=15, le=1800)
    scenes: list[ScriptImportScene] = Field(min_length=1)


class ScriptImportWarning(StrictDraftModel):
    code: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1)
    path: str = ""


class ScriptImportDraft(StrictDraftModel):
    project: ScriptImportProjectSuggestion
    characters: list[ScriptImportCharacter]
    episodes: list[ScriptImportEpisode] = Field(min_length=1)
    warnings: list[ScriptImportWarning] = []

    @model_validator(mode="after")
    def validate_references(self):
        character_ids = [character.draft_id for character in self.characters]
        if len(character_ids) != len(set(character_ids)):
            raise ValueError("duplicate character draft_id")
        episode_ids = [episode.draft_id for episode in self.episodes]
        if len(episode_ids) != len(set(episode_ids)):
            raise ValueError("duplicate episode draft_id")
        known = set(character_ids)
        for episode in self.episodes:
            for scene in episode.scenes:
                for shot in scene.shots:
                    unknown_state_ids = set(shot.character_state) - known
                    if unknown_state_ids:
                        raise ValueError(
                            "unknown character_state draft_id: "
                            + ", ".join(sorted(unknown_state_ids))
                        )
                    for line in shot.dialogue:
                        if line.speaker_draft_id is not None and line.speaker_draft_id not in known:
                            raise ValueError(
                                f"unknown speaker_draft_id: {line.speaker_draft_id}"
                            )
        return self


class ScriptImportCreate(StrictDraftModel):
    mode: Literal["generate", "auto", "screenplay", "prose"] = "auto"
    text: str = ""

    @model_validator(mode="after")
    def validate_source(self):
        if self.mode != "generate" and not self.text.strip():
            raise ValueError("source text is required")
        return self


class ScriptImportConfirm(StrictDraftModel):
    character_mappings: dict[str, str] = {}


class ScriptImportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    script_revision_id: str | None
    status: str
    mode: str
    source_format: str
    original_filename: str
    checksum: str
    extracted_text: str
    structured_draft: dict
    error: str
    error_category: str
    created_at: datetime
    updated_at: datetime
    applied_at: datetime | None
    generated_episode_ids: list[str] = []


class ScriptImportModeForm(StrictDraftModel):
    mode: Literal["generate", "auto", "screenplay", "prose"] = "auto"

    @field_validator("mode", mode="before")
    @classmethod
    def normalize_mode(cls, value):
        return value or "auto"
