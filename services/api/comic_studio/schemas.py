from datetime import datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    ValidationInfo,
    field_validator,
    model_validator,
)

from comic_studio.provider_channels import validate_http_url


AspectRatio = Literal["9:16", "16:9", "1:1"]
ReviewStatus = Literal["draft", "needs_changes", "approved"]
ProviderChannelKind = Literal["llm", "image", "tts"]


class ProviderChannelUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    name: str
    enabled: bool
    base_url: str
    model: str
    api_key: SecretStr = SecretStr("")
    clear_api_key: bool = False
    ssh_host: str = ""

    @field_validator("name", "base_url", "model")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("base_url")
    @classmethod
    def validate_enabled_base_url(cls, value: str, info: ValidationInfo) -> str:
        if info.data.get("enabled") and value:
            validate_http_url(value)
        return value

    @field_validator("ssh_host")
    @classmethod
    def strip_optional_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("api_key", mode="before")
    @classmethod
    def strip_api_key(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("clear_api_key")
    @classmethod
    def validate_secret_operation(cls, value: bool, info: ValidationInfo) -> bool:
        api_key = info.data.get("api_key")
        if value and api_key and api_key.get_secret_value():
            raise ValueError("api_key and clear_api_key are mutually exclusive")
        return value

    @model_validator(mode="after")
    def validate_enabled_connection(self):
        if not self.enabled:
            return self
        missing = [
            field for field in ("name", "base_url", "model") if not getattr(self, field)
        ]
        if missing:
            raise ValueError(f"Enabled channel requires: {', '.join(missing)}")
        return self


class ProviderChannelRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    enabled: bool
    base_url: str
    model: str
    ssh_host: str
    api_key_configured: bool
    api_key_masked: str


class ProviderChannelPersistenceRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["defaults", "saved"]
    file_path: str


class ProviderChannelsRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    llm: ProviderChannelRead
    image: ProviderChannelRead
    tts: ProviderChannelRead
    persistence: ProviderChannelPersistenceRead
    reloaded_at: datetime


class ProviderChannelUpdateRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: ProviderChannelRead
    current: ProviderChannelsRead


class ProviderChannelTestRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "failed"]
    model: str
    host: str
    elapsed_ms: int = Field(ge=0)
    check_scope: Literal["model", "endpoint", "audio"]
    error: str | None = None


class PatchModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


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


class CharacterPatch(PatchModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: str | None = Field(default=None, min_length=1, max_length=80)
    appearance_bible: str | None = Field(default=None, min_length=1)
    personality: str | None = Field(default=None, min_length=1)
    continuity_rules: str | None = Field(default=None, min_length=1)
    negative_constraints: str | None = None
    voice_speaker: str | None = Field(default=None, min_length=1, max_length=80)
    voice_instruction: str | None = None


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


class ProjectPatch(PatchModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    logline: str | None = Field(default=None, min_length=1)
    story_bible: str | None = Field(default=None, min_length=1)
    visual_style: str | None = Field(default=None, min_length=1)
    aspect_ratio: AspectRatio | None = None
    language: str | None = Field(default=None, min_length=1, max_length=32)


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


class DialoguePatch(PatchModel):
    text: str | None = Field(default=None, min_length=1)
    subtitle_text: str | None = Field(default=None, min_length=1)
    emotion: str | None = Field(default=None, min_length=1, max_length=80)
    performance_instruction: str | None = None
    start_seconds: float | None = Field(default=None, ge=0)


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


class ShotPatch(PatchModel):
    duration_seconds: float | None = Field(default=None, gt=0, le=30)
    composition: str | None = Field(default=None, min_length=1)
    camera_motion: str | None = Field(default=None, min_length=1, max_length=80)
    image_prompt: str | None = Field(default=None, min_length=1)
    negative_prompt: str | None = None
    review_status: ReviewStatus | None = None


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


class EpisodePatch(PatchModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    premise: str | None = Field(default=None, min_length=1)
    target_duration_seconds: int | None = Field(default=None, ge=15, le=1800)


class ProjectDetail(ProjectRead):
    characters: list[CharacterRead] = []
    episodes: list[EpisodeRead] = []


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


class AssetRead(BaseModel):
    id: str
    kind: str
    media_url: str
    media_type: str
    provider: str
    model: str
    generation_attempt: int
    review_status: str
    width: int | None
    height: int | None
    duration_seconds: float | None
    created_at: datetime


ProductionStage = Literal["panels", "speech"]


class ProductionRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stages: list[ProductionStage] = Field(min_length=1)
    concurrency: int = Field(default=2, ge=1, le=4)
    regenerate_panels: bool = False
    regenerate_speech: bool = False


class ProductionRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str; episode_id: str; status: str; stages: list[str]; concurrency: int
    regenerate_panels: bool; regenerate_speech: bool; pause_requested: bool
    total_items: int; queued_items: int; running_items: int; succeeded_items: int
    failed_items: int; skipped_items: int; summary_error: str
    created_at: datetime; updated_at: datetime


class ProductionItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str; run_id: str; stage: str; target_type: str; target_id: str
    position: int; status: str; attempt_count: int; result_metadata: dict; error: str
    created_at: datetime; updated_at: datetime


class ProductionRetry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_ids: list[str] | None = None


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

    @field_validator("character_state", mode="before")
    @classmethod
    def normalize_character_state(cls, value):
        return {"description": value} if isinstance(value, str) else value


class PlannedScene(BaseModel):
    location: str = Field(min_length=1)
    time_of_day: str = ""
    summary: str = Field(min_length=1)
    continuity_state: dict = {}
    estimated_duration_seconds: float = Field(gt=0)
    shots: list[PlannedShot] = Field(min_length=1)

    @field_validator("continuity_state", mode="before")
    @classmethod
    def normalize_continuity_state(cls, value):
        return {"description": value} if isinstance(value, str) else value


class EpisodePlan(BaseModel):
    scenes: list[PlannedScene] = Field(min_length=1)
