"""fixes68 §8/§B2/§B3 — activist route offline outbox key + not_jewish backfill

1. visit_history.client_uuid (String(36) NULL, unique index) — lets a retried
   POST /api/apartments/{id}/door-outcome (the outbox flushing after a
   dropped response) match the visit it already created instead of
   inserting a duplicate. Only door-outcome visits set it; every other
   visit keeps it NULL (a unique index allows any number of NULLs on both
   SQLite and Postgres).

2. Backfills the "not_jewish" apartment.Jewish_status option (fixes68 §5's
   don't-knock marker) into every existing organization. app.seed.seed_all
   already auto-provisions brand-new picklist *fields* for every org on
   startup (seed_picklist_definitions) and fills entirely-EMPTY lists
   (seed_default_options_for_empty_lists) — but apartment.Jewish_status
   already has 6 values in every org, so it never counts as "empty" and
   that path never fires for it. seed_picklists() (the general "add any
   missing option") is deliberately NOT run unconditionally on startup —
   it would also resurrect a default option an admin had since deleted
   from an already-populated list (see its own docstring). A one-time,
   idempotent data migration is the correct way to add exactly this one
   value once, the same way f1a2b3c4d5e6 seeded its custom-field rows.

Revision ID: cfead2898e35
Revises: f1a2b3c4d5e6
Create Date: 2026-09-25 00:00:00.000000

"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cfead2898e35"
down_revision: Union[str, Sequence[str], None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FIELD_KEY = "apartment.Jewish_status"
_VALUE = "not_jewish"
_HEBREW = "לא יהודי"
_ENGLISH = "Not Jewish"


def upgrade() -> None:
    with op.batch_alter_table("visit_history") as batch:
        batch.add_column(sa.Column("client_uuid", sa.String(36), nullable=True))
    op.create_index(
        "ix_visit_history_client_uuid",
        "visit_history",
        ["client_uuid"],
        unique=True,
    )

    conn = op.get_bind()
    org_ids = [r[0] for r in conn.execute(sa.text("SELECT id FROM organizations"))]
    if not org_ids:
        return  # fresh/empty DB — app startup seeding covers new orgs
    existing = {
        r[0]
        for r in conn.execute(
            sa.text(
                "SELECT organization_id FROM picklist_values"
                " WHERE field_key = :field AND value = :value"
            ),
            {"field": _FIELD_KEY, "value": _VALUE},
        )
    }
    max_sort_by_org = dict(
        conn.execute(
            sa.text(
                "SELECT organization_id, COALESCE(MAX(sort_order), -1)"
                " FROM picklist_values WHERE field_key = :field"
                " GROUP BY organization_id"
            ),
            {"field": _FIELD_KEY},
        ).fetchall()
    )
    for org_id in org_ids:
        if org_id in existing:
            continue
        conn.execute(
            sa.text(
                "INSERT INTO picklist_values"
                " (guid, organization_id, field_key, value, hebrew_label,"
                "  english_value, color_hint, sort_order, is_active, is_default,"
                "  created_at)"
                " VALUES (:guid, :org, :field, :value, :he, :en, NULL, :sort,"
                "  true, false, CURRENT_TIMESTAMP)"
            ),
            {
                "guid": str(uuid.uuid4()),
                "org": org_id,
                "field": _FIELD_KEY,
                "value": _VALUE,
                "he": _HEBREW,
                "en": _ENGLISH,
                "sort": max_sort_by_org.get(org_id, -1) + 1,
            },
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DELETE FROM picklist_values WHERE field_key = :field AND value = :value"
        ),
        {"field": _FIELD_KEY, "value": _VALUE},
    )

    op.drop_index("ix_visit_history_client_uuid", table_name="visit_history")
    with op.batch_alter_table("visit_history") as batch:
        batch.drop_column("client_uuid")
