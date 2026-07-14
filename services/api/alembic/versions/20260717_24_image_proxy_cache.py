"""Add image_proxy_cache table for remote-image disk caching (M4.4)."""

from alembic import op
import sqlalchemy as sa


revision = "20260717_24"
down_revision = "20260716_23"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "image_proxy_cache",
        sa.Column("url_hash", sa.String(64), primary_key=True),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("local_path", sa.Text, nullable=False),
        sa.Column("media_type", sa.String(120), nullable=False, server_default="application/octet-stream"),
        sa.Column("byte_size", sa.Integer, nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_image_proxy_cache_expires_at", "image_proxy_cache", ["expires_at"])
    op.create_index("ix_image_proxy_cache_url", "image_proxy_cache", ["url"])


def downgrade() -> None:
    op.drop_index("ix_image_proxy_cache_url", table_name="image_proxy_cache")
    op.drop_index("ix_image_proxy_cache_expires_at", table_name="image_proxy_cache")
    op.drop_table("image_proxy_cache")
