from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict


class Capability(StrEnum):
    TEXT = "text"
    IMAGE = "image"
    SPEECH = "speech"
    VIDEO = "video"


class RuntimeJobRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: str
    capability: Capability
    status: Literal["queued", "running", "succeeded", "failed"]


class RuntimeErrorRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    retryable: bool
    capability: Capability
    provider: str


class TextStreamRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    context: dict
    purpose: Literal["script_generation", "script_import", "episode_planning"]


class ImageRuntimeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_type: Literal["shot", "character"]
    target_id: str
    activate: bool = True
    reference_type: str = "primary"
    label: str = ""


class SpeechRuntimeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dialogue_id: str


class VideoRuntimeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shot_id: str
    activate: bool = True
