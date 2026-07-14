"""Add scope_type + shot_ids to production_runs for shot-group reruns."""

from alembic import op
import sqlalchemy as sa


revision = "20260714_17"
down_revision = "20260714_16"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "production_runs",
        sa.Column(
            "scope_type",
            sa.String(16),
            nullable=False,
            server_default="episode",
        ),
    )
    op.add_column(
        "production_runs",
        sa.Column("shot_ids", sa.JSON(), nullable=True),
    )
    op.create_index(
        "ix_production_runs_scope_type",
        "production_runs",
        ["scope_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_production_runs_scope_type", table_name="production_runs")
    op.drop_column("production_runs", "shot_ids")
    op.drop_column("production_runs", "scope_type")
