"""fixes25 — visit-centric restructuring.

Moves contact-level engagement data onto visits:

- `visit_history` gains an `interactions` JSON log, the Mivtzoim boolean flags
  (tefillin / tzedakah / shabbat_candles / torah_pamphlet / letter_in_torah),
  `torah_thought` and `connection_to_rebbe`.
- `custom_field_values` re-points from contacts to visits.
- Every contact holding any of that data gets ONE "migration visit" dated at
  the contact's creation date (fallback: now); checklist per-boolean notes are
  folded into the visit's notes text (they have no dedicated columns anymore).
- Destructive clean-up: drops `interactions`, `community_checklists`, and
  `contact_mekurav.rebbe_connection`.

Run `scripts/fixes25_backup.py` against the target DB BEFORE upgrading — the
downgrade only restores the structure, never the migrated-away data.
"""
import datetime
import json
import uuid
from collections import defaultdict
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, Sequence[str], None] = "b4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FLAGS = ("tefillin", "tzedakah", "shabbat_candles", "torah_pamphlet", "letter_in_torah")

# (old checklist note column, Hebrew label used when folding into visit notes)
_NOTE_FIELDS = (
    ("tefillin_notes", "תפילין"),
    ("charity_note", "צדקה"),
    ("shabbat_candles_notes", "נרות שבת"),
    ("torah_pamphlet_notes", "עלון"),
    ("letter_torah_notes", "אות בספר"),
)


def _checklist_has_data(cl: dict) -> bool:
    if any(cl.get(f) for f in ("tefillin", "tzedakah", "shabbat_candles", "torah_pamphlet", "torah_letter")):
        return True
    if cl.get("torah_thought"):
        return True
    return any(cl.get(f) for f, _ in _NOTE_FIELDS)


