"""Add final review threads, release gates, and publication records."""

from alembic import op
import sqlalchemy as sa


revision = "20260712_09"
down_revision = "20260712_08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_threads",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("episode_id", sa.String(36), sa.ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shot_id", sa.String(36), sa.ForeignKey("shots.id", ondelete="CASCADE"), nullable=True),
        sa.Column("timecode_seconds", sa.Float(), nullable=False),
        sa.Column("severity", sa.String(24), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for name in ("episode_id", "shot_id", "severity", "status"):
        op.create_index(f"ix_review_threads_{name}", "review_threads", [name])
    op.create_table(
        "review_messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("thread_id", sa.String(36), sa.ForeignKey("review_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_kind", sa.String(24), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_review_messages_thread_id", "review_messages", ["thread_id"])
    op.create_index("ix_review_messages_author_kind", "review_messages", ["author_kind"])
    op.create_table(
        "release_candidates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("episode_id", sa.String(36), sa.ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.String(64), nullable=False),
        sa.Column("render_path", sa.Text(), nullable=False),
        sa.Column("qc_snapshot", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("episode_id", "version", name="uq_release_candidate_version"),
    )
    op.create_index("ix_release_candidates_episode_id", "release_candidates", ["episode_id"])
    op.create_index("ix_release_candidates_status", "release_candidates", ["status"])
    op.create_table(
        "publication_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("candidate_id", sa.String(36), sa.ForeignKey("release_candidates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("external_reference", sa.String(200), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("candidate_id", "platform", "idempotency_key", name="uq_publication_idempotency"),
    )
    for name in ("candidate_id", "platform", "idempotency_key", "status"):
        op.create_index(f"ix_publication_records_{name}", "publication_records", [name])


def downgrade() -> None:
    op.drop_table("publication_records")
    op.drop_table("release_candidates")
    op.drop_table("review_messages")
    op.drop_table("review_threads")
