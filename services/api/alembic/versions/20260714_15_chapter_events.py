"""Add script_chapters table for chapter-level event extraction."""

from alembic import op
import sqlalchemy as sa


revision = "20260714_15"
down_revision = "20260713_14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "script_chapters",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "script_document_id",
            sa.String(36),
            sa.ForeignKey("script_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("chapter_index", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("source_text", sa.Text(), nullable=False),
        sa.Column("event_summary", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("character_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("scene_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("extraction_status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("extraction_error", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "script_document_id", "chapter_index", name="uq_script_chapter_index"
        ),
    )
    op.create_index(
        "ix_script_chapters_document_id",
        "script_chapters",
        ["script_document_id"],
    )
    op.create_index(
        "ix_script_chapters_extraction_status",
        "script_chapters",
        ["extraction_status"],
    )


def downgrade() -> None:
    op.drop_index("ix_script_chapters_extraction_status", table_name="script_chapters")
    op.drop_index("ix_script_chapters_document_id", table_name="script_chapters")
    op.drop_table("script_chapters")
