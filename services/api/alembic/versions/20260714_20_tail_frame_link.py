"""Add previous_shot_tail_asset_id to shots for tail-frame continuity (M3.2)."""

from alembic import op
import sqlalchemy as sa


revision = "20260714_20"
down_revision = "20260714_19"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shots",
        sa.Column("previous_shot_tail_asset_id", sa.String(36), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("shots", "previous_shot_tail_asset_id")
