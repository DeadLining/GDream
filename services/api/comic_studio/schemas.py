from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


AspectRatio = Literal["9:16", "16:9", "1:1"]


class CharacterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(min_length=1, max_length=80)
    appearance_bible: str = Field(min_length=1)
    personality: str = Field(min_length=1)
    continuity_rules: str = Field(min_length=1)
    negative_constraints: str = ""
    voice_speaker: str = Field(min_length=1, max_length=80)
    voice_instruction: str = ""


class CharacterRead(CharacterCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    created_at: datetime
    updated_at: datetime


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    logline: str = Field(min_length=1)
    story_bible: str = Field(min_length=1)
    visual_style: str = Field(min_length=1)
    aspect_ratio: AspectRatio = "9:16"
    language: str = Field(default="Chinese", min_length=1, max_length=32)


class ProjectRead(ProjectCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime


class ProjectDetail(ProjectRead):
    characters: list[CharacterRead] = []


class EpisodeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    premise: str = Field(min_length=1)
    target_duration_seconds: int = Field(ge=15, le=1800)


class DialogueRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    character_id: str | None
    position: int
    text: str
    subtitle_text: str
    emotion: str
    performance_instruction: str
    audio_asset_id: str | None
    start_seconds: float
    duration_seconds: float


class ShotRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    position: int
    shot_type: str
    duration_seconds: float
    composition: str
    camera_motion: str
    character_state: dict
    image_prompt: str
    negative_prompt: str
    active_panel_asset_id: str | None
    review_status: str
    render_status: str
    dialogue: list[DialogueRead] = []


class SceneRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    position: int
    location: str
    time_of_day: str
    summary: str
    continuity_state: dict
    estimated_duration_seconds: float
    shots: list[ShotRead] = []


class EpisodeRead(EpisodeCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    status: str
    created_at: datetime
    updated_at: datetime


class EpisodeDetail(EpisodeRead):
    scenes: list[SceneRead] = []


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    operation: str
    target_type: str
    target_id: str
    status: str
    progress: int
    result_metadata: dict
    error: str
    retry_count: int
    created_at: datetime
    updated_at: datetime


class PlannedDialogue(BaseModel):
    character_id: str | None
    text: str = Field(min_length=1)
    subtitle_text: str = Field(min_length=1)
    emotion: str = "neutral"
    performance_instruction: str = ""


class PlannedShot(BaseModel):
    shot_type: str = Field(min_length=1)
    duration_seconds: float = Field(gt=0, le=30)
    composition: str = Field(min_length=1)
    camera_motion: str = "push_in"
    character_state: dict = {}
    image_prompt: str = Field(min_length=1)
    negative_prompt: str = ""
    dialogue: list[PlannedDialogue] = []


class PlannedScene(BaseModel):
    location: str = Field(min_length=1)
    time_of_day: str = ""
    summary: str = Field(min_length=1)
    continuity_state: dict = {}
    estimated_duration_seconds: float = Field(gt=0)
    shots: list[PlannedShot] = Field(min_length=1)


class EpisodePlan(BaseModel):
    scenes: list[PlannedScene] = Field(min_length=1)
