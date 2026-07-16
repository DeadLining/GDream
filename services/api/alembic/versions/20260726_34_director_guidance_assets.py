"""Add director silhouette and skeleton guidance asset references."""

import sqlalchemy as sa

from alembic import op

revision = "20260726_34"
down_revision = "20260725_33"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("shot_cameras") as batch:
        batch.add_column(
            sa.Column(
                "guidance_asset_ids",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'{}'"),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("shot_cameras") as batch:
        batch.drop_column("guidance_asset_ids")
