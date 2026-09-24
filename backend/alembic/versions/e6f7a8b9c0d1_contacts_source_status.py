"""contacts.source + contacts.status — Instinct API draft-approval flow

- source: 'crm' | 'instinct' (NOT NULL, default 'crm').
- status: 'active' | 'draft' (NOT NULL, default 'active'), indexed — every
  contacts list filters on it.

Existing rows are backfilled by the server defaults ('crm' / 'active'); the
explicit UPDATEs are a belt-and-braces no-op on both Postgres and SQLite.

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, Sequence[str], None] = "d5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "contacts",
        sa.Column("source", sa.String(20), nullable=False, server_default="crm"),
    )
    op.add_column(
        "contacts",
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
    )
    op.execute("UPDATE contacts SET source = 'crm' WHERE source IS NULL")
    op.execute("UPDATE contacts SET status = 'active' WHERE status IS NULL")
    op.create_index("ix_contacts_status", "contacts", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_contacts_status", table_name="contacts")
    with op.batch_alter_table("contacts") as batch:
        batch.drop_column("status")
        batch.drop_column("source")
