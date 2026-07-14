"""Add panel_generation_mode to production_runs and widen production_items.target_id for grid groups (M3.1)."""

from alembic import op
import sqlalchemy as sa


revision = "20260715_22"
down_revision = "20260714_21"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("production_runs") as batch:
        batch.add_column(
            sa.Column(
                "panel_generation_mode",
                sa.String(16),
                nullable=False,
                server_default="solo",
            )
        )
    with op.batch_alter_table("production_items") as batch:
        batch.alter_column(
            "target_id",
            type_=sa.String(160),
            existing_type=sa.String(36),
        )


def downgrade() -> None:
    with op.batch_alter_table("production_items") as batch:
        batch.alter_column(
            "target_id",
            type_=sa.String(36),
            existing_type=sa.String(160),
        )
    with op.batch_alter_table("production_runs") as batch:
        batch.drop_column("panel_generation_mode")
