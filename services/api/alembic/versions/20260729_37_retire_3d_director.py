"""Retire the 3D Director and generated GLB persistence schema."""

import sqlalchemy as sa

from alembic import op


revision = "20260729_37"
down_revision = "20260728_36"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table(
        "asset_variant_usages", reflect_kwargs={"resolve_fks": False}
    ) as batch:
        batch.drop_index("ix_asset_variant_usages_director_object_id")
        batch.drop_index("ix_asset_variant_usages_effective_representation_id")
        batch.drop_column("director_object_id")
        batch.drop_column("effective_representation_version")
        batch.drop_column("effective_representation_id")

    op.drop_table("director_suggestions")
    op.drop_table("director_revisions")
    op.drop_table("shot_cameras")
    op.drop_table("director_objects")
    op.drop_table("director_stages")
    op.drop_table("character_3d_representations")


def downgrade() -> None:
    op.create_table(
        "director_stages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("scene_id", sa.String(36), sa.ForeignKey("scenes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("environment", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("scene_id", name="uq_director_stage_scene"),
    )
    op.create_index("ix_director_stages_scene_id", "director_stages", ["scene_id"])
    op.create_table(
        "director_objects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("stage_id", sa.String(36), sa.ForeignKey("director_stages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_id", sa.String(36)),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("transform", sa.JSON(), nullable=False),
        sa.Column("appearance", sa.JSON(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("visible", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_director_objects_stage_id", "director_objects", ["stage_id"])
    op.create_index("ix_director_objects_kind", "director_objects", ["kind"])
    op.create_table(
        "shot_cameras",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("stage_id", sa.String(36), sa.ForeignKey("director_stages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shot_id", sa.String(36), sa.ForeignKey("shots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("position", sa.JSON(), nullable=False),
        sa.Column("target", sa.JSON(), nullable=False),
        sa.Column("rotation", sa.JSON(), nullable=False),
        sa.Column("focal_length_mm", sa.Float(), nullable=False),
        sa.Column("near", sa.Float(), nullable=False),
        sa.Column("far", sa.Float(), nullable=False),
        sa.Column("shot_size", sa.String(40), nullable=False),
        sa.Column("camera_motion", sa.String(80), nullable=False),
        sa.Column("framing_guides", sa.JSON(), nullable=False),
        sa.Column("object_overrides", sa.JSON(), nullable=False),
        sa.Column("preview_asset_id", sa.String(36)),
        sa.Column("guidance_asset_ids", sa.JSON(), nullable=False),
        sa.Column("initialized_from_shot_id", sa.String(36), sa.ForeignKey("shots.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("stage_id", "shot_id", name="uq_stage_shot_camera"),
        sa.UniqueConstraint("shot_id"),
    )
    for column in ("stage_id", "shot_id", "initialized_from_shot_id"):
        op.create_index(f"ix_shot_cameras_{column}", "shot_cameras", [column])
    op.create_table(
        "director_revisions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("stage_id", sa.String(36), sa.ForeignKey("director_stages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shot_camera_id", sa.String(36), sa.ForeignKey("shot_cameras.id", ondelete="SET NULL")),
        sa.Column("stage_snapshot", sa.JSON(), nullable=False),
        sa.Column("camera_snapshot", sa.JSON(), nullable=False),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for column in ("stage_id", "shot_camera_id", "reason"):
        op.create_index(f"ix_director_revisions_{column}", "director_revisions", [column])
    op.create_table(
        "director_suggestions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("stage_id", sa.String(36), sa.ForeignKey("director_stages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shot_id", sa.String(36), sa.ForeignKey("shots.id", ondelete="CASCADE")),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("request_context", sa.JSON(), nullable=False),
        sa.Column("suggested_patch", sa.JSON(), nullable=False),
        sa.Column("error_category", sa.String(64), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True)),
    )
    for column in ("stage_id", "shot_id", "kind", "status"):
        op.create_index(f"ix_director_suggestions_{column}", "director_suggestions", [column])
    op.create_table(
        "character_3d_representations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("character_id", sa.String(36), sa.ForeignKey("characters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("variant_id", sa.String(36), sa.ForeignKey("asset_variants.id", ondelete="CASCADE")),
        sa.Column("state_id", sa.String(36), sa.ForeignKey("asset_variant_states.id", ondelete="CASCADE")),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("assets.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("format", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("review_status", sa.String(32), nullable=False),
        sa.Column("bounds", sa.JSON(), nullable=False),
        sa.Column("mesh_count", sa.Integer(), nullable=False),
        sa.Column("triangle_count", sa.Integer(), nullable=False),
        sa.Column("material_count", sa.Integer(), nullable=False),
        sa.Column("has_skeleton", sa.Boolean(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("character_id", "version", name="uq_character_3d_version"),
    )
    for column in ("character_id", "variant_id", "state_id", "asset_id", "is_active", "review_status"):
        op.create_index(f"ix_character_3d_representations_{column}", "character_3d_representations", [column])

    with op.batch_alter_table(
        "asset_variant_usages", reflect_kwargs={"resolve_fks": False}
    ) as batch:
        batch.add_column(sa.Column("effective_representation_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("effective_representation_version", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("director_object_id", sa.String(36), nullable=True))
        batch.create_foreign_key(
            "fk_asset_variant_usages_effective_representation_id",
            "character_3d_representations",
            ["effective_representation_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_foreign_key(
            "fk_asset_variant_usages_director_object_id",
            "director_objects",
            ["director_object_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index(
            "ix_asset_variant_usages_effective_representation_id",
            ["effective_representation_id"],
        )
        batch.create_index(
            "ix_asset_variant_usages_director_object_id", ["director_object_id"]
        )
