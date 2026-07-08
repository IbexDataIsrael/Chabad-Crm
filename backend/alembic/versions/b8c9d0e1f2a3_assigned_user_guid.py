"""contacts.assigned_user_id: int users.id FK -> varchar(36) users.guid FK (fixes10 §2.1)

Existing integer assignments are mapped to the corresponding user's guid so no
live relationship is lost.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-07-08 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, Sequence[str], None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "contacts", sa.Column("assigned_user_guid", sa.String(length=36), nullable=True)
    )
    op.execute(
        "UPDATE contacts SET assigned_user_guid = u.guid "
        "FROM users u WHERE u.id = contacts.assigned_user_id"
    )
    with op.batch_alter_table("contacts") as batch_op:
        batch_op.drop_column("assigned_user_id")
    op.alter_column(
        "contacts", "assigned_user_guid", new_column_name="assigned_user_id"
    )
    op.create_foreign_key(
        "fk_contacts_assigned_user_guid", "contacts", "users",
        ["assigned_user_id"], ["guid"],
    )
    op.create_index("ix_contacts_assigned_user_id", "contacts", ["assigned_user_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_contacts_assigned_user_id", table_name="contacts")
    op.drop_constraint("fk_contacts_assigned_user_guid", "contacts", type_="foreignkey")
    op.add_column(
        "contacts", sa.Column("assigned_user_int", sa.Integer(), nullable=True)
    )
    op.execute(
        "UPDATE contacts SET assigned_user_int = u.id "
        "FROM users u WHERE u.guid = contacts.assigned_user_id"
    )
    with op.batch_alter_table("contacts") as batch_op:
        batch_op.drop_column("assigned_user_id")
    op.alter_column("contacts", "assigned_user_int", new_column_name="assigned_user_id")
    op.create_foreign_key(
        "contacts_assigned_user_id_fkey", "contacts", "users",
        ["assigned_user_id"], ["id"],
    )
