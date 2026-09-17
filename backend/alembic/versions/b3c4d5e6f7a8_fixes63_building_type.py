"""fixes63 — building_type reference table.

Replaces the old string-heuristic ("does this building's single apartment's
name contain '-th'?") with an explicit `buildings.building_type_id` FK:
'building' | 'town_house' | 'divided_town_house'. Existing buildings are
backfilled from `is_town_house` + their current apartment set using that same
heuristic (so the migration doesn't change anyone's classification), then the
now-redundant "-th" suffix is stripped from every affected apartment's name
(all versions, so history reads clean too).

Revision ID: b3c4d5e6f7a8
Revises: a1f2b3c4d5e6
Create Date: 2026-09-17 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, Sequence[str], None] = "a1f2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_BUILDING_TYPES = [
    ("building", "Building", "בניין"),
    ("town_house", "Town house", "בית פרטי"),
    ("divided_town_house", "Divided town house", "בית מחולק"),
]


def _backfill(conn) -> None:
    town_house_ids = [
        r[0]
        for r in conn.execute(
            sa.text("SELECT id FROM buildings WHERE is_town_house = TRUE")
        )
    ]
    if not town_house_ids:
        return
    apartments_by_building: dict[int, list[tuple[int, str]]] = {}
    rows = conn.execute(
        sa.text(
            "SELECT id, building_id, apartment_name FROM apartments"
            " WHERE building_id = ANY(:ids) AND is_display = TRUE"
        ),
        {"ids": town_house_ids},
    )
    for apt_id, building_id, apartment_name in rows:
        apartments_by_building.setdefault(building_id, []).append(
            (apt_id, apartment_name or "")
        )

    town_house_type: dict[int, str] = {}
    for building_id in town_house_ids:
        apts = apartments_by_building.get(building_id, [])
        if len(apts) == 1 and "-th" in apts[0][1].lower():
            town_house_type[building_id] = "town_house"
        else:
            town_house_type[building_id] = "divided_town_house"

    for building_id, building_type in town_house_type.items():
        conn.execute(
            sa.text("UPDATE buildings SET building_type_id = :t WHERE id = :id"),
            {"t": building_type, "id": building_id},
        )

    # Strip the now-redundant "-th" suffix from every version of the single
    # apartment belonging to a plain (undivided) town house.
    plain_ids = [bid for bid, t in town_house_type.items() if t == "town_house"]
    if not plain_ids:
        return
    name_rows = conn.execute(
        sa.text(
            "SELECT id, apartment_name FROM apartments WHERE building_id = ANY(:ids)"
        ),
        {"ids": plain_ids},
    )
    for apt_id, apartment_name in name_rows:
        if apartment_name and apartment_name.lower().endswith("-th"):
            conn.execute(
                sa.text("UPDATE apartments SET apartment_name = :n WHERE id = :id"),
                {"n": apartment_name[:-3], "id": apt_id},
            )


def upgrade() -> None:
    op.create_table(
        "building_type",
        sa.Column("id", sa.String(length=50), primary_key=True),
        sa.Column("name_en", sa.String(length=100), nullable=False),
        sa.Column("name_he", sa.String(length=100), nullable=False),
    )
    building_type_table = sa.table(
        "building_type",
        sa.column("id", sa.String),
        sa.column("name_en", sa.String),
        sa.column("name_he", sa.String),
    )
    op.bulk_insert(
        building_type_table,
        [{"id": i, "name_en": en, "name_he": he} for i, en, he in _BUILDING_TYPES],
    )

    op.add_column(
        "buildings",
        sa.Column(
            "building_type_id",
            sa.String(length=50),
            nullable=False,
            server_default="building",
        ),
    )
    with op.batch_alter_table("buildings") as batch_op:
        batch_op.create_foreign_key(
            "fk_buildings_building_type_id", "building_type", ["building_type_id"], ["id"]
        )

    _backfill(op.get_bind())


def downgrade() -> None:
    with op.batch_alter_table("buildings") as batch_op:
        batch_op.drop_constraint("fk_buildings_building_type_id", type_="foreignkey")
        batch_op.drop_column("building_type_id")
    op.drop_table("building_type")
