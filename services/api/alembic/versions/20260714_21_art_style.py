"""Add art_style_id to characters (M3.3 art style catalog)."""

from alembic import op
import sqlalchemy as sa


revision = "20260714_21"
down_revision = "20260714_20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "characters",
        sa.Column("art_style_id", sa.String(80), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("characters", "art_style_id")
