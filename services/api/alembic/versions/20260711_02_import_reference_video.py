"""Add script imports, character references, and shot video state."""

from alembic import op
import sqlalchemy as sa


revision = "20260711_02"
down_revision = "20260711_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("script_imports", sa.Column("id", sa.String(36), primary_key=True), sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False), sa.Column("status", sa.String(24), nullable=False), sa.Column("mode", sa.String(24), nullable=False), sa.Column("source_format", sa.String(24), nullable=False), sa.Column("original_filename", sa.String(255), nullable=False), sa.Column("checksum", sa.String(64), nullable=False), sa.Column("extracted_text", sa.Text(), nullable=False), sa.Column("structured_draft", sa.JSON(), nullable=False), sa.Column("error", sa.Text(), nullable=False), sa.Column("error_category", sa.String(64), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False), sa.Column("applied_at", sa.DateTime(timezone=True)))
    op.create_index("ix_script_imports_project_id", "script_imports", ["project_id"])
    op.create_index("ix_script_imports_status", "script_imports", ["status"])
    op.create_table("character_references", sa.Column("id", sa.String(36), primary_key=True), sa.Column("character_id", sa.String(36), sa.ForeignKey("characters.id", ondelete="CASCADE"), nullable=False), sa.Column("asset_id", sa.String(36), sa.ForeignKey("assets.id", ondelete="RESTRICT"), nullable=False), sa.Column("reference_type", sa.String(32), nullable=False), sa.Column("label", sa.String(120), nullable=False), sa.Column("position", sa.Integer(), nullable=False), sa.Column("is_active", sa.Boolean(), nullable=False), sa.Column("review_status", sa.String(32), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    for name in ("character_id", "asset_id", "reference_type", "is_active"):
        op.create_index(f"ix_character_references_{name}", "character_references", [name])
    with op.batch_alter_table("shots") as batch:
        batch.add_column(sa.Column("video_prompt", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("negative_video_prompt", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("active_video_asset_id", sa.String(36)))
        batch.add_column(sa.Column("video_render_status", sa.String(32), nullable=False, server_default="pending"))
    with op.batch_alter_table("production_runs") as batch:
        batch.add_column(sa.Column("regenerate_videos", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("production_runs") as batch:
        batch.drop_column("regenerate_videos")
    with op.batch_alter_table("shots") as batch:
        batch.drop_column("video_render_status")
        batch.drop_column("active_video_asset_id")
        batch.drop_column("negative_video_prompt")
        batch.drop_column("video_prompt")
    op.drop_table("character_references")
    op.drop_table("script_imports")
