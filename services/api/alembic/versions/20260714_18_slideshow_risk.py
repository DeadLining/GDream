"""Add slideshow_risk JSON column to render_review_records (M2.4)."""

from alembic import op
import sqlalchemy as sa


revision = "20260714_18"
down_revision = "20260714_17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "render_review_records",
        sa.Column("slideshow_risk", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("render_review_records", "slideshow_risk")
