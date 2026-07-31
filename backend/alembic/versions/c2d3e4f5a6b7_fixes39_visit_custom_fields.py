"""fixes39 — Mivtzoim booleans + connection_to_rebbe become custom fields.

`visit_history` loses its 6 hardcoded columns (`tefillin`, `tzedakah`,
`shabbat_candles`, `torah_pamphlet`, `letter_in_torah`, `connection_to_rebbe`)
— they become ordinary `entity_type="visit"` custom fields
(`CustomFieldDefinition`/`CustomFieldValue`), the same mechanism org-added
checklist items ("mezuzah" etc., already in production) use.

For every existing organization:
1. Create the 6 `custom_field_definitions` rows if not already present
   (conflict-check, never a duplicate — an org that already has its own
   same-named custom field, however unlikely, is left untouched).
2. Copy each visit's data into `custom_field_values` — only rows with a
   truthy value are written (absence already means unchecked/empty, mirrors
   `custom_field_utils.set_value`'s own storage convention, so this keeps
   the table from ballooning with all-False rows).
3. Drop the 6 columns.

Run `scripts/fixes25_backup.py`-style backup against the target DB BEFORE
upgrading in production — the downgrade only best-effort restores the
columns from the migrated custom-field rows (mirrors this repo's own
c5d6e7f8a9b0/f9a0b1c2d3e4 downgrade convention: structure back, data
best-effort, never destroyed on upgrade).
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, Sequence[str], None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_BOOLEAN_KEYS = (
    "tefillin",
    "tzedakah",
    "shabbat_candles",
    "torah_pamphlet",
    "letter_in_torah",
)

# (field_key, field_type, hebrew_label, english_label, sort_order) — same
# key names the columns had, same he/en labels the old LOCALIZATION_SEED
# "visits.*" rows used.
_DEFS: list[tuple[str, str, str, str, int]] = [
    ("tefillin", "boolean", "תפילין", "Tefillin", 0),
    ("tzedakah", "boolean", "צדקה", "Tzedakah", 1),
    ("shabbat_candles", "boolean", "נרות", "Shabbat candles", 2),
    ("torah_pamphlet", "boolean", "עלון", "Torah pamphlet", 3),
    ("letter_in_torah", "boolean", "אות בספר", "Letter in a Torah", 4),
    ("connection_to_rebbe", "text", "קשר לרבי", "Connection to the Rebbe", 5),
]

_DEF_KEYS = [d[0] for d in _DEFS]


def upgrade() -> None:
    conn = op.get_bind()

    org_ids = [r[0] for r in conn.execute(sa.text("SELECT id FROM organizations"))]

    existing = {
        (r[0], r[1])
        for r in conn.execute(
            sa.text(
                "SELECT organization_id, field_key FROM custom_field_definitions"
                " WHERE entity_type = 'visit' AND field_key = ANY(:keys)"
            ),
            {"keys": _DEF_KEYS},
        )
    }
    for org_id in org_ids:
        for field_key, field_type, he, en, sort_order in _DEFS:
            if (org_id, field_key) in existing:
                continue
            conn.execute(
                sa.text(
                    "INSERT INTO custom_field_definitions"
                    " (guid, organization_id, entity_type, field_key, hebrew_label,"
                    "  english_label, field_type, sort_order, is_active, created_at)"
                    " VALUES (:guid, :org, 'visit', :key, :he, :en, :ftype, :sort,"
                    "  true, now())"
                ),
                {
                    "guid": str(uuid.uuid4()),
                    "org": org_id,
                    "key": field_key,
                    "he": he,
                    "en": en,
                    "ftype": field_type,
                    "sort": sort_order,
                },
            )

    def_id_by_org_key: dict[tuple[int, str], int] = {
        (r[1], r[2]): r[0]
        for r in conn.execute(
            sa.text(
                "SELECT id, organization_id, field_key FROM custom_field_definitions"
                " WHERE entity_type = 'visit' AND field_key = ANY(:keys)"
            ),
            {"keys": _DEF_KEYS},
        )
    }

    visits = conn.execute(
        sa.text(
            "SELECT id, organization_id, tefillin, tzedakah, shabbat_candles,"
            " torah_pamphlet, letter_in_torah, connection_to_rebbe FROM visit_history"
        )
    ).fetchall()
    for (
        visit_id,
        org_id,
        tefillin,
        tzedakah,
        candles,
        pamphlet,
        letter,
        rebbe,
    ) in visits:
        for field_key, checked in (
            ("tefillin", tefillin),
            ("tzedakah", tzedakah),
            ("shabbat_candles", candles),
            ("torah_pamphlet", pamphlet),
            ("letter_in_torah", letter),
        ):
            if not checked:
                continue
            def_id = def_id_by_org_key.get((org_id, field_key))
            if def_id is None:
                continue
            conn.execute(
                sa.text(
                    "INSERT INTO custom_field_values"
                    " (guid, organization_id, entity_table, entity_id, visit_id,"
                    "  definition_id, checked, value)"
                    " VALUES (:guid, :org, 'visit_history', :eid, :eid, :def_id,"
                    "  true, NULL)"
                ),
                {
                    "guid": str(uuid.uuid4()),
                    "org": org_id,
                    "eid": visit_id,
                    "def_id": def_id,
                },
            )
        if rebbe and rebbe.strip():
            def_id = def_id_by_org_key.get((org_id, "connection_to_rebbe"))
            if def_id is not None:
                conn.execute(
                    sa.text(
                        "INSERT INTO custom_field_values"
                        " (guid, organization_id, entity_table, entity_id, visit_id,"
                        "  definition_id, checked, value)"
                        " VALUES (:guid, :org, 'visit_history', :eid, :eid, :def_id,"
                        "  false, :val)"
                    ),
                    {
                        "guid": str(uuid.uuid4()),
                        "org": org_id,
                        "eid": visit_id,
                        "def_id": def_id,
                        "val": rebbe,
                    },
                )

    op.drop_column("visit_history", "tefillin")
    op.drop_column("visit_history", "tzedakah")
    op.drop_column("visit_history", "shabbat_candles")
    op.drop_column("visit_history", "torah_pamphlet")
    op.drop_column("visit_history", "letter_in_torah")
    op.drop_column("visit_history", "connection_to_rebbe")


def downgrade() -> None:
    """Structure-only downgrade — best-effort backfill from the migrated
    custom-field rows (mirrors c5d6e7f8a9b0/f9a0b1c2d3e4's own downgrade
    convention). The custom_field_definitions/values rows themselves are
    left in place (harmless, and other orgs' genuinely custom fields with
    unrelated keys are never touched by this migration either way)."""
    op.add_column(
        "visit_history",
        sa.Column("tefillin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "visit_history",
        sa.Column("tzedakah", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "visit_history",
        sa.Column(
            "shabbat_candles", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "visit_history",
        sa.Column(
            "torah_pamphlet", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "visit_history",
        sa.Column(
            "letter_in_torah", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "visit_history", sa.Column("connection_to_rebbe", sa.Text(), nullable=True)
    )

    conn = op.get_bind()
    for field_key in _BOOLEAN_KEYS:
        conn.execute(
            sa.text(
                f"UPDATE visit_history vh SET {field_key} = true"
                " FROM custom_field_values v"
                " JOIN custom_field_definitions d ON d.id = v.definition_id"
                " WHERE v.entity_table = 'visit_history' AND v.entity_id = vh.id"
                "  AND d.entity_type = 'visit' AND d.field_key = :key"
                "  AND v.checked = true"
            ),
            {"key": field_key},
        )
    conn.execute(
        sa.text(
            "UPDATE visit_history vh SET connection_to_rebbe = v.value"
            " FROM custom_field_values v"
            " JOIN custom_field_definitions d ON d.id = v.definition_id"
            " WHERE v.entity_table = 'visit_history' AND v.entity_id = vh.id"
            "  AND d.entity_type = 'visit' AND d.field_key = 'connection_to_rebbe'"
            "  AND v.value IS NOT NULL"
        )
    )
