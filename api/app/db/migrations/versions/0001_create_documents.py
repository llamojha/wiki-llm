"""create documents table with FTS

Revision ID: 0001
Revises:
Create Date: 2026-05-03
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("vault_id", sa.String(), nullable=False),
        sa.Column("s3_key", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False, server_default=""),
        sa.Column("path", sa.String(), nullable=False, server_default=""),
        sa.Column("source_type", sa.String(), nullable=False, server_default="authored"),
        sa.Column("updated", sa.String(), nullable=False, server_default=""),
        sa.Column("author", sa.String(), nullable=False, server_default=""),
        sa.Column("tags", sa.String(), nullable=False, server_default=""),
        sa.Column("checksum", sa.String(), nullable=False, server_default=""),
        sa.Column("body_text", sa.Text(), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_documents_vault_id", "documents", ["vault_id"])
    # GIN index on tsvector for fast FTS
    op.execute("""
        CREATE INDEX ix_documents_fts
        ON documents
        USING GIN (to_tsvector('english', title || ' ' || body_text))
    """)


def downgrade() -> None:
    op.drop_index("ix_documents_fts", table_name="documents")
    op.drop_index("ix_documents_vault_id", table_name="documents")
    op.drop_table("documents")
