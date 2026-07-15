"""Add uploaded GLB representations for character assets."""

from alembic import op
import sqlalchemy as sa


revision = "20260722_30"
down_revision = "20260721_29"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "character_3d_representations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("character_id", sa.String(36), nullable=False),
        sa.Column("variant_id", sa.String(36), nullable=True),
        sa.Column("state_id", sa.String(36), nullable=True),
        sa.Column("asset_id", sa.String(36), nullable=False),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("format", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("review_status", sa.String(32), nullable=False),
        sa.Column("bounds", sa.JSON(), nullable=False),
        sa.Column("mesh_count", sa.Integer(), nullable=False),
        sa.Column("triangle_count", sa.Integer(), nullable=False),
        sa.Column("material_count", sa.Integer(), nullable=False),
        sa.Column("has_skeleton", sa.Boolean(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["character_id"], ["characters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["variant_id"], ["asset_variants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["state_id"], ["asset_variant_states.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("character_id", "version", name="uq_character_3d_version"),
    )
    for column in ("character_id", "variant_id", "state_id", "asset_id", "is_active", "review_status"):
        op.create_index(f"ix_character_3d_representations_{column}", "character_3d_representations", [column])


def downgrade() -> None:
    op.drop_table("character_3d_representations")
