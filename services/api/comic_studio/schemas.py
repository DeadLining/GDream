import re
from datetime import datetime
from typing import Annotated, Literal

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
ProviderChannelKind = Literal["llm", "image", "tts", "video", "model3d"]
SafeIdentifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9._-]{1,64}$")]


class MockSshStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    host_id: SafeIdentifier
    alias: SafeIdentifier


class MockSshHostRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: SafeIdentifier
    name: str
    type: str


class MockSshStatusRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    desired_running: bool
    state: Literal["stopped", "starting", "running", "stopping", "failed"]
    host_id: str = ""
    alias: str = ""
    port: int | None = Field(default=None, ge=1, le=65535)
    error: str | None = None
    reused: bool = False


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
        value = value.strip()
        if value and not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", value):
            raise ValueError("Invalid SSH host alias")
        return value

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
    video: ProviderChannelRead
    model3d: ProviderChannelRead
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


class ProviderHealthStatusRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "failed", "disabled"]
    model: str
    host: str
    elapsed_ms: int = Field(ge=0)
    check_scope: Literal["model", "endpoint", "audio"]
    error: str | None = None


class ProviderHealthRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    llm: ProviderHealthStatusRead
    image: ProviderHealthStatusRead
    tts: ProviderHealthStatusRead
    video: ProviderHealthStatusRead
    model3d: ProviderHealthStatusRead


class PatchModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CharacterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(min_length=1, max_length=80)
    body_plan: Literal["humanoid", "quadruped", "bird", "other"] = "humanoid"
    appearance_bible: str = Field(min_length=1)
    personality: str = Field(min_length=1)
    continuity_rules: str = Field(min_length=1)
    negative_constraints: str = ""
    voice_speaker: str = Field(min_length=1, max_length=80)
    voice_instruction: str = ""
    art_style_id: str | None = None


