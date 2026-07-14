"""Drop audit_events table — removing the 'notifications/audit' concept."""

from alembic import op


revision = "20260713_13"
down_revision = "20260713_12"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("audit_events")


def downgrade() -> None:
    import sqlalchemy as sa
    from comic_studio.models import new_id, utc_now
    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(36), primary_key=True, default=new_id),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor", sa.String(120), nullable=False),
        sa.Column("action", sa.String(120), nullable=False),
        sa.Column("target_type", sa.String(64), nullable=False),
        sa.Column("target_id", sa.String(36), nullable=False),
        sa.Column("result", sa.String(24), nullable=False, server_default="success"),
        sa.Column("before", sa.JSON(), nullable=False),
        sa.Column("after", sa.JSON(), nullable=False),
        sa.Column("previous_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("immutable_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_audit_events_project_id", "audit_events", ["project_id"])
    op.create_index("ix_audit_events_action", "audit_events", ["action"])
    op.create_index("ix_audit_events_target_type", "audit_events", ["target_type"])
    op.create_index("ix_audit_events_target_id", "audit_events", ["target_id"])
    op.create_index("ix_audit_events_result", "audit_events", ["result"])
    op.create_index("ix_audit_events_created_at", "audit_events", ["created_at"])
