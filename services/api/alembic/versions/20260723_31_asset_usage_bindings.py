"""Persist effective 3D and director bindings on asset usages."""

from alembic import op
import sqlalchemy as sa


revision = "20260723_31"
down_revision = "20260722_30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = (
        sa.Column("effective_variant_id", sa.String(36), nullable=True),
        sa.Column("effective_state_id", sa.String(36), nullable=True),
        sa.Column("effective_representation_id", sa.String(36), nullable=True),
        sa.Column("effective_representation_version", sa.Integer(), nullable=True),
        sa.Column("director_object_id", sa.String(36), nullable=True),
        sa.Column(
            "binding_status",
            sa.String(32),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("binding_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    for column in columns:
        op.add_column("asset_variant_usages", column)
    for column in (
        "effective_variant_id",
        "effective_state_id",
        "effective_representation_id",
        "director_object_id",
        "binding_status",
    ):
        op.create_index(
            f"ix_asset_variant_usages_{column}",
            "asset_variant_usages",
            [column],
        )


def downgrade() -> None:
    for column in (
        "binding_status",
        "director_object_id",
        "effective_representation_id",
        "effective_state_id",
        "effective_variant_id",
    ):
        op.drop_index(
            f"ix_asset_variant_usages_{column}",
            table_name="asset_variant_usages",
        )
    for column in (
        "binding_updated_at",
        "binding_status",
        "director_object_id",
        "effective_representation_version",
        "effective_representation_id",
        "effective_state_id",
        "effective_variant_id",
    ):
        op.drop_column("asset_variant_usages", column)
