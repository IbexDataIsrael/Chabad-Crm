"""fixes53 §3/§4: shared "Number of Jews" / "Number of Engaged Jews"
calculation, reused by the Report Numbers and Areas grids.

`apartment.Jewish_status`'s 5 real (non-"na") technical values map 1:1 onto
the spec's category names:
    jewish                      -> Yid
    jewish_gentile               -> Yid and Goy
    jewish_shtumtz                -> Frum (שומר תורה ומצוות)
    jewish_interested             -> Engaged Yid
    jewish_interested_gentile     -> Engaged Yid and Goy
"Number of Jews" is every apartment carrying any of the 5; "Number of
Engaged Jews" is the two "interested" ones (a subset of the first)."""
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, picklist_utils

JEWISH_STATUS_FIELD_KEY = "apartment.Jewish_status"

JEWS_STATUSES = [
    "jewish",
    "jewish_gentile",
    "jewish_shtumtz",
    "jewish_interested",
    "jewish_interested_gentile",
]
ENGAGED_JEWS_STATUSES = ["jewish_interested", "jewish_interested_gentile"]


def apartment_jewish_counts_by(
    db: Session, org_id: int, group_col, join_building: bool = False
) -> dict[int, dict[str, int]]:
    """Counts of matching, active apartments grouped by `group_col` (e.g.
    `Apartment.report_number_id` or `Building.area_id`), keyed by that
    column's value. Missing keys mean zero for both counts — callers default
    them when building a response row per report-number/area."""
    base = db.query(models.Apartment).filter(
        models.Apartment.organization_id == org_id,
        models.Apartment.is_display.is_(True),
    )
    if join_building:
        base = base.join(models.Building, models.Building.id == models.Apartment.building_id)

    jews_ids = picklist_utils.matching_entity_ids(
        "apartments", JEWISH_STATUS_FIELD_KEY, JEWS_STATUSES
    )
    engaged_ids = picklist_utils.matching_entity_ids(
        "apartments", JEWISH_STATUS_FIELD_KEY, ENGAGED_JEWS_STATUSES
    )
    jews_map = dict(
        base.filter(models.Apartment.id.in_(jews_ids))
        .with_entities(group_col, func.count(models.Apartment.id))
        .group_by(group_col)
        .all()
    )
    engaged_map = dict(
        base.filter(models.Apartment.id.in_(engaged_ids))
        .with_entities(group_col, func.count(models.Apartment.id))
        .group_by(group_col)
        .all()
    )
    keys = {k for k in (*jews_map, *engaged_map) if k is not None}
    return {
        k: {"jews": jews_map.get(k, 0), "engaged": engaged_map.get(k, 0)} for k in keys
    }
