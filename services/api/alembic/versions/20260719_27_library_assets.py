"""Add project library assets."""

from alembic import op
import sqlalchemy as sa


revision = "20260719_27"
down_revision = "20260718_26"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "library_assets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "project_id",
            "kind",
            "name",
            name="uq_library_asset_project_kind_name",
        ),
    )
    op.create_index("ix_library_assets_project_id", "library_assets", ["project_id"])
    op.create_index("ix_library_assets_kind", "library_assets", ["kind"])


def downgrade() -> None:
    op.drop_table("library_assets")
