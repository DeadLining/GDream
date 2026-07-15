"""Bind project library assets to production scenes."""

from alembic import op
import sqlalchemy as sa


revision = "20260720_28"
down_revision = "20260719_27"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "library_asset_scene_bindings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "library_asset_id",
            sa.String(36),
            sa.ForeignKey("library_assets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "scene_id",
            sa.String(36),
            sa.ForeignKey("scenes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "library_asset_id",
            "scene_id",
            name="uq_library_asset_scene_binding",
        ),
    )
    op.create_index(
        "ix_library_asset_scene_bindings_library_asset_id",
        "library_asset_scene_bindings",
        ["library_asset_id"],
    )
    op.create_index(
        "ix_library_asset_scene_bindings_scene_id",
        "library_asset_scene_bindings",
        ["scene_id"],
    )


def downgrade() -> None:
    op.drop_table("library_asset_scene_bindings")
