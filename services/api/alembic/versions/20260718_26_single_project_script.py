"""Enforce one script document per project."""

from alembic import op


revision = "20260718_26"
down_revision = "20260718_25"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("script_documents") as batch:
        batch.create_unique_constraint(
            "uq_script_document_project", ["project_id"]
        )


def downgrade() -> None:
    with op.batch_alter_table("script_documents") as batch:
        batch.drop_constraint("uq_script_document_project", type_="unique")
