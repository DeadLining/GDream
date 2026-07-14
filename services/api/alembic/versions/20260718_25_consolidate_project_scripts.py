"""Consolidate duplicate project scripts before enforcing one script per project.

This data migration is intentionally irreversible: duplicate ScriptDocument rows
are folded into the newest document while their revisions and import provenance
are retained.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260718_25"
down_revision = "20260717_24"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    project_ids = connection.execute(sa.text("""
        SELECT project_id
        FROM script_documents
        GROUP BY project_id
        HAVING COUNT(*) > 1
    """)).scalars().all()

    for project_id in project_ids:
        documents = connection.execute(sa.text("""
            SELECT id, current_revision_id
            FROM script_documents
            WHERE project_id = :project_id
            ORDER BY updated_at DESC, created_at DESC, id DESC
        """), {"project_id": project_id}).mappings().all()
        canonical = documents[0]
        canonical_id = canonical["id"]
        duplicate_ids = [item["id"] for item in documents[1:]]

        revisions = connection.execute(sa.text("""
            SELECT id, document_id, status
            FROM script_revisions
            WHERE document_id IN (
                SELECT id FROM script_documents WHERE project_id = :project_id
            )
            ORDER BY created_at, id
        """), {"project_id": project_id}).mappings().all()

        for index, item in enumerate(revisions, start=1):
            keep_working = (
                item["id"] == canonical["current_revision_id"]
                and item["status"] == "working"
            )
            connection.execute(sa.text("""
                UPDATE script_revisions
                SET revision_number = :temporary_number,
                    status = :status
                WHERE id = :revision_id
            """), {
                "temporary_number": 100000 + index,
                "status": "working" if keep_working else "finalized",
                "revision_id": item["id"],
            })

        for duplicate_id in duplicate_ids:
            connection.execute(sa.text(
                "DELETE FROM script_chapters WHERE script_document_id = :document_id"
            ), {"document_id": duplicate_id})
            connection.execute(sa.text("""
                UPDATE script_revisions
                SET document_id = :canonical_id
                WHERE document_id = :duplicate_id
            """), {
                "canonical_id": canonical_id,
                "duplicate_id": duplicate_id,
            })
            connection.execute(sa.text(
                "DELETE FROM script_documents WHERE id = :document_id"
            ), {"document_id": duplicate_id})

        for index, item in enumerate(revisions, start=1):
            connection.execute(sa.text("""
                UPDATE script_revisions
                SET revision_number = :revision_number
                WHERE id = :revision_id
            """), {
                "revision_number": index,
                "revision_id": item["id"],
            })


def downgrade() -> None:
    # Irreversible data consolidation. A downgrade keeps the canonical document.
    pass
