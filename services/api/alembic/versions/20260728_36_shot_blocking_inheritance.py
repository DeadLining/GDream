"""Record the shot used to initialize blocking overrides."""

import sqlalchemy as sa

from alembic import op


revision = "20260728_36"
down_revision = "20260727_35"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shot_cameras",
        sa.Column("initialized_from_shot_id", sa.String(36), nullable=True),
    )
    op.create_index(
        "ix_shot_cameras_initialized_from_shot_id",
        "shot_cameras",
        ["initialized_from_shot_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_shot_cameras_initialized_from_shot_id", table_name="shot_cameras"
    )
    op.drop_column("shot_cameras", "initialized_from_shot_id")
