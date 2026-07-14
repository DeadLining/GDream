"""Add budget fields to production_runs and cost_usd to model_invocations (M4.1)."""

from alembic import op
import sqlalchemy as sa


revision = "20260716_23"
down_revision = "20260715_22"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("production_runs") as batch:
        batch.add_column(
            sa.Column(
                "budget_cap_usd",
                sa.Numeric(precision=12, scale=6),
                nullable=True,
            )
        )
        batch.add_column(
            sa.Column(
                "spent_usd",
                sa.Numeric(precision=12, scale=6),
                nullable=False,
                server_default="0",
            )
        )
        batch.add_column(
            sa.Column(
                "budget_mode",
                sa.String(16),
                nullable=False,
                server_default="observe",
            )
        )
    with op.batch_alter_table("model_invocations") as batch:
        batch.add_column(
            sa.Column(
                "cost_usd",
                sa.Numeric(precision=12, scale=6),
                nullable=False,
                server_default="0",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("model_invocations") as batch:
        batch.drop_column("cost_usd")
    with op.batch_alter_table("production_runs") as batch:
        batch.drop_column("budget_mode")
        batch.drop_column("spent_usd")
        batch.drop_column("budget_cap_usd")
