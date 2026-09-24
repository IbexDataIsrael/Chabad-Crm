"""Instinct API phase 2 (docs/system_api_part2.md §8)

1. contacts.notes (Text NULL) — the contact-level free-text parking lot.
2. visit_history.apartment_id (FK apartments.id, ON DELETE SET NULL),
   visit_history.followup_task (Text NULL), visit_history.followup_done
   (Boolean NOT NULL DEFAULT false) + partial index
   ix_visit_history_org_followup (organization_id, followup_done) WHERE
   followup_task IS NOT NULL.
3. apartments.source ('crm' default) / apartments.status ('active' default,
   indexed) — the same draft-first pair contacts already have. Apartments are
   versioned; existing rows are all correctly 'crm'/'active' via the server
   defaults, no backfill needed.
4. Seeds the four contact-level counter custom fields (tefillin/mezuzot) for
   organization INSTINCT_ORG_ID (fallback 1), check-then-insert. NOTE: the
   spec says entity_type='contact', but the real contact entity types are
   'contact_mekurav' | 'contact_shliach' (app/custom_field_utils.py); these
   are seeded as 'contact_mekurav' — every Instinct-created contact is a
   mekurav — so the contact form renders them. Values store under
   entity_table='contacts' either way.

Revision ID: f1a2b3c4d5e6
Revises: e6f7a8b9c0d1
Create Date: 2026-09-24 00:00:00.000000

"""
import os
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ENTITY_TYPE = "contact_mekurav"

# (field_key, field_type, hebrew_label, english_label)
_DEFS: list[tuple[str, str, str, str]] = [
    ("tefillin_laid_count", "number", "הנחות תפילין", "Tefillin laid count"),
    ("tefillin_last_date", "date", "הנחת תפילין אחרונה", "Last tefillin date"),
    ("mezuzot_ordered", "number", "מזוזות שהוזמנו", "Mezuzot ordered"),
    ("mezuzot_installed", "number", "מזוזות שהודבקו", "Mezuzot installed"),
]
_DEF_KEYS = [d[0] for d in _DEFS]


def _org_id() -> int:
    return int(os.environ.get("INSTINCT_ORG_ID") or "1")


def upgrade() -> None:
    # 1. contacts.notes
    op.add_column("contacts", sa.Column("notes", sa.Text(), nullable=True))

    # 2. visit_history: apartment link + follow-up
    with op.batch_alter_table("visit_history") as batch:
        batch.add_column(sa.Column("apartment_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("followup_task", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column(
                "followup_done",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            )
        )
        batch.create_foreign_key(
            "fk_visit_history_apartment_id",
            "apartments",
            ["apartment_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index(
        "ix_visit_history_apartment_id", "visit_history", ["apartment_id"], unique=False
    )
    op.create_index(
        "ix_visit_history_org_followup",
        "visit_history",
        ["organization_id", "followup_done"],
        unique=False,
        postgresql_where=sa.text("followup_task IS NOT NULL"),
    )

    # 3. apartments.source / status
    op.add_column(
        "apartments",
        sa.Column("source", sa.String(20), nullable=False, server_default="crm"),
    )
    op.add_column(
        "apartments",
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
    )
    op.create_index("ix_apartments_status", "apartments", ["status"], unique=False)

    # 4. Seed the contact counter custom fields (idempotent).
    conn = op.get_bind()
    org_id = _org_id()
    if conn.execute(
        sa.text("SELECT 1 FROM organizations WHERE id = :org"), {"org": org_id}
    ).first() is None:
        return  # fresh/empty DB — nothing to seed for
    existing = {
        r[0]
        for r in conn.execute(
            sa.text(
                "SELECT field_key FROM custom_field_definitions"
                " WHERE organization_id = :org AND entity_type = :et"
            ),
            {"org": org_id, "et": _ENTITY_TYPE},
        )
    }
    max_sort = conn.execute(
        sa.text(
            "SELECT COALESCE(MAX(sort_order), -1) FROM custom_field_definitions"
            " WHERE organization_id = :org AND entity_type = :et"
        ),
        {"org": org_id, "et": _ENTITY_TYPE},
    ).scalar()
    for offset, (field_key, field_type, he, en) in enumerate(_DEFS, start=1):
        if field_key in existing:
            continue
        conn.execute(
            sa.text(
                "INSERT INTO custom_field_definitions"
                " (guid, organization_id, entity_type, field_key, hebrew_label,"
                "  english_label, field_type, sort_order, is_active, created_at)"
                " VALUES (:guid, :org, :et, :key, :he, :en, :ftype, :sort,"
                "  true, CURRENT_TIMESTAMP)"
            ),
            {
                "guid": str(uuid.uuid4()),
                "org": org_id,
                "et": _ENTITY_TYPE,
                "key": field_key,
                "he": he,
                "en": en,
                "ftype": field_type,
                "sort": max_sort + offset,
            },
        )


def downgrade() -> None:
    # 4. Seeded definitions (their values first — FK).
    conn = op.get_bind()
    params = {"org": _org_id(), "et": _ENTITY_TYPE}
    key_list = ", ".join(f"'{k}'" for k in _DEF_KEYS)
    def_filter = (
        "SELECT id FROM custom_field_definitions WHERE organization_id = :org"
        f" AND entity_type = :et AND field_key IN ({key_list})"
    )
    conn.execute(
        sa.text(f"DELETE FROM custom_field_values WHERE definition_id IN ({def_filter})"),
        params,
    )
    conn.execute(
        sa.text(
            "DELETE FROM custom_field_definitions WHERE organization_id = :org"
            f" AND entity_type = :et AND field_key IN ({key_list})"
        ),
        params,
    )

    # 3.
    op.drop_index("ix_apartments_status", table_name="apartments")
    with op.batch_alter_table("apartments") as batch:
        batch.drop_column("status")
        batch.drop_column("source")

    # 2.
    op.drop_index("ix_visit_history_org_followup", table_name="visit_history")
    op.drop_index("ix_visit_history_apartment_id", table_name="visit_history")
    with op.batch_alter_table("visit_history") as batch:
        batch.drop_constraint("fk_visit_history_apartment_id", type_="foreignkey")
        batch.drop_column("followup_done")
        batch.drop_column("followup_task")
        batch.drop_column("apartment_id")

    # 1.
    with op.batch_alter_table("contacts") as batch:
        batch.drop_column("notes")
