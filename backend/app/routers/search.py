"""Global search across areas, buildings, apartments, and contacts (org-scoped).

One endpoint powers the header search box: case-insensitive "contains" match,
capped per entity type. A shliach user only gets results inside their coverage
(same rules as the areas/contacts routers); admin/staff see the whole org.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app import models
from app.database import get_db
from app.deps import get_current_user
from app.routers.areas import _shliach_area_ids
from app.routers.contacts import _shliach_apartment_ids
from app.schemas import SearchHit, SearchOut

router = APIRouter(prefix="/api/search", tags=["search"])

MAX_PER_TYPE = 10
MIN_QUERY_LEN = 2


@router.get("", response_model=SearchOut)
def global_search(
    q: str = Query("", max_length=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    term = q.strip()
    if len(term) < MIN_QUERY_LEN:
        return SearchOut(query=term, results=[])

    org_id = current_user.organization_id
    like = f"%{term}%"
    is_shliach = current_user.role == "shliach"
    # Coverage for shliach users; None means "no restriction" (admin/staff).
    allowed_area_ids = _shliach_area_ids(current_user, db) if is_shliach else None
    results: list[SearchHit] = []

    # --- Contacts (mekurav + shliach) ---
    contacts = db.query(models.Contact).filter(
        models.Contact.organization_id == org_id,
        or_(
            models.Contact.name.ilike(like),
            models.Contact.last_name.ilike(like),
            models.Contact.phone.ilike(like),
            models.Contact.email.ilike(like),
        ),
    )
    if is_shliach:
        ap_ids = _shliach_apartment_ids(db, current_user)
        own = db.query(models.ContactShliach.contact_id).filter(
            models.ContactShliach.user_id == current_user.id
        )
        via_apartment = db.query(models.ContactMekurav.contact_id).filter(
            models.ContactMekurav.apartment_id.in_(ap_ids or [-1])
        )
        visible_ids = {r[0] for r in own.all()} | {r[0] for r in via_apartment.all()}
        contacts = contacts.filter(models.Contact.id.in_(visible_ids or [-1]))
    for c in contacts.order_by(models.Contact.name).limit(MAX_PER_TYPE).all():
        full_name = f"{c.name} {c.last_name}".strip() if c.last_name else c.name
        results.append(
            SearchHit(
                type="contact",
                id=c.id,
                title=full_name,
                subtitle=c.phone,
                contact_type=c.contact_type,
            )
        )

    # --- Areas ---
    areas = db.query(models.Area).filter(
        models.Area.organization_id == org_id,
        or_(
            models.Area.area_name.ilike(like),
            models.Area.area_notes.ilike(like),
        ),
    )
    if allowed_area_ids is not None:
        areas = areas.filter(models.Area.id.in_(allowed_area_ids or [-1]))
    for a in areas.order_by(models.Area.area_name).limit(MAX_PER_TYPE).all():
        results.append(SearchHit(type="area", id=a.id, title=a.area_name))

    # --- Buildings (subtitle = area name) ---
    buildings = (
        db.query(models.Building)
        .options(joinedload(models.Building.area))
        .filter(
            models.Building.organization_id == org_id,
            or_(
                models.Building.building_name.ilike(like),
                models.Building.building_address.ilike(like),
            ),
        )
    )
    if allowed_area_ids is not None:
        buildings = buildings.filter(
            models.Building.area_id.in_(allowed_area_ids or [-1])
        )
    for b in buildings.order_by(models.Building.building_name).limit(MAX_PER_TYPE).all():
        results.append(
            SearchHit(
                type="building",
                id=b.id,
                title=b.building_name,
                subtitle=b.area.area_name if b.area else None,
            )
        )

    # --- Apartments (subtitle = building name) ---
    apartments = (
        db.query(models.Apartment)
        .options(joinedload(models.Apartment.building))
        .filter(
            models.Apartment.organization_id == org_id,
            or_(
                models.Apartment.apartment_name.ilike(like),
                models.Apartment.apartment_notes.ilike(like),
            ),
        )
    )
    if allowed_area_ids is not None:
        apartments = apartments.join(
            models.Building, models.Building.id == models.Apartment.building_id
        ).filter(models.Building.area_id.in_(allowed_area_ids or [-1]))
    for ap in (
        apartments.order_by(models.Apartment.apartment_name).limit(MAX_PER_TYPE).all()
    ):
        results.append(
            SearchHit(
                type="apartment",
                id=ap.id,
                title=ap.apartment_name,
                subtitle=ap.building.building_name if ap.building else None,
            )
        )

    return SearchOut(query=term, results=results)
