"""Add unified model runtime invocation history."""

from alembic import op
import sqlalchemy as sa


revision = "20260712_03"
down_revision = "20260711_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "model_invocations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("capability", sa.String(24), nullable=False),
        sa.Column("provider", sa.String(80), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("target_type", sa.String(40), nullable=False),
        sa.Column("target_id", sa.String(36), nullable=False),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("elapsed_ms", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(64), nullable=False),
        sa.Column("retryable", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for name in ("capability", "target_id", "job_id", "status"):
        op.create_index(f"ix_model_invocations_{name}", "model_invocations", [name])


def downgrade() -> None:
    for name in ("status", "job_id", "target_id", "capability"):
        op.drop_index(f"ix_model_invocations_{name}", table_name="model_invocations")
    op.drop_table("model_invocations")
