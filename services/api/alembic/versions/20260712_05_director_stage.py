"""Add lightweight 3D director stage records."""

from alembic import op
import sqlalchemy as sa


revision = "20260712_05"
down_revision = "20260712_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("director_stages",sa.Column("id",sa.String(36),primary_key=True),sa.Column("scene_id",sa.String(36),sa.ForeignKey("scenes.id",ondelete="CASCADE"),nullable=False),sa.Column("version",sa.Integer(),nullable=False),sa.Column("environment",sa.JSON(),nullable=False),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),nullable=False),sa.UniqueConstraint("scene_id",name="uq_director_stage_scene"))
    op.create_index("ix_director_stages_scene_id","director_stages",["scene_id"])
    op.create_table("director_objects",sa.Column("id",sa.String(36),primary_key=True),sa.Column("stage_id",sa.String(36),sa.ForeignKey("director_stages.id",ondelete="CASCADE"),nullable=False),sa.Column("kind",sa.String(24),nullable=False),sa.Column("source_type",sa.String(32),nullable=False),sa.Column("source_id",sa.String(36)),sa.Column("label",sa.String(160),nullable=False),sa.Column("position",sa.Integer(),nullable=False),sa.Column("transform",sa.JSON(),nullable=False),sa.Column("appearance",sa.JSON(),nullable=False),sa.Column("metadata",sa.JSON(),nullable=False),sa.Column("visible",sa.Boolean(),nullable=False),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),nullable=False))
    op.create_index("ix_director_objects_stage_id","director_objects",["stage_id"]);op.create_index("ix_director_objects_kind","director_objects",["kind"])
    op.create_table("shot_cameras",sa.Column("id",sa.String(36),primary_key=True),sa.Column("stage_id",sa.String(36),sa.ForeignKey("director_stages.id",ondelete="CASCADE"),nullable=False),sa.Column("shot_id",sa.String(36),sa.ForeignKey("shots.id",ondelete="CASCADE"),nullable=False),sa.Column("version",sa.Integer(),nullable=False),sa.Column("position",sa.JSON(),nullable=False),sa.Column("target",sa.JSON(),nullable=False),sa.Column("rotation",sa.JSON(),nullable=False),sa.Column("focal_length_mm",sa.Float(),nullable=False),sa.Column("near",sa.Float(),nullable=False),sa.Column("far",sa.Float(),nullable=False),sa.Column("shot_size",sa.String(40),nullable=False),sa.Column("camera_motion",sa.String(80),nullable=False),sa.Column("framing_guides",sa.JSON(),nullable=False),sa.Column("object_overrides",sa.JSON(),nullable=False),sa.Column("preview_asset_id",sa.String(36)),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),nullable=False),sa.UniqueConstraint("stage_id","shot_id",name="uq_stage_shot_camera"),sa.UniqueConstraint("shot_id"))
    op.create_index("ix_shot_cameras_stage_id","shot_cameras",["stage_id"]);op.create_index("ix_shot_cameras_shot_id","shot_cameras",["shot_id"])
    op.create_table("director_revisions",sa.Column("id",sa.String(36),primary_key=True),sa.Column("stage_id",sa.String(36),sa.ForeignKey("director_stages.id",ondelete="CASCADE"),nullable=False),sa.Column("shot_camera_id",sa.String(36),sa.ForeignKey("shot_cameras.id",ondelete="SET NULL")),sa.Column("stage_snapshot",sa.JSON(),nullable=False),sa.Column("camera_snapshot",sa.JSON(),nullable=False),sa.Column("reason",sa.String(32),nullable=False),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False))
    op.create_index("ix_director_revisions_stage_id","director_revisions",["stage_id"]);op.create_index("ix_director_revisions_shot_camera_id","director_revisions",["shot_camera_id"]);op.create_index("ix_director_revisions_reason","director_revisions",["reason"])
    op.create_table("director_suggestions",sa.Column("id",sa.String(36),primary_key=True),sa.Column("stage_id",sa.String(36),sa.ForeignKey("director_stages.id",ondelete="CASCADE"),nullable=False),sa.Column("shot_id",sa.String(36),sa.ForeignKey("shots.id",ondelete="CASCADE")),sa.Column("kind",sa.String(32),nullable=False),sa.Column("status",sa.String(24),nullable=False),sa.Column("request_context",sa.JSON(),nullable=False),sa.Column("suggested_patch",sa.JSON(),nullable=False),sa.Column("error_category",sa.String(64),nullable=False),sa.Column("error",sa.Text(),nullable=False),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),sa.Column("applied_at",sa.DateTime(timezone=True)))
    for name in ("stage_id","shot_id","kind","status"):op.create_index(f"ix_director_suggestions_{name}","director_suggestions",[name])


def downgrade() -> None:
    op.drop_table("director_suggestions");op.drop_table("director_revisions");op.drop_table("shot_cameras");op.drop_table("director_objects");op.drop_table("director_stages")
