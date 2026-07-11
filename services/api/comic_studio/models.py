from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
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
    review_status: Mapped[str] = mapped_column(String(32), default="draft")
    render_status: Mapped[str] = mapped_column(String(32), default="pending")

    scene: Mapped[Scene] = relationship(back_populates="shots")
    dialogue: Mapped[list[DialogueLine]] = relationship(
        back_populates="shot", cascade="all, delete-orphan", order_by="DialogueLine.position"
    )


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


class ProductionRun(Base):
    __tablename__ = "production_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    episode_id: Mapped[str] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    stages: Mapped[list] = mapped_column(JSON, default=list)
    concurrency: Mapped[int] = mapped_column(Integer, default=2)
    regenerate_panels: Mapped[bool] = mapped_column(Boolean, default=False)
    regenerate_speech: Mapped[bool] = mapped_column(Boolean, default=False)
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
