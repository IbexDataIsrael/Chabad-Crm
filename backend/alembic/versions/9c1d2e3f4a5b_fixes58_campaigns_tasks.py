"""fixes58 — Campaign & Task entities, volunteer access control migration.

Adds `campaigns`, `tasks`, `task_report_numbers` (see `docs/plan58-plan.md`
Phase 1) and the new `campaign_manager` role. Apartment visibility for a
shliach used to come from a direct `ReportNumberContactShliach` assignment;
going forward it comes from a report number being linked
(`task_report_numbers`) to a Task with `status = 'ACTIVE'` under a Campaign
with `is_active = true` (`_shliach_apartment_ids`,
`backend/app/routers/apartments.py`). The old assignment table is left in
place (unread by access control from here on) — dropping it isn't
reversible and isn't asked for.

This is a live production system, so a hard cutover would silently strip
apartment access from every currently-assigned shliach the moment this runs.
`upgrade()` therefore auto-wraps existing state: for each org that has at
least one shliach with (a) a `ReportNumberContactShliach` assignment and (b)
a linked `ContactShliach.user_id` (a Task needs a real login — see the
plan's decision #2), create one Campaign ("גישה קיימת" / Legacy Access,
active) and one ACTIVE Task per such shliach carrying their existing report
numbers into `task_report_numbers`. Orgs with zero such shliachim get no
Legacy campaign at all (there is nothing to preserve) — a deliberate,
sensible narrowing of the plan's literal "for each org" wording, not a
missed step. Shluchim with report-number assignments but no linked login
(email-fallback-only, per fixes21) can't be represented as a Task volunteer;
these are printed during the migration for manual reconciliation.
"""
import datetime
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9c1d2e3f4a5b"
down_revision: Union[str, Sequence[str], None] = "8e9f0a1b2c3d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "campaigns",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id", sa.Integer(), sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("custom_stats_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_campaigns_guid", "campaigns", ["guid"], unique=True)
    op.create_index("ix_campaigns_organization_id", "campaigns", ["organization_id"])

    op.create_table(
        "tasks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id", sa.Integer(), sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "campaign_id", sa.Integer(), sa.ForeignKey("campaigns.id"), nullable=False,
        ),
        sa.Column(
            "volunteer_user_id", sa.Integer(), sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "custom_date_value_id", sa.Integer(),
            sa.ForeignKey("picklist_values.id"), nullable=True,
        ),
        sa.Column(
            "status", sa.String(length=20), nullable=False, server_default="ACTIVE",
        ),
        sa.Column("volunteer_report_summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_tasks_guid", "tasks", ["guid"], unique=True)
    op.create_index("ix_tasks_organization_id", "tasks", ["organization_id"])
    op.create_index("ix_tasks_campaign_id", "tasks", ["campaign_id"])
    op.create_index("ix_tasks_volunteer_user_id", "tasks", ["volunteer_user_id"])
    op.create_index("ix_tasks_custom_date_value_id", "tasks", ["custom_date_value_id"])

    op.create_table(
        "task_report_numbers",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id", sa.Integer(), sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "task_id", sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "report_number_id", sa.Integer(),
            sa.ForeignKey("report_number.id", ondelete="CASCADE"), nullable=False,
        ),
    )
    op.create_index(
        "ix_task_report_numbers_guid", "task_report_numbers", ["guid"], unique=True,
    )
    op.create_index(
        "ix_task_report_numbers_organization_id", "task_report_numbers",
        ["organization_id"],
    )
    op.create_index(
        "ix_task_report_numbers_task_id", "task_report_numbers", ["task_id"],
    )
    op.create_index(
        "ix_task_report_numbers_report_number_id", "task_report_numbers",
        ["report_number_id"],
    )
    op.create_unique_constraint(
        "uq_task_report_number", "task_report_numbers", ["task_id", "report_number_id"],
    )

    conn = op.get_bind()
    conn.execute(
        sa.text("INSERT INTO roles (name, sort_order) VALUES ('campaign_manager', 5)"
                " ON CONFLICT (name) DO NOTHING")
    )

    # --- Legacy-access backfill (see module docstring) ---
    now = datetime.datetime.utcnow()
    orgs = conn.execute(sa.text("SELECT id FROM organizations")).fetchall()
    for (org_id,) in orgs:
        shluchim = conn.execute(
            sa.text(
                "SELECT DISTINCT cs.id, cs.user_id"
                " FROM contact_shliach cs"
                " JOIN report_number_contact_shliach rncs"
                "   ON rncs.contact_shliach_id = cs.id"
                " WHERE cs.organization_id = :org_id AND cs.is_display = true"
            ),
            {"org_id": org_id},
        ).fetchall()
        migratable = [(cs_id, user_id) for cs_id, user_id in shluchim if user_id is not None]
        unmigratable = [cs_id for cs_id, user_id in shluchim if user_id is None]
        for cs_id in unmigratable:
            print(
                f"fixes58 migration: org {org_id} contact_shliach {cs_id} has report-number"
                " assignments but no linked login — not migrated into a Task,"
                " needs manual reconciliation."
            )
        if not migratable:
            continue

        campaign_guid = str(uuid.uuid4())
        campaign_id = conn.execute(
            sa.text(
                "INSERT INTO campaigns"
                " (guid, organization_id, name, is_active, created_at, updated_at)"
                " VALUES (:g, :org_id, :name, true, :now, :now) RETURNING id"
            ),
            {"g": campaign_guid, "org_id": org_id, "name": "גישה קיימת", "now": now},
        ).scalar()

        for cs_id, user_id in migratable:
            task_guid = str(uuid.uuid4())
            task_id = conn.execute(
                sa.text(
                    "INSERT INTO tasks"
                    " (guid, organization_id, campaign_id, volunteer_user_id, status,"
                    "  created_at, updated_at)"
                    " VALUES (:g, :org_id, :campaign_id, :user_id, 'ACTIVE', :now, :now)"
                    " RETURNING id"
                ),
                {
                    "g": task_guid, "org_id": org_id, "campaign_id": campaign_id,
                    "user_id": user_id, "now": now,
                },
            ).scalar()
            report_number_ids = conn.execute(
                sa.text(
                    "SELECT report_number_id FROM report_number_contact_shliach"
                    " WHERE contact_shliach_id = :cs_id"
                ),
                {"cs_id": cs_id},
            ).fetchall()
            for (rn_id,) in report_number_ids:
                conn.execute(
                    sa.text(
                        "INSERT INTO task_report_numbers"
                        " (guid, organization_id, task_id, report_number_id)"
                        " VALUES (:g, :org_id, :task_id, :rn_id)"
                        " ON CONFLICT (task_id, report_number_id) DO NOTHING"
                    ),
                    {
                        "g": str(uuid.uuid4()), "org_id": org_id, "task_id": task_id,
                        "rn_id": rn_id,
                    },
                )


def downgrade() -> None:
    op.drop_table("task_report_numbers")
    op.drop_table("tasks")
    op.drop_table("campaigns")
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM roles WHERE name = 'campaign_manager'"))
