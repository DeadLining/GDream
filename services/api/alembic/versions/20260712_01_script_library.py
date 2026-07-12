"""Add persistent script documents, revisions, and episode provenance."""

from alembic import op
import sqlalchemy as sa


revision = "20260712_01"
down_revision = "20260711_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "script_documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("source_type", sa.String(24), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("current_revision_id", sa.String(36)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_script_documents_project_id", "script_documents", ["project_id"])
    op.create_index("ix_script_documents_source_type", "script_documents", ["source_type"])
    op.create_index("ix_script_documents_status", "script_documents", ["status"])

    op.create_table(
        "script_revisions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("script_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("checksum", sa.String(64), nullable=False),
        sa.Column("creation_method", sa.String(24), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("source_file_path", sa.Text(), nullable=False),
        sa.Column("source_media_type", sa.String(120), nullable=False),
        sa.Column("generation_brief", sa.Text(), nullable=False),
        sa.Column("generation_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "document_id", "revision_number", name="uq_script_revision_number"
        ),
    )
    op.create_index("ix_script_revisions_document_id", "script_revisions", ["document_id"])
    op.create_index("ix_script_revisions_status", "script_revisions", ["status"])
    op.create_index(
        "uq_script_revision_working",
        "script_revisions",
        ["document_id"],
        unique=True,
        sqlite_where=sa.text("status = 'working'"),
    )

    with op.batch_alter_table("script_imports") as batch:
        batch.add_column(sa.Column("script_revision_id", sa.String(36)))
        batch.create_foreign_key(
            "fk_script_import_revision",
            "script_revisions",
            ["script_revision_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch.create_index("ix_script_imports_script_revision_id", ["script_revision_id"])

    op.create_table(
        "script_import_episodes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "script_import_id",
            sa.String(36),
            sa.ForeignKey("script_imports.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "episode_id",
            sa.String(36),
            sa.ForeignKey("episodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("draft_episode_id", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "script_import_id", "episode_id", name="uq_script_import_episode"
        ),
        sa.UniqueConstraint("episode_id", name="uq_episode_script_source"),
    )
    op.create_index(
        "ix_script_import_episodes_script_import_id",
        "script_import_episodes",
        ["script_import_id"],
    )
    op.create_index(
        "ix_script_import_episodes_episode_id",
        "script_import_episodes",
        ["episode_id"],
    )


def downgrade() -> None:
    op.drop_table("script_import_episodes")
    with op.batch_alter_table("script_imports") as batch:
        batch.drop_index("ix_script_imports_script_revision_id")
        batch.drop_constraint("fk_script_import_revision", type_="foreignkey")
        batch.drop_column("script_revision_id")
    op.drop_table("script_revisions")
    op.drop_table("script_documents")
