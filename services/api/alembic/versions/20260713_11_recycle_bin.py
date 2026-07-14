"""Add lineage-aware recycle bin and soft deletion markers."""

from alembic import op
import sqlalchemy as sa


revision = "20260713_11"
down_revision = "20260712_10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("asset_variants", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("asset_variants", sa.Column("deleted_by", sa.String(120), nullable=False, server_default=""))
    op.create_index("ix_asset_variants_deleted_at", "asset_variants", ["deleted_at"])
    op.add_column("asset_variant_states", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("asset_variant_states", sa.Column("deleted_by", sa.String(120), nullable=False, server_default=""))
    op.create_index("ix_asset_variant_states_deleted_at", "asset_variant_states", ["deleted_at"])
    op.create_table(
        "trash_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_type", sa.String(64), nullable=False),
        sa.Column("resource_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("original_location", sa.JSON(), nullable=False),
        sa.Column("lineage", sa.JSON(), nullable=False),
        sa.Column("deleted_by", sa.String(120), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("resource_type", "resource_id", name="uq_trash_resource"),
    )
    for name in ("project_id", "resource_type", "resource_id", "expires_at"):
        op.create_index(f"ix_trash_items_{name}", "trash_items", [name])


def downgrade() -> None:
    op.drop_table("trash_items")
    op.drop_index("ix_asset_variant_states_deleted_at", table_name="asset_variant_states")
    op.drop_column("asset_variant_states", "deleted_by")
    op.drop_column("asset_variant_states", "deleted_at")
    op.drop_index("ix_asset_variants_deleted_at", table_name="asset_variants")
    op.drop_column("asset_variants", "deleted_by")
    op.drop_column("asset_variants", "deleted_at")
