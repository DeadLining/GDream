"""Add explicit body plans to character entities."""

from alembic import op
import sqlalchemy as sa


revision = "20260724_32"
down_revision = "20260723_31"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "characters",
        sa.Column(
            "body_plan",
            sa.String(24),
            nullable=False,
            server_default="humanoid",
        ),
    )


def downgrade() -> None:
    op.drop_column("characters", "body_plan")
