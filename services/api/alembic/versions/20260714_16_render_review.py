"""Add render_review_records table for post-render self-review."""

from alembic import op
import sqlalchemy as sa


revision = "20260714_16"
down_revision = "20260714_15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "render_review_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("episode_id", sa.String(36), nullable=False),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("render_path", sa.Text(), nullable=False),
        sa.Column("ffprobe_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("black_frame_positions", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("silence_ranges", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("subtitle_present", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("overall_pass", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("findings", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_render_review_records_episode_id",
        "render_review_records",
        ["episode_id"],
    )
    op.create_index(
        "ix_render_review_records_job_id",
        "render_review_records",
        ["job_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_render_review_records_job_id", table_name="render_review_records")
    op.drop_index("ix_render_review_records_episode_id", table_name="render_review_records")
    op.drop_table("render_review_records")
