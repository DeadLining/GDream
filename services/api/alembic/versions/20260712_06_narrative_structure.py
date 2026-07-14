"""Add volumes, stable episode order, and cross-episode storylines."""

from alembic import op
import sqlalchemy as sa


revision = "20260712_06"
down_revision = "20260712_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "volumes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("project_id", "position", name="uq_volume_project_position"),
    )
    op.create_index("ix_volumes_project_id", "volumes", ["project_id"])

    inspector = sa.inspect(op.get_bind())
    if "episodes" in inspector.get_table_names():
        with op.batch_alter_table("episodes") as batch:
            batch.add_column(sa.Column("volume_id", sa.String(36), nullable=True))
            batch.add_column(sa.Column("position", sa.Integer(), nullable=False, server_default="0"))
            batch.create_foreign_key("fk_episodes_volume_id", "volumes", ["volume_id"], ["id"], ondelete="SET NULL")
            batch.create_unique_constraint("uq_episode_volume_position", ["volume_id", "position"])
        op.create_index("ix_episodes_volume_id", "episodes", ["volume_id"])

    op.create_table(
        "storylines",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_storylines_project_id", "storylines", ["project_id"])
    op.create_index("ix_storylines_kind", "storylines", ["kind"])

    op.create_table(
        "storyline_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("storyline_id", sa.String(36), sa.ForeignKey("storylines.id", ondelete="CASCADE"), nullable=False),
        sa.Column("episode_id", sa.String(36), sa.ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scene_id", sa.String(36), sa.ForeignKey("scenes.id", ondelete="CASCADE"), nullable=True),
        sa.Column("shot_id", sa.String(36), sa.ForeignKey("shots.id", ondelete="CASCADE"), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("stage", sa.String(32), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("setup_event_id", sa.String(36), sa.ForeignKey("storyline_events.id", ondelete="SET NULL"), nullable=True),
        sa.Column("payoff_event_id", sa.String(36), sa.ForeignKey("storyline_events.id", ondelete="SET NULL"), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("storyline_id", "position", name="uq_storyline_event_position"),
    )
    for name in ("storyline_id", "episode_id", "scene_id", "shot_id", "stage"):
        op.create_index(f"ix_storyline_events_{name}", "storyline_events", [name])


def downgrade() -> None:
    op.drop_table("storyline_events")
    op.drop_table("storylines")
    inspector = sa.inspect(op.get_bind())
    if "episodes" in inspector.get_table_names():
        with op.batch_alter_table("episodes") as batch:
            batch.drop_column("position")
            batch.drop_column("volume_id")
    op.drop_table("volumes")
