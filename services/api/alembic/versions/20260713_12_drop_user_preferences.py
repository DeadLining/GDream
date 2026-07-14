"""Drop user_preferences table — removing the 'user' concept."""

from alembic import op


revision = "20260713_12"
down_revision = "20260713_11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("user_preferences")


def downgrade() -> None:
    import sqlalchemy as sa
    op.create_table(
        "user_preferences",
        sa.Column("owner_key", sa.String(64), primary_key=True),
        sa.Column("density", sa.String(24), nullable=False, server_default="compact"),
        sa.Column("theme", sa.String(24), nullable=False, server_default="light"),
        sa.Column("language", sa.String(32), nullable=False, server_default="zh-CN"),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="Asia/Shanghai"),
        sa.Column("default_landing", sa.String(24), nullable=False, server_default="episode"),
        sa.Column("canvas", sa.JSON(), nullable=False),
        sa.Column("review", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
