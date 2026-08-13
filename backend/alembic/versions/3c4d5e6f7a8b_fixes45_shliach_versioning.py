"""fixes45: ContactShliach versioning (same pattern as Apartment) — replaces
contact_shliach_edit_history's field-level diff log with full-row snapshots.

- `contact_shliach`: is_display / last_edit / editor_id / root_id + a
  full_name/email/phone identity snapshot. `contact_id` stops being unique
  (it now identifies a lineage, not a single row) and its FK gets
  ON DELETE CASCADE so deleting a contact cleans up every version, not just
  the active one (the ORM relationship can only see the active row now).
- Backfill full_name/email/phone for existing rows from the linked login
  user, falling back to the contact itself.
- Drop contact_shliach_edit_history.

Revision ID: 3c4d5e6f7a8b
Revises: 2b3c4d5e6f7a
Create Date: 2026-08-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "3c4d5e6f7a8b"
down_revision: Union[str, Sequence[str], None] = "2b3c4d5e6f7a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("contact_shliach") as batch_op:
        batch_op.add_column(sa.Column("full_name", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("email", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("phone", sa.String(length=50), nullable=True))
        batch_op.add_column(
            sa.Column(
                "is_display",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            )
        )
        batch_op.add_column(sa.Column("last_edit", sa.DateTime(), nullable=True))
        # SET NULL: editor_id must never block a user delete, and root_id is a
        # self-FK — cascade deletes would otherwise depend on row ordering.
        batch_op.add_column(
            sa.Column(
                "editor_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column(
                "root_id",
                sa.Integer(),
                sa.ForeignKey("contact_shliach.id", ondelete="SET NULL"),
                nullable=True,
            )
        )
    op.create_index("ix_contact_shliach_root_id", "contact_shliach", ["root_id"])

    # contact_id is no longer 1:1 — drop the unique index, keep a plain one.
    op.drop_index("ix_contact_shliach_contact_id", table_name="contact_shliach")
    op.create_index(
        "ix_contact_shliach_contact_id", "contact_shliach", ["contact_id"]
    )
    # Re-create the FK with ON DELETE CASCADE (every version must go when the
    # contact does — the ORM relationship only ever sees the active one).
    with op.batch_alter_table("contact_shliach") as batch_op:
        batch_op.drop_constraint(
            "contact_shliach_contact_id_fkey", type_="foreignkey"
        )
        batch_op.create_foreign_key(
            "contact_shliach_contact_id_fkey",
            "contacts",
            ["contact_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # Backfill: prefer the linked login user's identity, else the contact's.
    op.execute(
        """
        UPDATE contact_shliach cs
        SET full_name = u.full_name, email = u.email, phone = u.phone
        FROM users u
        WHERE cs.user_id = u.id
        """
    )
    op.execute(
        """
        UPDATE contact_shliach cs
        SET
            full_name = COALESCE(cs.full_name, trim(concat_ws(' ', c.last_name, c.name))),
            email = COALESCE(cs.email, c.email),
            phone = COALESCE(cs.phone, c.phone)
        FROM contacts c
        WHERE cs.contact_id = c.id AND cs.full_name IS NULL
        """
    )

    op.drop_index(
        "ix_contact_shliach_edit_history_contact_shliach_id",
        table_name="contact_shliach_edit_history",
    )
    op.drop_index(
        "ix_contact_shliach_edit_history_organization_id",
        table_name="contact_shliach_edit_history",
    )
    op.drop_table("contact_shliach_edit_history")


def downgrade() -> None:
    op.create_table(
        "contact_shliach_edit_history",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "contact_shliach_id",
            sa.Integer(),
            sa.ForeignKey("contact_shliach.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("field", sa.String(length=50), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column(
            "editor_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("changed_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_contact_shliach_edit_history_organization_id",
        "contact_shliach_edit_history",
        ["organization_id"],
    )
    op.create_index(
        "ix_contact_shliach_edit_history_contact_shliach_id",
        "contact_shliach_edit_history",
        ["contact_shliach_id"],
    )

    with op.batch_alter_table("contact_shliach") as batch_op:
        batch_op.drop_constraint(
            "contact_shliach_contact_id_fkey", type_="foreignkey"
        )
        batch_op.create_foreign_key(
            "contact_shliach_contact_id_fkey", "contacts", ["contact_id"], ["id"]
        )
    op.drop_index("ix_contact_shliach_contact_id", table_name="contact_shliach")
    # Historical rows (is_display=False) would violate a straight unique
    # index — this downgrade only makes sense run before any edit happened
    # under the new schema.
    op.create_index(
        "ix_contact_shliach_contact_id",
        "contact_shliach",
        ["contact_id"],
        unique=True,
    )

    op.drop_index("ix_contact_shliach_root_id", table_name="contact_shliach")
    with op.batch_alter_table("contact_shliach") as batch_op:
        batch_op.drop_column("root_id")
        batch_op.drop_column("editor_id")
        batch_op.drop_column("last_edit")
        batch_op.drop_column("is_display")
        batch_op.drop_column("phone")
        batch_op.drop_column("email")
        batch_op.drop_column("full_name")
