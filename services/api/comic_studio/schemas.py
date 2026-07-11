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
