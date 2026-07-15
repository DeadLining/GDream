from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Capability(StrEnum):
    TEXT = "text"
    IMAGE = "image"
    SPEECH = "speech"
    VIDEO = "video"
    MODEL_3D = "model3d"


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


class AssetVariantSuggestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character_id: str
    episode_id: str | None = None
    message: str
    character: dict[str, Any]
    episode: dict[str, Any] | None = None
    conversation: list[dict[str, str]] = Field(default_factory=list)
    annotations: list[dict[str, Any]] = Field(default_factory=list)


class AssetVariantSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["episode", "state"]
    label: str
    summary: str
    inherited_fields: list[str]
    overrides: dict[str, Any]
    state_kind: Literal["expression", "outfit", "injury", "age", "custom"] | None = None
    assistant_message: str

    @model_validator(mode="after")
    def validate_state_kind(self):
        if self.kind == "state" and self.state_kind is None:
            raise ValueError("state suggestion requires state_kind")
        if self.kind == "episode" and self.state_kind is not None:
            raise ValueError("episode suggestion cannot have state_kind")
        return self


class ImageRuntimeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_type: Literal["shot", "character"]
    target_id: str
    activate: bool = True
    reference_type: str = "primary"
    label: str = ""
    mode: Literal["single", "reference_set"] = "single"

    @model_validator(mode="after")
    def validate_mode_target(self):
        if self.mode == "reference_set" and self.target_type != "character":
            raise ValueError("reference_set mode requires a character target")
        return self


class SpeechRuntimeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dialogue_id: str


class VideoRuntimeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shot_id: str
    activate: bool = True


class Model3DRuntimeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_type: Literal["character", "library_asset"]
    target_id: str
    reference_asset_id: str | None = None
