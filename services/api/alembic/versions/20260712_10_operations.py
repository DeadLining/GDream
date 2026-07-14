"""Add operational collaboration, tasks, versions, delivery, audit, and preferences."""

from alembic import op
import sqlalchemy as sa


revision = "20260712_10"
down_revision = "20260712_09"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("role", sa.String(64), nullable=False),
        sa.Column("scope", sa.JSON(), nullable=False),
        sa.Column("capabilities", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("project_id", "email", name="uq_project_member_email"),
    )
    for name in ("project_id", "role", "status"):
        op.create_index(f"ix_project_members_{name}", "project_members", [name])
    op.create_table(
        "production_tasks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("episode_id", sa.String(36), sa.ForeignKey("episodes.id", ondelete="CASCADE"), nullable=True),
        sa.Column("scene_id", sa.String(36), sa.ForeignKey("scenes.id", ondelete="CASCADE"), nullable=True),
        sa.Column("shot_id", sa.String(36), sa.ForeignKey("shots.id", ondelete="CASCADE"), nullable=True),
        sa.Column("review_thread_id", sa.String(36), sa.ForeignKey("visual_review_threads.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("priority", sa.String(24), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("assignee", sa.String(120), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checklist", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for name in ("project_id", "episode_id", "scene_id", "shot_id", "review_thread_id", "priority", "status"):
        op.create_index(f"ix_production_tasks_{name}", "production_tasks", [name])
    op.create_table(
        "episode_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("episode_id", sa.String(36), sa.ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("source", sa.String(24), nullable=False),
        sa.Column("author", sa.String(120), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("restored_from_id", sa.String(36), sa.ForeignKey("episode_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("episode_id", "version", name="uq_episode_version_number"),
    )
    for name in ("episode_id", "source", "restored_from_id"):
        op.create_index(f"ix_episode_versions_{name}", "episode_versions", [name])
    op.create_table(
        "delivery_packages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("episode_id", sa.String(36), sa.ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("release_candidate_id", sa.String(36), sa.ForeignKey("release_candidates.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("preset_name", sa.String(160), nullable=False),
        sa.Column("outputs", sa.JSON(), nullable=False),
        sa.Column("checks", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("artifact_path", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for name in ("project_id", "episode_id", "release_candidate_id", "status"):
        op.create_index(f"ix_delivery_packages_{name}", "delivery_packages", [name])
    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor", sa.String(120), nullable=False),
        sa.Column("action", sa.String(120), nullable=False),
        sa.Column("target_type", sa.String(64), nullable=False),
        sa.Column("target_id", sa.String(36), nullable=False),
        sa.Column("result", sa.String(24), nullable=False),
        sa.Column("before", sa.JSON(), nullable=False),
        sa.Column("after", sa.JSON(), nullable=False),
        sa.Column("previous_hash", sa.String(64), nullable=False),
        sa.Column("immutable_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for name in ("project_id", "action", "target_type", "target_id", "result", "created_at"):
        op.create_index(f"ix_audit_events_{name}", "audit_events", [name])
    op.create_table(
        "user_preferences",
        sa.Column("owner_key", sa.String(64), primary_key=True),
        sa.Column("density", sa.String(24), nullable=False),
        sa.Column("theme", sa.String(24), nullable=False),
        sa.Column("language", sa.String(32), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("default_landing", sa.String(24), nullable=False),
        sa.Column("canvas", sa.JSON(), nullable=False),
        sa.Column("review", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("user_preferences")
    op.drop_table("audit_events")
    op.drop_table("delivery_packages")
    op.drop_table("episode_versions")
    op.drop_table("production_tasks")
    op.drop_table("project_members")
