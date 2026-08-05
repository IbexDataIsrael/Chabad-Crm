"""Code review hardening — composite indexes for hot multi-tenant queries.

`contacts` and `visit_history` each already index `organization_id` alone;
these composite indexes cover the two most common filter combinations:
owner-scoped contact lookups (`organization_id, assigned_user_id`) and
date-range visit queries (`organization_id, visit_date`, e.g. visits_summary
and the contacts date-range filter). Purely additive — no data change.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f5a6b7c8d9e0"
down_revision: Union[str, Sequence[str], None] = "e4f5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_contacts_org_assigned_user",
        "contacts",
        ["organization_id", "assigned_user_id"],
    )
    op.create_index(
        "ix_visit_history_org_visit_date",
        "visit_history",
        ["organization_id", "visit_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_visit_history_org_visit_date", table_name="visit_history")
    op.drop_index("ix_contacts_org_assigned_user", table_name="contacts")
