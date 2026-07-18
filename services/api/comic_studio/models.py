from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from comic_studio.db import Base


def new_id() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(200))
    logline: Mapped[str] = mapped_column(Text)
    story_bible: Mapped[str] = mapped_column(Text)
    visual_style: Mapped[str] = mapped_column(Text)
    aspect_ratio: Mapped[str] = mapped_column(String(8), default="9:16")
    language: Mapped[str] = mapped_column(String(32), default="Chinese")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    characters: Mapped[list[Character]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Character.created_at"
    )
    episodes: Mapped[list[Episode]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Episode.created_at"
    )
    script_imports: Mapped[list[ScriptImport]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="ScriptImport.created_at"
    )
    scripts: Mapped[list[ScriptDocument]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="ScriptDocument.updated_at"
    )
    volumes: Mapped[list[Volume]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Volume.position"
    )
    library_assets: Mapped[list[LibraryAsset]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="LibraryAsset.created_at"
    )
    storylines: Mapped[list[Storyline]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Storyline.created_at"
    )
    asset_requirements: Mapped[list[AssetRequirement]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="AssetRequirement.created_at",
    )


class Volume(Base):
    __tablename__ = "volumes"
    __table_args__ = (UniqueConstraint("project_id", "position", name="uq_volume_project_position"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    project: Mapped[Project] = relationship(back_populates="volumes")
    episodes: Mapped[list[Episode]] = relationship(
        back_populates="volume", order_by="Episode.position"
    )


class LibraryAsset(Base):
    __tablename__ = "library_assets"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "kind", "name", name="uq_library_asset_project_kind_name"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    media_asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(24), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    asset_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    project: Mapped[Project] = relationship(back_populates="library_assets")
    media_asset: Mapped[Asset | None] = relationship(foreign_keys=[media_asset_id])
    scene_bindings: Mapped[list[LibraryAssetSceneBinding]] = relationship(
        back_populates="library_asset",
        cascade="all, delete-orphan",
        order_by="LibraryAssetSceneBinding.created_at",
    )


class LibraryAssetSceneBinding(Base):
    __tablename__ = "library_asset_scene_bindings"
    __table_args__ = (
        UniqueConstraint(
            "library_asset_id", "scene_id", name="uq_library_asset_scene_binding"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    library_asset_id: Mapped[str] = mapped_column(
        ForeignKey("library_assets.id", ondelete="CASCADE"), index=True
    )
    scene_id: Mapped[str] = mapped_column(
        ForeignKey("scenes.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    library_asset: Mapped[LibraryAsset] = relationship(back_populates="scene_bindings")
    scene: Mapped[Scene] = relationship(back_populates="library_asset_bindings")


class Storyline(Base):
    __tablename__ = "storylines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(32), index=True)
    color: Mapped[str] = mapped_column(String(7))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    project: Mapped[Project] = relationship(back_populates="storylines")
    events: Mapped[list[StorylineEvent]] = relationship(
        back_populates="storyline", cascade="all, delete-orphan", order_by="StorylineEvent.position"
    )


class StorylineEvent(Base):
    __tablename__ = "storyline_events"
    __table_args__ = (UniqueConstraint("storyline_id", "position", name="uq_storyline_event_position"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    storyline_id: Mapped[str] = mapped_column(ForeignKey("storylines.id", ondelete="CASCADE"), index=True)
    episode_id: Mapped[str] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), index=True)
    scene_id: Mapped[str | None] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), nullable=True, index=True)
    shot_id: Mapped[str | None] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), nullable=True, index=True)
    position: Mapped[int] = mapped_column(Integer)
    stage: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    setup_event_id: Mapped[str | None] = mapped_column(ForeignKey("storyline_events.id", ondelete="SET NULL"), nullable=True)
    payoff_event_id: Mapped[str | None] = mapped_column(ForeignKey("storyline_events.id", ondelete="SET NULL"), nullable=True)
    event_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    storyline: Mapped[Storyline] = relationship(back_populates="events", foreign_keys=[storyline_id])


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(80))
    body_plan: Mapped[str] = mapped_column(String(24), default="humanoid", server_default="humanoid")
    appearance_bible: Mapped[str] = mapped_column(Text)
    personality: Mapped[str] = mapped_column(Text)
    continuity_rules: Mapped[str] = mapped_column(Text)
    negative_constraints: Mapped[str] = mapped_column(Text, default="")
    voice_speaker: Mapped[str] = mapped_column(String(80))
    voice_instruction: Mapped[str] = mapped_column(Text, default="")
    art_style_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    project: Mapped[Project] = relationship(back_populates="characters")
    references: Mapped[list[CharacterReference]] = relationship(
        back_populates="character", cascade="all, delete-orphan", order_by="CharacterReference.created_at"
    )
    variants: Mapped[list[AssetVariant]] = relationship(
        back_populates="character", cascade="all, delete-orphan", order_by="AssetVariant.created_at"
    )
    representations_3d: Mapped[list[Character3DRepresentation]] = relationship(
        back_populates="character",
        cascade="all, delete-orphan",
        order_by="Character3DRepresentation.version",
    )


class AssetVariant(Base):
    __tablename__ = "asset_variants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    character_id: Mapped[str] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"), index=True)
    episode_id: Mapped[str | None] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), nullable=True, index=True)
    parent_variant_id: Mapped[str | None] = mapped_column(ForeignKey("asset_variants.id", ondelete="RESTRICT"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)
    label: Mapped[str] = mapped_column(String(160))
    inherited_fields: Mapped[list] = mapped_column(JSON, default=list)
    overrides: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    review_status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    character: Mapped[Character] = relationship(back_populates="variants")
    states: Mapped[list[AssetVariantState]] = relationship(
        back_populates="variant", cascade="all, delete-orphan", order_by="AssetVariantState.created_at"
    )
    usages: Mapped[list[AssetVariantUsage]] = relationship(
        back_populates="variant",
        cascade="all, delete-orphan",
        order_by="AssetVariantUsage.created_at",
        foreign_keys="AssetVariantUsage.variant_id",
    )


class AssetVariantState(Base):
    __tablename__ = "asset_variant_states"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    variant_id: Mapped[str] = mapped_column(ForeignKey("asset_variants.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    label: Mapped[str] = mapped_column(String(160))
    overrides: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    variant: Mapped[AssetVariant] = relationship(back_populates="states")
    usages: Mapped[list[AssetVariantUsage]] = relationship(
        back_populates="state", foreign_keys="AssetVariantUsage.state_id"
    )


class AssetVariantUsage(Base):
    __tablename__ = "asset_variant_usages"
    __table_args__ = (UniqueConstraint("variant_id", "shot_id", "usage_kind", name="uq_variant_shot_usage"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    variant_id: Mapped[str] = mapped_column(ForeignKey("asset_variants.id", ondelete="CASCADE"), index=True)
    state_id: Mapped[str | None] = mapped_column(ForeignKey("asset_variant_states.id", ondelete="SET NULL"), nullable=True, index=True)
    shot_id: Mapped[str] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), index=True)
    asset_id: Mapped[str | None] = mapped_column(ForeignKey("assets.id", ondelete="SET NULL"), nullable=True, index=True)
    usage_kind: Mapped[str] = mapped_column(String(24), index=True)
    effective_variant_id: Mapped[str | None] = mapped_column(
        ForeignKey("asset_variants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    effective_state_id: Mapped[str | None] = mapped_column(
        ForeignKey("asset_variant_states.id", ondelete="SET NULL"), nullable=True, index=True
    )
    effective_representation_id: Mapped[str | None] = mapped_column(
        ForeignKey("character_3d_representations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    effective_representation_version: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    director_object_id: Mapped[str | None] = mapped_column(
        ForeignKey("director_objects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    binding_status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    binding_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    variant: Mapped[AssetVariant] = relationship(
        back_populates="usages", foreign_keys=[variant_id]
    )
    state: Mapped[AssetVariantState | None] = relationship(
        back_populates="usages", foreign_keys=[state_id]
    )


class TrashItem(Base):
    __tablename__ = "trash_items"
    __table_args__ = (
        UniqueConstraint("resource_type", "resource_id", name="uq_trash_resource"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    resource_type: Mapped[str] = mapped_column(String(64), index=True)
    resource_id: Mapped[str] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(200))
    original_location: Mapped[list] = mapped_column(JSON, default=list)
    lineage: Mapped[list] = mapped_column(JSON, default=list)
    deleted_by: Mapped[str] = mapped_column(String(120), default="")
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Episode(Base):
    __tablename__ = "episodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    volume_id: Mapped[str | None] = mapped_column(
        ForeignKey("volumes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str] = mapped_column(String(200))
    premise: Mapped[str] = mapped_column(Text)
    target_duration_seconds: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    project: Mapped[Project] = relationship(back_populates="episodes")
    volume: Mapped[Volume | None] = relationship(back_populates="episodes")
    scenes: Mapped[list[Scene]] = relationship(
        back_populates="episode", cascade="all, delete-orphan", order_by="Scene.position"
    )
    script_source: Mapped[ScriptImportEpisode | None] = relationship(
        back_populates="episode", cascade="all, delete-orphan", uselist=False
    )
    review_threads: Mapped[list[ReviewThread]] = relationship(
        back_populates="episode", cascade="all, delete-orphan", order_by="ReviewThread.created_at"
    )
    release_candidates: Mapped[list[ReleaseCandidate]] = relationship(
        back_populates="episode", cascade="all, delete-orphan", order_by="ReleaseCandidate.created_at"
    )


class Scene(Base):
    __tablename__ = "scenes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    episode_id: Mapped[str] = mapped_column(
        ForeignKey("episodes.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    location: Mapped[str] = mapped_column(String(200))
    time_of_day: Mapped[str] = mapped_column(String(80), default="")
    summary: Mapped[str] = mapped_column(Text)
    continuity_state: Mapped[dict] = mapped_column(JSON, default=dict)
    estimated_duration_seconds: Mapped[float] = mapped_column(Float, default=0)

    episode: Mapped[Episode] = relationship(back_populates="scenes")
    shots: Mapped[list[Shot]] = relationship(
        back_populates="scene", cascade="all, delete-orphan", order_by="Shot.position"
    )
    director_stage: Mapped[DirectorStage | None] = relationship(
        back_populates="scene", cascade="all, delete-orphan", uselist=False
    )
    library_asset_bindings: Mapped[list[LibraryAssetSceneBinding]] = relationship(
        back_populates="scene",
        cascade="all, delete-orphan",
        order_by="LibraryAssetSceneBinding.created_at",
    )

    @property
    def reference_library_asset(self) -> LibraryAsset | None:
        for binding in self.library_asset_bindings:
            asset = binding.library_asset
            media = asset.media_asset
            if asset.kind == "scene" and media is not None and media.media_type.startswith("image/"):
                return asset
        return None

    @property
    def reference_asset_id(self) -> str | None:
        asset = self.reference_library_asset
        return asset.id if asset is not None else None

    @property
    def reference_asset_name(self) -> str | None:
        asset = self.reference_library_asset
        return asset.name if asset is not None else None

    @property
    def reference_media_url(self) -> str | None:
        asset = self.reference_library_asset
        return f"/media/{asset.media_asset.local_path}" if asset is not None else None

    @property
    def reference_media_type(self) -> str | None:
        asset = self.reference_library_asset
        return asset.media_asset.media_type if asset is not None else None


class Shot(Base):
    __tablename__ = "shots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scene_id: Mapped[str] = mapped_column(
        ForeignKey("scenes.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    shot_type: Mapped[str] = mapped_column(String(80))
    duration_seconds: Mapped[float] = mapped_column(Float)
    composition: Mapped[str] = mapped_column(Text)
    camera_motion: Mapped[str] = mapped_column(String(80), default="push_in")
    character_state: Mapped[dict] = mapped_column(JSON, default=dict)
    image_prompt: Mapped[str] = mapped_column(Text, default="")
    negative_prompt: Mapped[str] = mapped_column(Text, default="")
    active_panel_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    previous_shot_tail_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    video_prompt: Mapped[str] = mapped_column(Text, default="")
    negative_video_prompt: Mapped[str] = mapped_column(Text, default="")
    active_video_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    video_render_status: Mapped[str] = mapped_column(String(32), default="pending")
    review_status: Mapped[str] = mapped_column(String(32), default="draft")
    render_status: Mapped[str] = mapped_column(String(32), default="pending")

    scene: Mapped[Scene] = relationship(back_populates="shots")
    dialogue: Mapped[list[DialogueLine]] = relationship(
        back_populates="shot", cascade="all, delete-orphan", order_by="DialogueLine.position"
    )
    director_camera: Mapped[ShotCamera | None] = relationship(
        back_populates="shot",
        cascade="all, delete-orphan",
        uselist=False,
        foreign_keys="ShotCamera.shot_id",
    )
    visual_review_threads: Mapped[list[VisualReviewThread]] = relationship(
        back_populates="shot", cascade="all, delete-orphan", order_by="VisualReviewThread.created_at"
    )


class VisualReviewThread(Base):
    __tablename__ = "visual_review_threads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    episode_id: Mapped[str] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), index=True)
    shot_id: Mapped[str] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), index=True)
    source_asset_id: Mapped[str | None] = mapped_column(ForeignKey("assets.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(24), default="open", index=True)
    modification_scope: Mapped[str] = mapped_column(String(24), default="shot", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    shot: Mapped[Shot] = relationship(back_populates="visual_review_threads")
    annotations: Mapped[list[VisualAnnotation]] = relationship(back_populates="thread", cascade="all, delete-orphan", order_by="VisualAnnotation.created_at")
    messages: Mapped[list[VisualReviewMessage]] = relationship(back_populates="thread", cascade="all, delete-orphan", order_by="VisualReviewMessage.created_at")
    candidates: Mapped[list[VisualReviewCandidate]] = relationship(back_populates="thread", cascade="all, delete-orphan", order_by="VisualReviewCandidate.created_at")


class VisualAnnotation(Base):
    __tablename__ = "visual_annotations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    thread_id: Mapped[str] = mapped_column(ForeignKey("visual_review_threads.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)
    geometry: Mapped[dict] = mapped_column(JSON)
    color: Mapped[str] = mapped_column(String(7))
    label: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    thread: Mapped[VisualReviewThread] = relationship(back_populates="annotations")


class VisualReviewMessage(Base):
    __tablename__ = "visual_review_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    thread_id: Mapped[str] = mapped_column(ForeignKey("visual_review_threads.id", ondelete="CASCADE"), index=True)
    author_kind: Mapped[str] = mapped_column(String(24), index=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    thread: Mapped[VisualReviewThread] = relationship(back_populates="messages")


class VisualReviewCandidate(Base):
    __tablename__ = "visual_review_candidates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    thread_id: Mapped[str] = mapped_column(ForeignKey("visual_review_threads.id", ondelete="CASCADE"), index=True)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id", ondelete="RESTRICT"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="ready", index=True)
    generation_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    thread: Mapped[VisualReviewThread] = relationship(back_populates="candidates")


class ReviewThread(Base):
    __tablename__ = "review_threads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    episode_id: Mapped[str] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), index=True)
    shot_id: Mapped[str | None] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), nullable=True, index=True)
    timecode_seconds: Mapped[float] = mapped_column(Float, default=0)
    severity: Mapped[str] = mapped_column(String(24), index=True)
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(24), default="open", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    episode: Mapped[Episode] = relationship(back_populates="review_threads")
    messages: Mapped[list[ReviewMessage]] = relationship(back_populates="thread", cascade="all, delete-orphan", order_by="ReviewMessage.created_at")


class ReviewMessage(Base):
    __tablename__ = "review_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    thread_id: Mapped[str] = mapped_column(ForeignKey("review_threads.id", ondelete="CASCADE"), index=True)
    author_kind: Mapped[str] = mapped_column(String(24), index=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    thread: Mapped[ReviewThread] = relationship(back_populates="messages")


class ReleaseCandidate(Base):
    __tablename__ = "release_candidates"
    __table_args__ = (UniqueConstraint("episode_id", "version", name="uq_release_candidate_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    episode_id: Mapped[str] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), index=True)
    version: Mapped[str] = mapped_column(String(64))
    render_path: Mapped[str] = mapped_column(Text)
    qc_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    episode: Mapped[Episode] = relationship(back_populates="release_candidates")
    publications: Mapped[list[PublicationRecord]] = relationship(back_populates="candidate", cascade="all, delete-orphan", order_by="PublicationRecord.created_at")


class PublicationRecord(Base):
    __tablename__ = "publication_records"
    __table_args__ = (UniqueConstraint("candidate_id", "platform", "idempotency_key", name="uq_publication_idempotency"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("release_candidates.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(64), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), index=True)
    external_reference: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(24), default="published", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    candidate: Mapped[ReleaseCandidate] = relationship(back_populates="publications")


class DirectorStage(Base):
    __tablename__ = "director_stages"
    __table_args__ = (UniqueConstraint("scene_id", name="uq_director_stage_scene"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scene_id: Mapped[str] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    environment: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    scene: Mapped[Scene] = relationship(back_populates="director_stage")
    objects: Mapped[list[DirectorObject]] = relationship(back_populates="stage", cascade="all, delete-orphan", order_by="DirectorObject.position")
    shot_cameras: Mapped[list[ShotCamera]] = relationship(back_populates="stage", cascade="all, delete-orphan", order_by="ShotCamera.created_at")
    revisions: Mapped[list[DirectorRevision]] = relationship(back_populates="stage", cascade="all, delete-orphan", order_by="DirectorRevision.created_at")
    suggestions: Mapped[list[DirectorSuggestion]] = relationship(back_populates="stage", cascade="all, delete-orphan", order_by="DirectorSuggestion.created_at")


class DirectorObject(Base):
    __tablename__ = "director_objects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    stage_id: Mapped[str] = mapped_column(ForeignKey("director_stages.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)
    source_type: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    label: Mapped[str] = mapped_column(String(160))
    position: Mapped[int] = mapped_column(Integer, default=0)
    transform: Mapped[dict] = mapped_column(JSON, default=dict)
    appearance: Mapped[dict] = mapped_column(JSON, default=dict)
    object_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    visible: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    stage: Mapped[DirectorStage] = relationship(back_populates="objects")


class ShotCamera(Base):
    __tablename__ = "shot_cameras"
    __table_args__ = (UniqueConstraint("stage_id", "shot_id", name="uq_stage_shot_camera"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    stage_id: Mapped[str] = mapped_column(ForeignKey("director_stages.id", ondelete="CASCADE"), index=True)
    shot_id: Mapped[str] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), unique=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    position: Mapped[list] = mapped_column(JSON, default=lambda: [0, 1.6, 5])
    target: Mapped[list] = mapped_column(JSON, default=lambda: [0, 1.2, 0])
    rotation: Mapped[list] = mapped_column(JSON, default=lambda: [0, 0, 0])
    focal_length_mm: Mapped[float] = mapped_column(Float, default=50)
    near: Mapped[float] = mapped_column(Float, default=0.1)
    far: Mapped[float] = mapped_column(Float, default=1000)
    shot_size: Mapped[str] = mapped_column(String(40), default="medium")
    camera_motion: Mapped[str] = mapped_column(String(80), default="static")
    framing_guides: Mapped[dict] = mapped_column(JSON, default=dict)
    object_overrides: Mapped[dict] = mapped_column(JSON, default=dict)
    preview_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    guidance_asset_ids: Mapped[dict] = mapped_column(JSON, default=dict)
    initialized_from_shot_id: Mapped[str | None] = mapped_column(
        ForeignKey("shots.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    stage: Mapped[DirectorStage] = relationship(back_populates="shot_cameras")
    shot: Mapped[Shot] = relationship(
        back_populates="director_camera", foreign_keys=[shot_id]
    )
    revisions: Mapped[list[DirectorRevision]] = relationship(back_populates="shot_camera")


class DirectorRevision(Base):
    __tablename__ = "director_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    stage_id: Mapped[str] = mapped_column(ForeignKey("director_stages.id", ondelete="CASCADE"), index=True)
    shot_camera_id: Mapped[str | None] = mapped_column(ForeignKey("shot_cameras.id", ondelete="SET NULL"), nullable=True, index=True)
    stage_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    camera_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    reason: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    stage: Mapped[DirectorStage] = relationship(back_populates="revisions")
    shot_camera: Mapped[ShotCamera | None] = relationship(back_populates="revisions")


class DirectorSuggestion(Base):
    __tablename__ = "director_suggestions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    stage_id: Mapped[str] = mapped_column(ForeignKey("director_stages.id", ondelete="CASCADE"), index=True)
    shot_id: Mapped[str | None] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(24), index=True)
    request_context: Mapped[dict] = mapped_column(JSON, default=dict)
    suggested_patch: Mapped[dict] = mapped_column(JSON, default=dict)
    error_category: Mapped[str] = mapped_column(String(64), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    stage: Mapped[DirectorStage] = relationship(back_populates="suggestions")


class DialogueLine(Base):
    __tablename__ = "dialogue_lines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    shot_id: Mapped[str] = mapped_column(
        ForeignKey("shots.id", ondelete="CASCADE"), index=True
    )
    character_id: Mapped[str | None] = mapped_column(
        ForeignKey("characters.id", ondelete="SET NULL"), nullable=True
    )
    position: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    subtitle_text: Mapped[str] = mapped_column(Text)
    emotion: Mapped[str] = mapped_column(String(80), default="neutral")
    performance_instruction: Mapped[str] = mapped_column(Text, default="")
    audio_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    start_seconds: Mapped[float] = mapped_column(Float, default=0)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0)

    shot: Mapped[Shot] = relationship(back_populates="dialogue")


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(40))
    local_path: Mapped[str] = mapped_column(Text)
    media_type: Mapped[str] = mapped_column(String(120))
    provider: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    request_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    parent_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    generation_attempt: Mapped[int] = mapped_column(Integer, default=1)
    checksum: Mapped[str] = mapped_column(String(64))
    review_status: Mapped[str] = mapped_column(String(32), default="draft")
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    operation: Mapped[str] = mapped_column(String(80), index=True)
    target_type: Mapped[str] = mapped_column(String(40))
    target_id: Mapped[str] = mapped_column(String(36), index=True)
    status: Mapped[str] = mapped_column(String(24), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    request_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    result_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    cancellable: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class ModelInvocation(Base):
    __tablename__ = "model_invocations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    capability: Mapped[str] = mapped_column(String(24), index=True)
    provider: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    target_type: Mapped[str] = mapped_column(String(40), default="")
    target_id: Mapped[str] = mapped_column(String(36), default="", index=True)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(24), index=True)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str] = mapped_column(String(64), default="")
    retryable: Mapped[bool] = mapped_column(Boolean, default=False)
    decision_log: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Numeric(precision=12, scale=6), default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class ScriptDocument(Base):
    __tablename__ = "script_documents"
    __table_args__ = (
        UniqueConstraint("project_id", name="uq_script_document_project"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    source_type: Mapped[str] = mapped_column(String(24), index=True)
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    current_revision_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    project: Mapped[Project] = relationship(back_populates="scripts")
    revisions: Mapped[list[ScriptRevision]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="ScriptRevision.revision_number",
    )
    chapters: Mapped[list[ScriptChapter]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="ScriptChapter.chapter_index",
    )


class ScriptRevision(Base):
    __tablename__ = "script_revisions"
    __table_args__ = (
        UniqueConstraint(
            "document_id", "revision_number", name="uq_script_revision_number"
        ),
        Index(
            "uq_script_revision_working",
            "document_id",
            unique=True,
            sqlite_where=text("status = 'working'"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("script_documents.id", ondelete="CASCADE"), index=True
    )
    revision_number: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default="working", index=True)
    content: Mapped[str] = mapped_column(Text)
    checksum: Mapped[str] = mapped_column(String(64))
    creation_method: Mapped[str] = mapped_column(String(24))
    original_filename: Mapped[str] = mapped_column(String(255), default="")
    source_file_path: Mapped[str] = mapped_column(Text, default="")
    source_media_type: Mapped[str] = mapped_column(String(120), default="")
    generation_brief: Mapped[str] = mapped_column(Text, default="")
    generation_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    document: Mapped[ScriptDocument] = relationship(back_populates="revisions")
    imports: Mapped[list[ScriptImport]] = relationship(back_populates="script_revision")
    asset_requirements: Mapped[list[AssetRequirement]] = relationship(
        back_populates="script_revision",
        cascade="all, delete-orphan",
        order_by="AssetRequirement.created_at",
    )


class AssetRequirement(Base):
    __tablename__ = "asset_requirements"
    __table_args__ = (
        UniqueConstraint(
            "script_revision_id",
            "canonical_key",
            name="uq_asset_requirement_revision_key",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    script_revision_id: Mapped[str] = mapped_column(
        ForeignKey("script_revisions.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(24), index=True)
    canonical_key: Mapped[str] = mapped_column(String(240))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(24), default="missing", index=True)
    binding_type: Mapped[str] = mapped_column(String(32), default="")
    binding_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_context: Mapped[dict] = mapped_column(JSON, default=dict)
    requirement_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    project: Mapped[Project] = relationship(back_populates="asset_requirements")
    script_revision: Mapped[ScriptRevision] = relationship(
        back_populates="asset_requirements"
    )


class ScriptChapter(Base):
    __tablename__ = "script_chapters"
    __table_args__ = (
        UniqueConstraint(
            "script_document_id", "chapter_index", name="uq_script_chapter_index"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    script_document_id: Mapped[str] = mapped_column(
        ForeignKey("script_documents.id", ondelete="CASCADE"), index=True
    )
    chapter_index: Mapped[int] = mapped_column(Integer)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_text: Mapped[str] = mapped_column(Text)
    event_summary: Mapped[dict] = mapped_column(JSON, default=dict)
    character_ids: Mapped[list] = mapped_column(JSON, default=list)
    scene_ids: Mapped[list] = mapped_column(JSON, default=list)
    extraction_status: Mapped[str] = mapped_column(
        String(24), default="pending", index=True
    )
    extraction_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    document: Mapped[ScriptDocument] = relationship(back_populates="chapters")


class ScriptImport(Base):
    __tablename__ = "script_imports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    script_revision_id: Mapped[str | None] = mapped_column(
        ForeignKey("script_revisions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(24), default="uploaded", index=True)
    mode: Mapped[str] = mapped_column(String(24), default="auto")
    source_format: Mapped[str] = mapped_column(String(24))
    original_filename: Mapped[str] = mapped_column(String(255), default="")
    checksum: Mapped[str] = mapped_column(String(64))
    extracted_text: Mapped[str] = mapped_column(Text)
    structured_draft: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    error_category: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project] = relationship(back_populates="script_imports")
    script_revision: Mapped[ScriptRevision | None] = relationship(back_populates="imports")
    generated_episodes: Mapped[list[ScriptImportEpisode]] = relationship(
        back_populates="script_import", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def generated_episode_ids(self) -> list[str]:
        return [item.episode_id for item in self.generated_episodes]


class ScriptImportEpisode(Base):
    __tablename__ = "script_import_episodes"
    __table_args__ = (
        UniqueConstraint(
            "script_import_id", "episode_id", name="uq_script_import_episode"
        ),
        UniqueConstraint("episode_id", name="uq_episode_script_source"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    script_import_id: Mapped[str] = mapped_column(
        ForeignKey("script_imports.id", ondelete="CASCADE"), index=True
    )
    episode_id: Mapped[str] = mapped_column(
        ForeignKey("episodes.id", ondelete="CASCADE"), index=True
    )
    draft_episode_id: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    script_import: Mapped[ScriptImport] = relationship(back_populates="generated_episodes")
    episode: Mapped[Episode] = relationship(back_populates="script_source")


class CharacterReference(Base):
    __tablename__ = "character_references"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    character_id: Mapped[str] = mapped_column(
        ForeignKey("characters.id", ondelete="CASCADE"), index=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("assets.id", ondelete="RESTRICT"), index=True
    )
    reference_type: Mapped[str] = mapped_column(String(32), index=True)
    label: Mapped[str] = mapped_column(String(120), default="")
    position: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    review_status: Mapped[str] = mapped_column(String(32), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    character: Mapped[Character] = relationship(back_populates="references")


class Character3DRepresentation(Base):
    __tablename__ = "character_3d_representations"
    __table_args__ = (
        UniqueConstraint("character_id", "version", name="uq_character_3d_version"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    character_id: Mapped[str] = mapped_column(
        ForeignKey("characters.id", ondelete="CASCADE"), index=True
    )
    variant_id: Mapped[str | None] = mapped_column(
        ForeignKey("asset_variants.id", ondelete="CASCADE"), nullable=True, index=True
    )
    state_id: Mapped[str | None] = mapped_column(
        ForeignKey("asset_variant_states.id", ondelete="CASCADE"), nullable=True, index=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("assets.id", ondelete="RESTRICT"), index=True
    )
    label: Mapped[str] = mapped_column(String(160))
    format: Mapped[str] = mapped_column(String(16), default="glb")
    version: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    review_status: Mapped[str] = mapped_column(String(32), default="approved", index=True)
    bounds: Mapped[dict] = mapped_column(JSON, default=dict)
    mesh_count: Mapped[int] = mapped_column(Integer, default=0)
    triangle_count: Mapped[int] = mapped_column(Integer, default=0)
    material_count: Mapped[int] = mapped_column(Integer, default=0)
    has_skeleton: Mapped[bool] = mapped_column(Boolean, default=False)
    representation_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    character: Mapped[Character] = relationship(back_populates="representations_3d")
    asset: Mapped[Asset] = relationship(foreign_keys=[asset_id])


class ProductionRun(Base):
    __tablename__ = "production_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    episode_id: Mapped[str] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    scope_type: Mapped[str] = mapped_column(String(16), default="episode", index=True)
    shot_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    stages: Mapped[list] = mapped_column(JSON, default=list)
    concurrency: Mapped[int] = mapped_column(Integer, default=2)
    regenerate_panels: Mapped[bool] = mapped_column(Boolean, default=False)
    regenerate_speech: Mapped[bool] = mapped_column(Boolean, default=False)
    regenerate_videos: Mapped[bool] = mapped_column(Boolean, default=False)
    panel_generation_mode: Mapped[str] = mapped_column(String(16), default="solo")
    budget_cap_usd: Mapped[float | None] = mapped_column(Numeric(precision=12, scale=6), nullable=True)
    spent_usd: Mapped[float] = mapped_column(Numeric(precision=12, scale=6), default=0)
    budget_mode: Mapped[str] = mapped_column(String(16), default="observe")
    pause_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    total_items: Mapped[int] = mapped_column(Integer, default=0)
    queued_items: Mapped[int] = mapped_column(Integer, default=0)
    running_items: Mapped[int] = mapped_column(Integer, default=0)
    succeeded_items: Mapped[int] = mapped_column(Integer, default=0)
    failed_items: Mapped[int] = mapped_column(Integer, default=0)
    skipped_items: Mapped[int] = mapped_column(Integer, default=0)
    summary_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    items: Mapped[list[ProductionItem]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="ProductionItem.position"
    )


class ProductionItem(Base):
    __tablename__ = "production_items"
    __table_args__ = (UniqueConstraint("run_id", "stage", "target_id", name="uq_production_item_target"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("production_runs.id", ondelete="CASCADE"), index=True)
    stage: Mapped[str] = mapped_column(String(24))
    target_type: Mapped[str] = mapped_column(String(24))
    target_id: Mapped[str] = mapped_column(String(160), index=True)
    position: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    result_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    run: Mapped[ProductionRun] = relationship(back_populates="items")


class EpisodeAIRun(Base):
    __tablename__ = "episode_ai_runs"
    __table_args__ = (
        UniqueConstraint("episode_id", "idempotency_key", name="uq_episode_ai_run_idempotency"),
        UniqueConstraint("episode_id", "active_slot", name="uq_episode_ai_run_active_slot"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    episode_id: Mapped[str] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    current_stage: Mapped[str] = mapped_column(String(40), default="references", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    automation_policy: Mapped[dict] = mapped_column(JSON, default=dict)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    active_slot: Mapped[str | None] = mapped_column(String(16), default="active", nullable=True)
    pause_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    stages: Mapped[list[EpisodeAIRunStage]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="EpisodeAIRunStage.position",
    )


class EpisodeAIRunStage(Base):
    __tablename__ = "episode_ai_run_stages"
    __table_args__ = (UniqueConstraint("run_id", "stage", name="uq_episode_ai_run_stage"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("episode_ai_runs.id", ondelete="CASCADE"), index=True)
    stage: Mapped[str] = mapped_column(String(40), index=True)
    position: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    input_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    output_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    run: Mapped[EpisodeAIRun] = relationship(back_populates="stages")


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "email", name="uq_project_member_email"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254))
    role: Mapped[str] = mapped_column(String(64), index=True)
    scope: Mapped[dict] = mapped_column(JSON, default=dict)
    capabilities: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class ProductionTask(Base):
    __tablename__ = "production_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    episode_id: Mapped[str | None] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), nullable=True, index=True)
    scene_id: Mapped[str | None] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), nullable=True, index=True)
    shot_id: Mapped[str | None] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), nullable=True, index=True)
    review_thread_id: Mapped[str | None] = mapped_column(ForeignKey("visual_review_threads.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[str] = mapped_column(String(24), default="medium", index=True)
    status: Mapped[str] = mapped_column(String(24), default="todo", index=True)
    assignee: Mapped[str] = mapped_column(String(120), default="")
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    checklist: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class EpisodeVersion(Base):
    __tablename__ = "episode_versions"
    __table_args__ = (UniqueConstraint("episode_id", "version", name="uq_episode_version_number"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    episode_id: Mapped[str] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(160))
    source: Mapped[str] = mapped_column(String(24), index=True)
    author: Mapped[str] = mapped_column(String(120), default="")
    snapshot: Mapped[dict] = mapped_column(JSON)
    restored_from_id: Mapped[str | None] = mapped_column(ForeignKey("episode_versions.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class DeliveryPackage(Base):
    __tablename__ = "delivery_packages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    episode_id: Mapped[str] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), index=True)
    release_candidate_id: Mapped[str] = mapped_column(ForeignKey("release_candidates.id", ondelete="RESTRICT"), index=True)
    preset_name: Mapped[str] = mapped_column(String(160))
    outputs: Mapped[list] = mapped_column(JSON, default=list)
    checks: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    artifact_path: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class ProductionCanvasLayout(Base):
    __tablename__ = "production_canvas_layouts"
    __table_args__ = (
        UniqueConstraint("episode_id", name="uq_production_canvas_episode"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    episode_id: Mapped[str] = mapped_column(
        ForeignKey("episodes.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    layout: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class ProductionWorkflowBinding(Base):
    __tablename__ = "production_workflow_bindings"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "capability", "name", name="uq_production_workflow_name"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    capability: Mapped[str] = mapped_column(String(24), index=True)
    name: Mapped[str] = mapped_column(String(160))
    workflow_id: Mapped[str] = mapped_column(String(200))
    workflow_version: Mapped[int] = mapped_column(Integer, default=1)
    input_mapping_version: Mapped[int] = mapped_column(Integer, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class RenderReviewRecord(Base):
    """M1.2: post-render self-review result for a rendered MP4.

    Records ffprobe summary, black-frame positions, silence ranges, and
    subtitle presence so that failed renders never silently surface as
    publishable.
    """

    __tablename__ = "render_review_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    episode_id: Mapped[str] = mapped_column(String(36), index=True)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    render_path: Mapped[str] = mapped_column(Text)
    ffprobe_json: Mapped[dict] = mapped_column(JSON, default=dict)
    black_frame_positions: Mapped[list] = mapped_column(JSON, default=list)
    silence_ranges: Mapped[list] = mapped_column(JSON, default=list)
    subtitle_present: Mapped[bool] = mapped_column(Boolean, default=False)
    overall_pass: Mapped[bool] = mapped_column(Boolean, default=True)
    findings: Mapped[list] = mapped_column(JSON, default=list)
    slideshow_risk: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ImageProxyCache(Base):
    """M4.4: on-disk cache for remote images (object storage / CDN URLs).

    Keeps a stable ``url_hash`` (SHA-256 of the source URL) so repeated
    requests for the same remote image are served from local disk instead of
    re-fetching. Rows may expire; expired entries are pruned on access.
    """

    __tablename__ = "image_proxy_cache"

    url_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    url: Mapped[str] = mapped_column(Text, index=True)
    local_path: Mapped[str] = mapped_column(Text)
    media_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    byte_size: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
