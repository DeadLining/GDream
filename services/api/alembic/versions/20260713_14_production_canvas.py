"""Add production canvas layouts and workflow bindings."""

from alembic import op
import sqlalchemy as sa


revision = "20260713_14"
down_revision = "20260713_13"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "production_canvas_layouts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "episode_id",
            sa.String(36),
            sa.ForeignKey("episodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("layout", sa.JSON(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("episode_id", name="uq_production_canvas_episode"),
    )
    op.create_index(
        "ix_production_canvas_layouts_episode_id",
        "production_canvas_layouts",
        ["episode_id"],
    )
    op.create_table(
        "production_workflow_bindings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("capability", sa.String(24), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("workflow_id", sa.String(200), nullable=False),
        sa.Column("workflow_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "input_mapping_version", sa.Integer(), nullable=False, server_default="1"
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "project_id", "capability", "name", name="uq_production_workflow_name"
        ),
    )
    op.create_index(
        "ix_production_workflow_bindings_project_id",
        "production_workflow_bindings",
        ["project_id"],
    )
    op.create_index(
        "ix_production_workflow_bindings_capability",
        "production_workflow_bindings",
        ["capability"],
    )


def downgrade() -> None:
    op.drop_table("production_workflow_bindings")
    op.drop_table("production_canvas_layouts")
