"""Add decision_log JSON column to model_invocations (M3.4 Decision Audit Trail)."""

from alembic import op
import sqlalchemy as sa


revision = "20260714_19"
down_revision = "20260714_18"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "model_invocations",
        sa.Column("decision_log", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("model_invocations", "decision_log")
