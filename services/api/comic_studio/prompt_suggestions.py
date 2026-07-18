from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictPromptModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MediaPromptSuggestionRequest(StrictPromptModel):
    mode: Literal["panel", "video"]


ContextLabel = Annotated[str, Field(min_length=1, max_length=80)]


class MediaPromptSuggestion(StrictPromptModel):
    mode: Literal["panel", "video"]
    prompt: str = Field(min_length=1, max_length=6000)
    negative_prompt: str = Field(default="", max_length=3000)
    rationale: str = Field(default="", max_length=1000)
    used_context: list[ContextLabel] = Field(default_factory=list, max_length=20)

    @field_validator("prompt", "negative_prompt", "rationale", mode="before")
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("used_context", mode="before")
    @classmethod
    def strip_context_labels(cls, value):
        if isinstance(value, list):
            return [item.strip() if isinstance(item, str) else item for item in value]
        return value


class GenerationContextLibraryAsset(StrictPromptModel):
    id: str
    kind: Literal["scene", "prop", "costume", "sound"]
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)


class GenerationContextCamera(StrictPromptModel):
    position: list[float]
    target: list[float]
    rotation: list[float]
    focal_length_mm: float
    shot_size: str
    camera_motion: str
    framing_guides: dict[str, Any] = Field(default_factory=dict)


class GenerationContextDirectorObject(StrictPromptModel):
    id: str
    kind: str
    source_type: str
    source_id: str | None = None
    label: str
    position: list[float]
    horizontal_facing_degrees: int


class GenerationContextDirector(StrictPromptModel):
    environment: dict[str, Any] = Field(default_factory=dict)
    camera: GenerationContextCamera | None = None
    objects: list[GenerationContextDirectorObject] = Field(default_factory=list)


class GenerationContextReference(StrictPromptModel):
    asset_id: str
    label: str
    media_url: str
    media_type: str
    role: Literal[
        "previous_shot_tail",
        "director_preview",
        "director_guidance",
        "character_reference",
        "bound_asset",
    ]
    guidance_kind: str | None = None


class ShotGenerationContext(StrictPromptModel):
    shot_id: str
    mode: Literal["panel", "video"]
    snapshot_hash: str
    prompt_constraints: str = ""
    library_assets: list[GenerationContextLibraryAsset] = Field(default_factory=list)
    director: GenerationContextDirector | None = None
    references: list[GenerationContextReference] = Field(default_factory=list)
