from typing import Annotated, Literal

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
