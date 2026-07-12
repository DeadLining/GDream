from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
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


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(80))
    appearance_bible: Mapped[str] = mapped_column(Text)
    personality: Mapped[str] = mapped_column(Text)
    continuity_rules: Mapped[str] = mapped_column(Text)
    negative_constraints: Mapped[str] = mapped_column(Text, default="")
    voice_speaker: Mapped[str] = mapped_column(String(80))
    voice_instruction: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    project: Mapped[Project] = relationship(back_populates="characters")
    references: Mapped[list[CharacterReference]] = relationship(
        back_populates="character", cascade="all, delete-orphan", order_by="CharacterReference.created_at"
    )


class Episode(Base):
    __tablename__ = "episodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    premise: Mapped[str] = mapped_column(Text)
    target_duration_seconds: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    project: Mapped[Project] = relationship(back_populates="episodes")
    scenes: Mapped[list[Scene]] = relationship(
        back_populates="episode", cascade="all, delete-orphan", order_by="Scene.position"
    )
    script_source: Mapped[ScriptImportEpisode | None] = relationship(
        back_populates="episode", cascade="all, delete-orphan", uselist=False
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
        back_populates="shot", cascade="all, delete-orphan", uselist=False
    )


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    stage: Mapped[DirectorStage] = relationship(back_populates="shot_cameras")
    shot: Mapped[Shot] = relationship(back_populates="director_camera")
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class ScriptDocument(Base):
    __tablename__ = "script_documents"

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


class ProductionRun(Base):
    __tablename__ = "production_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    episode_id: Mapped[str] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    stages: Mapped[list] = mapped_column(JSON, default=list)
    concurrency: Mapped[int] = mapped_column(Integer, default=2)
    regenerate_panels: Mapped[bool] = mapped_column(Boolean, default=False)
    regenerate_speech: Mapped[bool] = mapped_column(Boolean, default=False)
    regenerate_videos: Mapped[bool] = mapped_column(Boolean, default=False)
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
    target_id: Mapped[str] = mapped_column(String(36), index=True)
    position: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    result_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    run: Mapped[ProductionRun] = relationship(back_populates="items")