class CharacterRead(CharacterCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    created_at: datetime
    updated_at: datetime


class CharacterPatch(PatchModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: str | None = Field(default=None, min_length=1, max_length=80)
    body_plan: Literal["humanoid", "quadruped", "bird", "other"] | None = None
    appearance_bible: str | None = Field(default=None, min_length=1)
    personality: str | None = Field(default=None, min_length=1)
    continuity_rules: str | None = Field(default=None, min_length=1)
    negative_constraints: str | None = None
    voice_speaker: str | None = Field(default=None, min_length=1, max_length=80)
    voice_instruction: str | None = None
    art_style_id: str | None = None


ASSET_OVERRIDE_FIELDS = {
    "identity", "face", "hair", "body", "age", "outfit", "injury",
    "expression", "eyes", "brows", "mouth", "accessories", "voice",
}


class AssetOverridesModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("overrides", check_fields=False)
    @classmethod
    def validate_override_fields(cls, value: dict) -> dict:
        invalid = sorted(set(value) - ASSET_OVERRIDE_FIELDS)
        if invalid:
            raise ValueError(f"Unsupported override fields: {', '.join(invalid)}")
        return value


class AssetVariantCreate(AssetOverridesModel):
    kind: Literal["master", "episode"]
    label: str = Field(min_length=1, max_length=160)
    episode_id: str | None = Field(default=None, max_length=36)
    parent_variant_id: str | None = Field(default=None, max_length=36)
    inherited_fields: list[str] = Field(default_factory=list, max_length=32)
    overrides: dict = Field(default_factory=dict)

    @field_validator("inherited_fields")
    @classmethod
    def validate_inherited_fields(cls, value: list[str]) -> list[str]:
        invalid = sorted(set(value) - ASSET_OVERRIDE_FIELDS)
        if invalid:
            raise ValueError(f"Unsupported inherited fields: {', '.join(invalid)}")
        return value


class AssetVariantPatch(AssetOverridesModel):
    kind: Literal["master", "episode"] | None = None
    label: str | None = Field(default=None, min_length=1, max_length=160)
    episode_id: str | None = Field(default=None, max_length=36)
    parent_variant_id: str | None = Field(default=None, max_length=36)
    inherited_fields: list[str] | None = Field(default=None, max_length=32)
    overrides: dict | None = None

    @field_validator("inherited_fields")
    @classmethod
    def validate_inherited_fields(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        invalid = sorted(set(value) - ASSET_OVERRIDE_FIELDS)
        if invalid:
            raise ValueError(f"Unsupported inherited fields: {', '.join(invalid)}")
        return value


class AssetVariantStateCreate(AssetOverridesModel):
    kind: Literal["expression", "outfit", "injury", "age", "custom"]
    label: str = Field(min_length=1, max_length=160)
    overrides: dict = Field(default_factory=dict)


class AssetVariantStatePatch(AssetOverridesModel):
    kind: Literal["expression", "outfit", "injury", "age", "custom"] | None = None
    label: str | None = Field(default=None, min_length=1, max_length=160)
    overrides: dict | None = None


class AssetVariantUsageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state_id: str | None = Field(default=None, max_length=36)
    shot_id: str = Field(min_length=1, max_length=36)
    asset_id: str | None = Field(default=None, max_length=36)
    usage_kind: Literal["panel", "video", "reference"]


class AssetVariantUsageRead(AssetVariantUsageCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    variant_id: str
    effective_variant_id: str | None
    effective_state_id: str | None
    effective_representation_id: str | None
    effective_representation_version: int | None
    director_object_id: str | None
    binding_status: Literal[
        "pending",
        "resolved",
        "fallback",
        "missing_representation",
        "missing_director_object",
        "invalid_scope",
    ]
    binding_updated_at: datetime | None
    created_at: datetime


class AssetVariantStateRead(AssetVariantStateCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    variant_id: str
    version: int
    created_at: datetime
    updated_at: datetime


class AssetVariantRead(AssetVariantCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    character_id: str
    version: int
    review_status: ReviewStatus
    created_at: datetime
    updated_at: datetime
    states: list[AssetVariantStateRead] = []
    usages: list[AssetVariantUsageRead] = []


class AssetImpactShotRead(BaseModel):
    id: str
    position: int
    composition: str


class AssetImpactSceneRead(BaseModel):
    scene_id: str
    scene_label: str
    shots: list[AssetImpactShotRead]


class AssetImpactEpisodeRead(BaseModel):
    episode_id: str
    episode_title: str
    scenes: list[AssetImpactSceneRead]


class AssetVariantImpactRead(BaseModel):
    shots: list[str]
    assets: list[str]
    usage_count: int
    episodes: list[AssetImpactEpisodeRead] = Field(default_factory=list)


class TrashItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    resource_type: Literal["asset_variant", "asset_variant_state"]
    resource_id: str
    name: str
    original_location: list[str]
    lineage: list[str]
    deleted_by: str
    deleted_at: datetime
    expires_at: datetime
    reference_count: int
    can_permanently_delete: bool


class TrashRestoreRead(BaseModel):
    restored: bool
    resource_type: Literal["asset_variant", "asset_variant_state"]
    resource_id: str


class WorkspaceProjectSummary(BaseModel):
    project_id: str
    title: str
    logline: str
    volume_count: int
    episode_count: int
    scene_count: int
    shot_count: int
    open_task_count: int
    pending_review_count: int
    completion_percent: int
    current_stage: str
    latest_task_titles: list[str]
    updated_at: datetime


class WorkspaceSummaryRead(BaseModel):
    active_project_count: int
    active_task_count: int
    pending_review_count: int
    updated_today_count: int
    projects: list[WorkspaceProjectSummary]


class ProjectSearchResult(BaseModel):
    kind: Literal["script", "character", "asset_variant", "asset_state", "episode", "scene", "shot", "review", "task"]
    id: str
    title: str
    subtitle: str
    hierarchy: list[str] = []
    status: str = ""
    project_id: str
    episode_id: str | None = None
    scene_id: str | None = None
    shot_id: str | None = None
    character_id: str | None = None
    variant_id: str | None = None
    state_id: str | None = None
    reference_count: int = 0


class ProjectSearchRead(BaseModel):
    query: str
    results: list[ProjectSearchResult]


class VisualReviewThreadCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_asset_id: str | None = Field(default=None, max_length=36)
    title: str = Field(min_length=1, max_length=200)
    modification_scope: Literal["shot", "episode", "master"] = "shot"


class VisualReviewThreadPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    modification_scope: Literal["shot", "episode", "master"]


class VisualAnnotationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["circle", "rectangle", "path"]
    geometry: dict
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    label: str = Field(default="", max_length=120)

    @model_validator(mode="after")
    def validate_geometry(self):
        if self.kind == "circle":
            keys = ("cx", "cy", "rx", "ry")
            if set(self.geometry) != set(keys):
                raise ValueError("Circle geometry requires cx, cy, rx, and ry")
            values = [self.geometry[key] for key in keys]
            if not all(isinstance(value, (int, float)) for value in values):
                raise ValueError("Circle geometry values must be numeric")
            cx, cy, rx, ry = values
            if not (0 <= cx <= 1 and 0 <= cy <= 1 and 0 < rx <= 1 and 0 < ry <= 1):
                raise ValueError("Annotation geometry must use normalized coordinates")
            if cx - rx < 0 or cx + rx > 1 or cy - ry < 0 or cy + ry > 1:
                raise ValueError("Annotation geometry must stay inside the canvas")
        elif self.kind == "rectangle":
            keys = ("x", "y", "width", "height")
            if set(self.geometry) != set(keys):
                raise ValueError("Rectangle geometry requires x, y, width, and height")
            x, y, width, height = [self.geometry[key] for key in keys]
            if not all(isinstance(value, (int, float)) for value in (x, y, width, height)):
                raise ValueError("Rectangle geometry values must be numeric")
            if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < width <= 1 and 0 < height <= 1 and x + width <= 1 and y + height <= 1):
                raise ValueError("Annotation geometry must stay inside the canvas")
        else:
            points = self.geometry.get("points")
            if set(self.geometry) != {"points"} or not isinstance(points, list) or len(points) < 2 or len(points) > 200:
                raise ValueError("Path geometry requires 2 to 200 points")
            if not all(isinstance(point, list) and len(point) == 2 and all(isinstance(value, (int, float)) and 0 <= value <= 1 for value in point) for point in points):
                raise ValueError("Path points must use normalized coordinates")
        return self


class VisualAnnotationPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["circle", "rectangle", "path"] | None = None
    geometry: dict | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    label: str | None = Field(default=None, max_length=120)


class VisualReviewMessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    author_kind: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1, max_length=20000)


class VisualReviewCandidateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asset_id: str = Field(min_length=1, max_length=36)
    generation_metadata: dict = Field(default_factory=dict)


class VisualAnnotationRead(VisualAnnotationCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    thread_id: str
    created_at: datetime


class VisualReviewMessageRead(VisualReviewMessageCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    thread_id: str
    created_at: datetime


class VisualReviewCandidateRead(VisualReviewCandidateCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    thread_id: str
    status: Literal["ready", "accepted", "rejected", "failed"]
    created_at: datetime
    updated_at: datetime


class VisualReviewThreadRead(VisualReviewThreadCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    episode_id: str
    shot_id: str
    status: Literal["open", "resolved"]
    created_at: datetime
    updated_at: datetime
    annotations: list[VisualAnnotationRead] = []
    messages: list[VisualReviewMessageRead] = []
    candidates: list[VisualReviewCandidateRead] = []


class ReviewThreadCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shot_id: str | None = Field(default=None, max_length=36)
    timecode_seconds: float = Field(default=0, ge=0, le=86400)
    severity: Literal["critical", "major", "minor"]
    title: str = Field(min_length=1, max_length=200)


class ReviewThreadPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["open", "resolved"]


class ReviewMessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    author_kind: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1, max_length=20000)


class ReviewMessageRead(ReviewMessageCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    thread_id: str
    created_at: datetime


class ReviewThreadRead(ReviewThreadCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    episode_id: str
    status: Literal["open", "resolved"]
    created_at: datetime
    updated_at: datetime
    messages: list[ReviewMessageRead] = []


class ReleaseCandidateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: str = Field(min_length=1, max_length=64)
    render_path: str = Field(min_length=1, max_length=1000)
    qc_snapshot: dict = Field(default_factory=dict)

    @field_validator("render_path")
    @classmethod
    def validate_render_path(cls, value: str) -> str:
        normalized = value.strip().replace("\\", "/")
        if normalized.startswith("/") or any(part == ".." for part in normalized.split("/")):
            raise ValueError("render_path must be a relative data path")
        return normalized


class ReleaseCandidateRead(ReleaseCandidateCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    episode_id: str
    status: Literal["draft", "approved", "published"]
    created_at: datetime
    updated_at: datetime


class ReleaseGateRead(BaseModel):
    ready: bool
    production_ready: bool
    production_blockers: dict
    open_critical_threads: list[str]


class PublicationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    platform: Literal["internal_master", "short_video", "widescreen"]
    idempotency_key: str = Field(pattern=r"^[A-Za-z0-9._:-]{1,128}$")


class PublicationRead(PublicationCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    candidate_id: str
    external_reference: str
    status: Literal["published", "failed"]
    created_at: datetime
    published_at: datetime | None


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


class VolumeEpisodeCreate(EpisodeCreate):
    model_config = ConfigDict(extra="forbid")
    position: int = Field(ge=1, le=10000)


class EpisodeDeletionCounts(BaseModel):
    scenes: int
    shots: int
    dialogue_lines: int
    assets: int


class EpisodeDeletionPreview(BaseModel):
    episode_id: str
    title: str
    deleted: EpisodeDeletionCounts


class EpisodeDeletionRead(EpisodeDeletionPreview):
    deleted_episode_id: str
    cleanup_warnings: list[str]


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
    character_id: str | None = None
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
    video_prompt: str
    negative_video_prompt: str
    active_video_asset_id: str | None
    video_render_status: str
    review_status: str
    render_status: str
    dialogue: list[DialogueRead] = []


class ShotPatch(PatchModel):
    shot_type: str | None = Field(default=None, min_length=1, max_length=80)
    duration_seconds: float | None = Field(default=None, gt=0, le=30)
    composition: str | None = Field(default=None, min_length=1)
    camera_motion: str | None = Field(default=None, min_length=1, max_length=80)
    character_state: dict | None = None
    image_prompt: str | None = Field(default=None, min_length=1)
    negative_prompt: str | None = None
    review_status: ReviewStatus | None = None
    video_prompt: str | None = None
    negative_video_prompt: str | None = None


class ShotCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shot_type: str = Field(min_length=1, max_length=80)
    duration_seconds: float = Field(gt=0, le=30)
    composition: str = Field(min_length=1)
    camera_motion: str = Field(default="static", min_length=1, max_length=80)
    character_state: dict = Field(default_factory=dict)
    image_prompt: str = Field(min_length=1)
    negative_prompt: str = ""
    video_prompt: str = ""
    negative_video_prompt: str = ""


class SceneCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    location: str = Field(min_length=1, max_length=200)
    time_of_day: str = Field(default="", max_length=80)
    summary: str = Field(min_length=1)
    continuity_state: dict = Field(default_factory=dict)
    estimated_duration_seconds: float = Field(gt=0, le=1800)


class ScenePatch(PatchModel):
    location: str | None = Field(default=None, min_length=1, max_length=200)
    time_of_day: str | None = Field(default=None, max_length=80)
    summary: str | None = Field(default=None, min_length=1)
    continuity_state: dict | None = None
    estimated_duration_seconds: float | None = Field(default=None, gt=0, le=1800)


class StructureOrderUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[str] = Field(min_length=1, max_length=10000)


class StructureMutationRead(BaseModel):
    episode_id: str
    resource_id: str
    affected_shot_ids: list[str]
    invalidated_stages: list[Literal["panels", "videos"]]


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
    volume_id: str | None
    position: int
    status: str
    created_at: datetime
    updated_at: datetime


class EpisodePatch(PatchModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    premise: str | None = Field(default=None, min_length=1)
    target_duration_seconds: int | None = Field(default=None, ge=15, le=1800)
    volume_id: str | None = None
    position: int | None = Field(default=None, ge=0, le=10000)


class VolumeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(default="", max_length=10000)
    position: int = Field(ge=1, le=10000)


class VolumePatch(PatchModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    summary: str | None = Field(default=None, max_length=10000)
    position: int | None = Field(default=None, ge=1, le=10000)


class EpisodeVolumeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    volume_id: str | None


class VolumeRead(VolumeCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    created_at: datetime
    updated_at: datetime
    episodes: list[EpisodeRead] = []


StorylineKind = Literal["foreshadowing", "character_arc", "conflict", "mystery", "theme"]
StorylineStage = Literal["setup", "development", "escalation", "payoff", "resolved"]


class StorylineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    kind: StorylineKind
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    description: str = Field(default="", max_length=20000)


class StorylinePatch(PatchModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    kind: StorylineKind | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    description: str | None = Field(default=None, max_length=20000)


class StorylineEventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    episode_id: str = Field(min_length=1, max_length=36)
    scene_id: str | None = Field(default=None, max_length=36)
    shot_id: str | None = Field(default=None, max_length=36)
    position: int = Field(ge=1, le=10000)
    stage: StorylineStage
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=20000)
    setup_event_id: str | None = Field(default=None, max_length=36)
    payoff_event_id: str | None = Field(default=None, max_length=36)
    metadata: dict = Field(default_factory=dict)


class StorylineEventPatch(PatchModel):
    episode_id: str | None = Field(default=None, min_length=1, max_length=36)
    scene_id: str | None = Field(default=None, max_length=36)
    shot_id: str | None = Field(default=None, max_length=36)
    position: int | None = Field(default=None, ge=1, le=10000)
    stage: StorylineStage | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=20000)
    setup_event_id: str | None = Field(default=None, max_length=36)
    payoff_event_id: str | None = Field(default=None, max_length=36)
    metadata: dict | None = None


class StorylineEventRead(StorylineEventCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    storyline_id: str
    created_at: datetime
    updated_at: datetime
    metadata: dict = Field(
        default_factory=dict,
        validation_alias="event_metadata",
        serialization_alias="metadata",
    )

class StorylineRead(StorylineCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    created_at: datetime
    updated_at: datetime
    events: list[StorylineEventRead] = []


class ProjectDetail(ProjectRead):
    characters: list[CharacterRead] = []
    episodes: list[EpisodeRead] = []


class ProjectOverviewMetrics(BaseModel):
    project_id: str
    scene_count: int
    script_locked: bool
    asset_total: int
    asset_ready: int


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
    is_stale: bool = False
    stale_reason: Literal[
        "missing_provenance", "inputs_changed", "inputs_unavailable"
    ] | None = None


LibraryAssetKind = Literal["scene", "prop", "costume", "sound"]
LibraryAssetTag = Annotated[str, Field(min_length=1, max_length=80)]


class LibraryAssetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: LibraryAssetKind
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=20000)
    tags: list[LibraryAssetTag] = Field(default_factory=list, max_length=50)
    metadata: dict = Field(default_factory=dict)


class LibraryAssetPatch(PatchModel):
    kind: LibraryAssetKind | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=20000)
    tags: list[LibraryAssetTag] | None = Field(default=None, max_length=50)
    metadata: dict | None = None


class LibraryAssetRead(LibraryAssetCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    media_asset_id: str | None = None
    media_url: str | None = None
    media_type: str | None = None
    created_at: datetime
    updated_at: datetime


ReferenceType = Literal["primary", "front", "three_quarter", "side", "back", "expression", "outfit"]


class CharacterReferencePatch(PatchModel):
    label: str | None = Field(default=None, max_length=120)
    position: int | None = Field(default=None, ge=0)
    review_status: ReviewStatus | None = None


class CharacterReferenceGenerate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reference_type: ReferenceType
    label: str = Field(default="", max_length=120)


class CharacterReferenceRead(BaseModel):
    id: str
    character_id: str
    reference_type: str
    label: str
    position: int
    is_active: bool
    review_status: str
    created_at: datetime
    asset: AssetRead


class Character3DRepresentationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    character_id: str
    variant_id: str | None
    state_id: str | None
    asset_id: str
    label: str
    format: Literal["glb"]
    version: int
    is_active: bool
    review_status: ReviewStatus
    model_url: str
    mesh_count: int
    triangle_count: int
    material_count: int
    has_skeleton: bool
    bounds: dict
    metadata: dict
    created_at: datetime
    updated_at: datetime


ProductionStage = Literal["panels", "speech", "videos"]


class ProductionRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stages: list[ProductionStage] = Field(min_length=1)
    concurrency: int = Field(default=2, ge=1, le=4)
    regenerate_panels: bool = False
    regenerate_speech: bool = False
    regenerate_videos: bool = False
    panel_generation_mode: Literal["solo", "grid"] = "solo"
    budget_cap_usd: float | None = Field(default=None, ge=0)
    budget_mode: Literal["observe", "warn", "cap"] = "observe"
    shot_ids: list[str] | None = None


class ProductionRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str; episode_id: str; status: str; stages: list[str]; concurrency: int
    scope_type: str; shot_ids: list[str] | None
    regenerate_panels: bool; regenerate_speech: bool; regenerate_videos: bool; panel_generation_mode: str; pause_requested: bool
    budget_cap_usd: float | None; spent_usd: float; budget_mode: str
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


class EpisodeAIRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=128)
    automation_policy: dict = Field(default_factory=dict)


class EpisodeAIRunStageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    run_id: str
    stage: str
    position: int
    status: str
    attempt_count: int
    input_snapshot: dict
    output_metadata: dict
    error: str
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class EpisodeAIRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    episode_id: str
    status: str
    current_stage: str
    progress: int
    automation_policy: dict
    idempotency_key: str
    pause_requested: bool
    error: str
    stages: list[EpisodeAIRunStageRead]
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


MemberRole = Literal["producer", "writer", "editor", "character_artist", "storyboard_artist", "director", "reviewer", "admin"]
MemberStatus = Literal["active", "invited", "disabled"]
TaskPriority = Literal["low", "medium", "high", "critical"]
TaskStatus = Literal["todo", "in_progress", "review", "completed", "cancelled"]


class ProjectMemberCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$", max_length=254)
    role: MemberRole
    scope: dict = Field(default_factory=dict)
    capabilities: dict = Field(default_factory=dict)


class ProjectMemberPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: MemberRole | None = None
    scope: dict | None = None
    capabilities: dict | None = None
    status: MemberStatus | None = None


class ProjectMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    name: str
    email: str
    role: str
    scope: dict
    capabilities: dict
    status: str
    created_at: datetime
    updated_at: datetime


class TaskChecklistItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=200)
    done: bool = False


class ProductionTaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    priority: TaskPriority = "medium"
    assignee: str = Field(default="", max_length=120)
    due_at: datetime | None = None
    episode_id: str | None = None
    scene_id: str | None = None
    shot_id: str | None = None
    review_thread_id: str | None = None
    checklist: list[TaskChecklistItem] = Field(default_factory=list, max_length=100)


class ProductionTaskPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    priority: TaskPriority | None = None
    status: TaskStatus | None = None
    assignee: str | None = Field(default=None, max_length=120)
    due_at: datetime | None = None
    checklist: list[TaskChecklistItem] | None = Field(default=None, max_length=100)


class ProductionTaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    episode_id: str | None
    scene_id: str | None
    shot_id: str | None
    review_thread_id: str | None
    title: str
    description: str
    priority: str
    status: str
    assignee: str
    due_at: datetime | None
    checklist: list[dict]
    created_at: datetime
    updated_at: datetime


class EpisodeVersionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=160)
    source: Literal["manual", "autosave", "checkpoint"]
    author: str = Field(default="", max_length=120)


class EpisodeVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    episode_id: str
    version: int
    label: str
    source: str
    author: str
    snapshot: dict
    restored_from_id: str | None
    created_at: datetime


class DeliveryOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["landscape_video", "vertical_video", "clean_master", "subtitles", "audio_mix", "asset_manifest"]
    format: str = Field(min_length=1, max_length=32)
    enabled: bool = True


class DeliveryPackageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    release_candidate_id: str
    preset_name: str = Field(min_length=1, max_length=160)
    outputs: list[DeliveryOutput] = Field(min_length=1, max_length=20)


class DeliveryPackageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    episode_id: str
    release_candidate_id: str
    preset_name: str
    outputs: list[dict]
    checks: dict
    status: str
    artifact_path: str
    created_at: datetime
    updated_at: datetime


class ProductionCanvasLayoutPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1, 2, 3]
    viewport: dict[str, float]
    nodes: dict[str, dict[str, float]]
    expanded_shots: list[str] = Field(default_factory=list)
    pinned_shots: list[str] = Field(default_factory=list)
    collapsed_scene_ids: list[str] = Field(default_factory=list)


class ProductionCanvasLayoutRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    episode_id: str
    version: int
    layout: ProductionCanvasLayoutPayload
    updated_at: datetime


class ProductionWorkflowBindingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    capability: Literal["panel", "video"]
    name: str
    workflow_id: str
    workflow_version: int
    input_mapping_version: int
    enabled: bool


class ProductionWorkflowBindingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workflow_id: str = Field(min_length=1, max_length=200)
    workflow_version: int = Field(ge=1)
    input_mapping_version: int = Field(ge=1)
    enabled: bool = True


class ProductionGraphSceneRead(BaseModel):
    id: str
    position: int
    location: str
    summary: str


class ProductionGraphShotRead(BaseModel):
    id: str
    scene_id: str
    position: int
    shot_type: str
    duration_seconds: float
    composition: str
    review_status: str
    render_status: str
    video_render_status: str
    active_panel_asset_id: str | None
    active_panel_media_url: str | None = None
    previous_shot_tail_asset_id: str | None = None
    active_video_asset_id: str | None
    active_video_media_url: str | None = None
    dialogue_ids: list[str] = Field(default_factory=list)
    dialogue_count: int = 0
    speech_ready_count: int = 0


class ProductionGraphAssetRead(BaseModel):
    id: str
    kind: Literal["variant", "state", "asset"]
    label: str
    media_url: str | None = None
    version: int
    status: str
    shot_ids: list[str]


class ProductionMediaDependencyRead(BaseModel):
    source_shot_id: str
    target_shot_id: str
    source_kind: str
    target_kind: str


class EpisodeProductionGraphRead(BaseModel):
    episode_id: str
    project_id: str
    scenes: list[ProductionGraphSceneRead]
    shots: list[ProductionGraphShotRead]
    assets: list[ProductionGraphAssetRead]
    production_items: list[ProductionItemRead]
    media_dependencies: list[ProductionMediaDependencyRead]
    workflow_bindings: list[ProductionWorkflowBindingRead]
