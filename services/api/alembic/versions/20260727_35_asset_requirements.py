"""Add script-revision asset requirements for generation readiness."""

import sqlalchemy as sa

from alembic import op


revision = "20260727_35"
down_revision = "20260726_34"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "asset_requirements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "script_revision_id",
            sa.String(36),
            sa.ForeignKey("script_revisions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("canonical_key", sa.String(240), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("status", sa.String(24), nullable=False, server_default="missing"),
        sa.Column("binding_type", sa.String(32), nullable=False, server_default=""),
        sa.Column("binding_id", sa.String(36), nullable=True),
        sa.Column("source_context", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "script_revision_id",
            "canonical_key",
            name="uq_asset_requirement_revision_key",
        ),
    )
    op.create_index("ix_asset_requirements_project_id", "asset_requirements", ["project_id"])
    op.create_index(
        "ix_asset_requirements_script_revision_id",
        "asset_requirements",
        ["script_revision_id"],
    )
    op.create_index("ix_asset_requirements_kind", "asset_requirements", ["kind"])
    op.create_index("ix_asset_requirements_status", "asset_requirements", ["status"])


def downgrade() -> None:
    op.drop_index("ix_asset_requirements_status", table_name="asset_requirements")
    op.drop_index("ix_asset_requirements_kind", table_name="asset_requirements")
    op.drop_index(
        "ix_asset_requirements_script_revision_id",
        table_name="asset_requirements",
    )
    op.drop_index("ix_asset_requirements_project_id", table_name="asset_requirements")
    op.drop_table("asset_requirements")