def _hydrate(conn) -> None:
    """Create one migration visit per contact that carries contact-level data,
    and re-point that contact's custom-field values at it."""
    checklists = {
        r._mapping["contact_id"]: dict(r._mapping)
        for r in conn.execute(sa.text("SELECT * FROM community_checklists"))
    }
    interactions: dict[int, list[dict]] = defaultdict(list)
    for r in conn.execute(
        sa.text(
            "SELECT i.contact_id, i.category, i.note, i.created_at, u.full_name"
            " FROM interactions i LEFT JOIN users u ON u.id = i.created_by"
            " ORDER BY i.created_at, i.id"
        )
    ):
        m = r._mapping
        interactions[m["contact_id"]].append(
            {
                "category": m["category"],
                "note": m["note"],
                "created_at": m["created_at"].isoformat() if m["created_at"] else None,
                "author_name": m["full_name"],
            }
        )
    custom_contacts = {
        r._mapping["contact_id"]
        for r in conn.execute(
            sa.text(
                "SELECT DISTINCT contact_id FROM custom_field_values"
                " WHERE checked = TRUE OR (note IS NOT NULL AND note <> '')"
            )
        )
    }
    rebbe = {
        r._mapping["contact_id"]: r._mapping["rebbe_connection"]
        for r in conn.execute(
            sa.text(
                "SELECT contact_id, rebbe_connection FROM contact_mekurav"
                " WHERE rebbe_connection IS NOT NULL AND rebbe_connection <> ''"
            )
        )
    }
    contacts = {
        r._mapping["id"]: dict(r._mapping)
        for r in conn.execute(
            sa.text("SELECT id, organization_id, created_at FROM contacts")
        )
    }

    with_data = (
        {cid for cid, cl in checklists.items() if _checklist_has_data(cl)}
        | set(interactions)
        | custom_contacts
        | set(rebbe)
    ) & set(contacts)

    now = datetime.datetime.utcnow()
    for cid in sorted(with_data):
        contact = contacts[cid]
        cl = checklists.get(cid) or {}
        note_lines = [f"{label}: {cl[f]}" for f, label in _NOTE_FIELDS if cl.get(f)]
        guid = str(uuid.uuid4())
        conn.execute(
            sa.text(
                "INSERT INTO visit_history"
                " (guid, organization_id, contact_id, visit_date, visit_type,"
                "  location, notes, interactions, tefillin, tzedakah,"
                "  shabbat_candles, torah_pamphlet, letter_in_torah,"
                "  torah_thought, connection_to_rebbe, created_at)"
                " VALUES (:guid, :org, :cid, :vdate, NULL, NULL, :notes, :inter,"
                "  :tefillin, :tzedakah, :candles, :pamphlet, :letter, :tt, :rc, :now)"
            ),
            {
                "guid": guid,
                "org": contact["organization_id"],
                "cid": cid,
                "vdate": contact["created_at"] or now,
                "notes": "\n".join(note_lines) or None,
                "inter": json.dumps(interactions.get(cid, []), ensure_ascii=False),
                "tefillin": bool(cl.get("tefillin")),
                "tzedakah": bool(cl.get("tzedakah")),
                "candles": bool(cl.get("shabbat_candles")),
                "pamphlet": bool(cl.get("torah_pamphlet")),
                "letter": bool(cl.get("torah_letter")),  # renamed column
                "tt": cl.get("torah_thought"),
                "rc": rebbe.get(cid),
                "now": now,
            },
        )
        visit_id = conn.execute(
            sa.text("SELECT id FROM visit_history WHERE guid = :guid"), {"guid": guid}
        ).scalar()
        conn.execute(
            sa.text(
                "UPDATE custom_field_values SET visit_id = :vid WHERE contact_id = :cid"
            ),
            {"vid": visit_id, "cid": cid},
        )


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Visit columns.
    op.add_column("visit_history", sa.Column("interactions", sa.JSON(), nullable=True))
    for flag in _FLAGS:
        op.add_column(
            "visit_history",
            sa.Column(flag, sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    op.add_column(
        "visit_history", sa.Column("torah_thought", sa.String(length=50), nullable=True)
    )
    op.add_column(
        "visit_history", sa.Column("connection_to_rebbe", sa.Text(), nullable=True)
    )

    # 2. custom_field_values.visit_id (nullable until hydrated).
    op.add_column(
        "custom_field_values", sa.Column("visit_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        "fk_customval_visit", "custom_field_values", "visit_history", ["visit_id"], ["id"]
    )
    op.create_index(
        op.f("ix_custom_field_values_visit_id"), "custom_field_values", ["visit_id"]
    )

    # 3. Data re-assignment.
    _hydrate(conn)

    # 4. Destructive clean-up.
    # Values never re-pointed belong to contacts without any real data — drop them.
    conn.execute(sa.text("DELETE FROM custom_field_values WHERE visit_id IS NULL"))
    op.alter_column("custom_field_values", "visit_id", nullable=False)
    op.drop_constraint("uq_customval_contact_def", "custom_field_values", type_="unique")
    op.drop_index(op.f("ix_custom_field_values_contact_id"), table_name="custom_field_values")
    op.drop_column("custom_field_values", "contact_id")
    op.create_unique_constraint(
        "uq_customval_visit_def", "custom_field_values", ["visit_id", "definition_id"]
    )

    op.drop_index(op.f("ix_interactions_organization_id"), table_name="interactions")
    op.drop_index(op.f("ix_interactions_guid"), table_name="interactions")
    op.drop_table("interactions")
    op.drop_index(op.f("ix_community_checklists_guid"), table_name="community_checklists")
    op.drop_table("community_checklists")
    op.drop_column("contact_mekurav", "rebbe_connection")


def downgrade() -> None:
    """Structure-only downgrade — migrated data stays on the visits; the
    pre-migration JSON backup (scripts/fixes25_backup.py) is the data restore
    path."""
    op.add_column(
        "contact_mekurav", sa.Column("rebbe_connection", sa.Text(), nullable=True)
    )
    op.create_table(
        "community_checklists",
        sa.Column("contact_id", sa.Integer(), nullable=False),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("tefillin", sa.Boolean(), nullable=False),
        sa.Column("tefillin_notes", sa.Text(), nullable=True),
        sa.Column("tzedakah", sa.Boolean(), nullable=False),
        sa.Column("charity_note", sa.Text(), nullable=True),
        sa.Column("shabbat_candles", sa.Boolean(), nullable=False),
        sa.Column("shabbat_candles_notes", sa.Text(), nullable=True),
        sa.Column("torah_pamphlet", sa.Boolean(), nullable=False),
        sa.Column("torah_pamphlet_notes", sa.Text(), nullable=True),
        sa.Column("torah_thought", sa.String(length=50), nullable=True),
        sa.Column("torah_letter", sa.Boolean(), nullable=False),
        sa.Column("letter_torah_notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"]),
        sa.PrimaryKeyConstraint("contact_id"),
    )
    op.create_index(
        op.f("ix_community_checklists_guid"), "community_checklists", ["guid"], unique=True
    )
    op.create_table(
        "interactions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("contact_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=50), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_interactions_guid"), "interactions", ["guid"], unique=True)
    op.create_index(
        op.f("ix_interactions_organization_id"), "interactions", ["organization_id"]
    )

    op.drop_constraint("uq_customval_visit_def", "custom_field_values", type_="unique")
    op.add_column(
        "custom_field_values", sa.Column("contact_id", sa.Integer(), nullable=True)
    )
    # Re-point values back at the visit's contact where possible.
    op.get_bind().execute(
        sa.text(
            "UPDATE custom_field_values v SET contact_id = vh.contact_id"
            " FROM visit_history vh WHERE vh.id = v.visit_id"
        )
    )
    op.get_bind().execute(sa.text("DELETE FROM custom_field_values WHERE contact_id IS NULL"))
    op.alter_column("custom_field_values", "contact_id", nullable=False)
    op.create_foreign_key(
        "custom_field_values_contact_id_fkey",
        "custom_field_values",
        "contacts",
        ["contact_id"],
        ["id"],
    )
    op.create_index(
        op.f("ix_custom_field_values_contact_id"), "custom_field_values", ["contact_id"]
    )
    op.create_unique_constraint(
        "uq_customval_contact_def", "custom_field_values", ["contact_id", "definition_id"]
    )
    op.drop_index(op.f("ix_custom_field_values_visit_id"), table_name="custom_field_values")
    op.drop_constraint("fk_customval_visit", "custom_field_values", type_="foreignkey")
    op.drop_column("custom_field_values", "visit_id")

    op.drop_column("visit_history", "connection_to_rebbe")
    op.drop_column("visit_history", "torah_thought")
    for flag in reversed(_FLAGS):
        op.drop_column("visit_history", flag)
    op.drop_column("visit_history", "interactions")
