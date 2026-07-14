"""Add visual annotations, conversations, and candidate versions."""

from alembic import op
import sqlalchemy as sa


revision = "20260712_08"
down_revision = "20260712_07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "visual_review_threads",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("episode_id", sa.String(36), sa.ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shot_id", sa.String(36), sa.ForeignKey("shots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_asset_id", sa.String(36), sa.ForeignKey("assets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("modification_scope", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for name in ("episode_id", "shot_id", "source_asset_id", "status", "modification_scope"):
        op.create_index(f"ix_visual_review_threads_{name}", "visual_review_threads", [name])
    op.create_table(
        "visual_annotations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("thread_id", sa.String(36), sa.ForeignKey("visual_review_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("geometry", sa.JSON(), nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_visual_annotations_thread_id", "visual_annotations", ["thread_id"])
    op.create_index("ix_visual_annotations_kind", "visual_annotations", ["kind"])
    op.create_table(
        "visual_review_messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("thread_id", sa.String(36), sa.ForeignKey("visual_review_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_kind", sa.String(24), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_visual_review_messages_thread_id", "visual_review_messages", ["thread_id"])
    op.create_index("ix_visual_review_messages_author_kind", "visual_review_messages", ["author_kind"])
    op.create_table(
        "visual_review_candidates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("thread_id", sa.String(36), sa.ForeignKey("visual_review_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("assets.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("generation_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for name in ("thread_id", "asset_id", "status"):
        op.create_index(f"ix_visual_review_candidates_{name}", "visual_review_candidates", [name])


def downgrade() -> None:
    op.drop_table("visual_review_candidates")
    op.drop_table("visual_review_messages")
    op.drop_table("visual_annotations")
    op.drop_table("visual_review_threads")
