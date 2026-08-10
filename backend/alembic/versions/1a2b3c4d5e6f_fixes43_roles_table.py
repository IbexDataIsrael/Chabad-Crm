"""fixes43 §5.1: extract user roles into a dedicated `roles` table with a real
FK from `users.role` (was a flat, unconstrained string). The stored role
values are unchanged ('admin' | 'staff' | 'shliach' | 'superadmin') — every
existing `.role == "admin"`-style comparison across the app keeps working;
only the storage layer gains referential integrity. Display labels stay in
`field_localization`, untouched by this migration.

Revision ID: 1a2b3c4d5e6f
Revises: f5a6b7c8d9e0
Create Date: 2026-08-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "1a2b3c4d5e6f"
down_revision: Union[str, Sequence[str], None] = "f5a6b7c8d9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ROLES = [
    ("admin", 1),
    ("staff", 2),
    ("shliach", 3),
    ("superadmin", 4),
]


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("name", sa.String(length=20), primary_key=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    roles_table = sa.table(
        "roles", sa.column("name", sa.String), sa.column("sort_order", sa.Integer)
    )
    op.bulk_insert(roles_table, [{"name": n, "sort_order": o} for n, o in _ROLES])

    with op.batch_alter_table("users") as batch_op:
        batch_op.create_foreign_key(
            "fk_users_role_roles_name", "roles", ["role"], ["name"]
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint("fk_users_role_roles_name", type_="foreignkey")
    op.drop_table("roles")
