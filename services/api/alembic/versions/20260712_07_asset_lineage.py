"""Add persistent character asset inheritance and usage records."""

from alembic import op
import sqlalchemy as sa


revision = "20260712_07"
down_revision = "20260712_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "asset_variants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("character_id", sa.String(36), sa.ForeignKey("characters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("episode_id", sa.String(36), sa.ForeignKey("episodes.id", ondelete="CASCADE"), nullable=True),
        sa.Column("parent_variant_id", sa.String(36), sa.ForeignKey("asset_variants.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("inherited_fields", sa.JSON(), nullable=False),
        sa.Column("overrides", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("review_status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for name in ("character_id", "episode_id", "parent_variant_id", "kind", "review_status"):
        op.create_index(f"ix_asset_variants_{name}", "asset_variants", [name])
    op.create_table(
        "asset_variant_states",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("variant_id", sa.String(36), sa.ForeignKey("asset_variants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("overrides", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_asset_variant_states_variant_id", "asset_variant_states", ["variant_id"])
    op.create_index("ix_asset_variant_states_kind", "asset_variant_states", ["kind"])
    op.create_table(
        "asset_variant_usages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("variant_id", sa.String(36), sa.ForeignKey("asset_variants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("state_id", sa.String(36), sa.ForeignKey("asset_variant_states.id", ondelete="SET NULL"), nullable=True),
        sa.Column("shot_id", sa.String(36), sa.ForeignKey("shots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("assets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("usage_kind", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("variant_id", "shot_id", "usage_kind", name="uq_variant_shot_usage"),
    )
    for name in ("variant_id", "state_id", "shot_id", "asset_id", "usage_kind"):
        op.create_index(f"ix_asset_variant_usages_{name}", "asset_variant_usages", [name])


def downgrade() -> None:
    op.drop_table("asset_variant_usages")
    op.drop_table("asset_variant_states")
    op.drop_table("asset_variants")
