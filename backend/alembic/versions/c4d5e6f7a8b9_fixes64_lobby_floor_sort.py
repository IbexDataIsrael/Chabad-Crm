"""fixes64 — backfill "L" (Lobby) floor sort_order.

`add_floor()` and `create_building()` have always intended "L" to sort ahead
of every other floor in a building (fixes52 §3), but the bulk-import scripts'
own `floor_sort_order()` helper never special-cased it — an "L" floor landed
in the generic "unrecognized name" bucket (sort_order 900) instead, tying or
losing to plain numbered/lettered floors and even sorting after "B"/"BSMT"
(-1). This is a data-only fix: for every "L" floor that isn't already first
in its building, push it below the building's current minimum sort_order.

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-09-17 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, Sequence[str], None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_BACKFILL_SQL = """
WITH non_l_min AS (
    SELECT building_id, MIN(sort_order) AS min_so
    FROM floors
    WHERE UPPER(name) <> 'L'
    GROUP BY building_id
)
UPDATE floors f
SET sort_order = non_l_min.min_so - 1
FROM non_l_min
WHERE f.building_id = non_l_min.building_id
  AND UPPER(f.name) = 'L'
  AND f.sort_order >= non_l_min.min_so
"""


def upgrade() -> None:
    op.get_bind().execute(sa.text(_BACKFILL_SQL))


def downgrade() -> None:
    # Data-only fix — no schema change, and the pre-fix sort_order values
    # weren't recorded anywhere to restore.
    pass
