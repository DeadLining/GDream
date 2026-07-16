"""Add persistent episode AI orchestration runs and stages."""

from alembic import op
import sqlalchemy as sa


revision = "20260725_33"
down_revision = "20260724_32"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "episode_ai_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("episode_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("current_stage", sa.String(40), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("automation_policy", sa.JSON(), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("active_slot", sa.String(16), nullable=True),
        sa.Column("pause_requested", sa.Boolean(), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["episode_id"], ["episodes.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("episode_id", "idempotency_key", name="uq_episode_ai_run_idempotency"),
        sa.UniqueConstraint("episode_id", "active_slot", name="uq_episode_ai_run_active_slot"),
    )
    for column in ("episode_id", "status", "current_stage"):
        op.create_index(f"ix_episode_ai_runs_{column}", "episode_ai_runs", [column])

    op.create_table(
        "episode_ai_run_stages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("stage", sa.String(40), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("input_snapshot", sa.JSON(), nullable=False),
        sa.Column("output_metadata", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["episode_ai_runs.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("run_id", "stage", name="uq_episode_ai_run_stage"),
    )
    for column in ("run_id", "stage", "status"):
        op.create_index(f"ix_episode_ai_run_stages_{column}", "episode_ai_run_stages", [column])


def downgrade() -> None:
    op.drop_table("episode_ai_run_stages")
    op.drop_table("episode_ai_runs")
