"""Attach uploaded media to project library assets."""

from alembic import op
import sqlalchemy as sa


revision = "20260721_29"
down_revision = "20260720_28"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("library_assets") as batch:
        batch.add_column(sa.Column("media_asset_id", sa.String(36), nullable=True))
        batch.create_foreign_key(
            "fk_library_assets_media_asset_id",
            "assets",
            ["media_asset_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index("ix_library_assets_media_asset_id", ["media_asset_id"])


def downgrade() -> None:
    with op.batch_alter_table("library_assets") as batch:
        batch.drop_index("ix_library_assets_media_asset_id")
        batch.drop_constraint("fk_library_assets_media_asset_id", type_="foreignkey")
        batch.drop_column("media_asset_id")
