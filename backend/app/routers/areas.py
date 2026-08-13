"""Area CRUD (geographic areas with optional drawn polygon), org-scoped.

Reads: any authenticated user. Mutations: admins only.
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models
from app.core.geo import point_in_polygon, polygon_ring
from app.core.shliach import resolve_shliach
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import (
    AreaCreate,
    AreaOut,
    AreaShliachAdd,
    AreaUpdate,
    BuildingOut,
    ContactOut,
    ShliachSummary,
)

router = APIRouter(prefix="/api/areas", tags=["areas"])


def _get_or_404(area_id: int, org_id: int, db: Session) -> models.Area:
    area = (
        db.query(models.Area)
        .filter(models.Area.id == area_id, models.Area.organization_id == org_id)
        .first()
    )
    if not area:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Area not found")
    return area


def _shliach_area_ids(user: models.User, db: Session) -> set[int]:
    """Area ids a shliach user covers — assigned directly (contact_shliach_area).
    fixes19: the apartment-coverage bridge is gone, so direct assignment is the
    only source. fixes21 §1: the shliach contact is resolved by the user_id link
    or by matching email (imported/unlinked shliachim)."""
    shliach = resolve_shliach(db, user)
    if not shliach:
        return set()
    direct = db.query(models.ContactShliachArea.area_id).filter(
        models.ContactShliachArea.contact_shliach_id == shliach.id
    )
    return {r[0] for r in direct.all()}


@router.get("", response_model=list[AreaOut])
def list_areas(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.Area).filter(
        models.Area.organization_id == current_user.organization_id
    )
    # A shliach only sees the areas they cover; admins/staff see all org areas.
    if current_user.role == "shliach":
        area_ids = _shliach_area_ids(current_user, db)
        if not area_ids:
            return []
        query = query.filter(models.Area.id.in_(area_ids))
    return query.order_by(models.Area.area_name).all()


@router.get("/shliach-assignments", response_model=dict[int, list[ShliachSummary]])
def area_shliach_assignments(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes43 §4.2: every area's currently-covering shliach(im), keyed by
    area_id — powers the reassignment conflict warning on the shliach edit
    form (a single query instead of one round trip per area)."""
    rows = (
        db.query(
            models.ContactShliachArea.area_id,
            models.Contact.id,
            models.Contact.name,
            models.Contact.last_name,
        )
        .join(
            models.ContactShliach,
            models.ContactShliach.id == models.ContactShliachArea.contact_shliach_id,
        )
        .join(models.Contact, models.Contact.id == models.ContactShliach.contact_id)
        .filter(
            models.Contact.organization_id == current_user.organization_id,
            # fixes45: a retired version's copied-forward area link must not
            # resurrect a since-removed coverage assignment.
            models.ContactShliach.is_display.is_(True),
        )
        .all()
    )
    result: dict[int, list[ShliachSummary]] = {}
    for area_id, contact_id, name, last_name in rows:
        result.setdefault(area_id, []).append(
            ShliachSummary(id=contact_id, name=name, last_name=last_name)
        )
    return result


@router.post("", response_model=AreaOut, status_code=status.HTTP_201_CREATED)
def create_area(
    payload: AreaCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    area = models.Area(**payload.model_dump(), organization_id=admin.organization_id)
    db.add(area)
    db.commit()
    db.refresh(area)
    return area


@router.get("/{area_id}", response_model=AreaOut)
def get_area(
    area_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    area = _get_or_404(area_id, current_user.organization_id, db)
    # A shliach may only read an area they cover.
    if current_user.role == "shliach" and area.id not in _shliach_area_ids(
        current_user, db
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Area not found")
    return area


@router.put("/{area_id}", response_model=AreaOut)
def update_area(
    area_id: int,
    payload: AreaUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    area = _get_or_404(area_id, admin.organization_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(area, field, value)
    db.commit()
    db.refresh(area)
    return area


@router.delete("/{area_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_area(
    area_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
    mode: Optional[Literal["cascade", "unassign"]] = None,
):
    """fixes33 §2.2: an area with buildings needs an explicit choice — cascade
    (delete the buildings + their apartments too) or unassign (keep the
    buildings, clear their area_id). Without buildings, deletes outright.

    `contact_shliach_area` rows (direct area-coverage assignments) have no
    ORM relationship declared on `Area`, so the ORM cascade never reaches
    them; left alone they trip the FK RESTRICT on every delete, buildings or
    not — that was the actual "deletion does nothing" bug. Always clear them
    first regardless of mode.
    """
    area = _get_or_404(area_id, admin.organization_id, db)
    buildings = (
        db.query(models.Building)
        .filter(models.Building.area_id == area.id)
        .all()
    )
    if buildings and mode is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"has_buildings": True, "building_count": len(buildings)},
        )

    db.query(models.ContactShliachArea).filter(
        models.ContactShliachArea.area_id == area.id
    ).delete(synchronize_session=False)

    if buildings and mode == "unassign":
        for b in buildings:
            b.area_id = None
        # SessionLocal runs autoflush=False: without an explicit flush here,
        # `db.delete(area)` below would lazy-load `area.buildings` (never
        # queried via the relationship yet) against the DB's still-unchanged
        # area_id values, cascade-delete-orphan them anyway, and silently
        # undo the unassign.
        db.flush()

    db.delete(area)  # mode == "cascade" (or no buildings): ORM cascades buildings→apartments.
    db.commit()


@router.get("/{area_id}/shluchim", response_model=list[ContactOut])
def area_shluchim(
    area_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Shliach contacts covering this area (contact_shliach_area). fixes19: the
    apartment-coverage bridge is gone, so direct assignment is the only source."""
    org_id = current_user.organization_id
    _get_or_404(area_id, org_id, db)

    via_area = (
        db.query(models.ContactShliach.contact_id)
        .join(
            models.ContactShliachArea,
            models.ContactShliachArea.contact_shliach_id == models.ContactShliach.id,
        )
        .filter(
            models.ContactShliachArea.area_id == area_id,
            # fixes45: ContactShliach is versioned now — a retired version's
            # copied-forward area link must not resurrect a since-removed
            # coverage assignment.
            models.ContactShliach.is_display.is_(True),
        )
    )
    contact_ids = {row[0] for row in via_area.all()}
    if not contact_ids:
        return []
    return (
        db.query(models.Contact)
        .filter(
            models.Contact.id.in_(contact_ids),
            models.Contact.organization_id == org_id,
        )
        .order_by(models.Contact.name)
        .all()
    )


@router.post(
    "/{area_id}/shluchim",
    response_model=list[ContactOut],
    status_code=status.HTTP_201_CREATED,
)
def add_area_shliach(
    area_id: int,
    payload: AreaShliachAdd,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """fixes18 §4.2: assign an existing shliach contact to cover this area —
    the area page's "add activist" dropdown. Idempotent: re-adding an already
    covering shliach is a no-op. Returns the updated covering list."""
    area = _get_or_404(area_id, admin.organization_id, db)
    contact = (
        db.query(models.Contact)
        .filter(
            models.Contact.id == payload.contact_id,
            models.Contact.organization_id == admin.organization_id,
            models.Contact.contact_type == "shliach",
        )
        .first()
    )
    if not contact or not contact.shliach:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "contact_id is not a shliach contact"
        )
    exists = (
        db.query(models.ContactShliachArea)
        .filter(
            models.ContactShliachArea.contact_shliach_id == contact.shliach.id,
            models.ContactShliachArea.area_id == area.id,
        )
        .first()
    )
    if not exists:
        db.add(
            models.ContactShliachArea(
                organization_id=admin.organization_id,
                contact_shliach_id=contact.shliach.id,
                area_id=area.id,
            )
        )
        db.commit()
    return area_shluchim(area_id, db, admin)


@router.get("/{area_id}/eligible-buildings", response_model=list[BuildingOut])
def area_eligible_buildings(
    area_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """fixes18 §4.3: the org's buildings whose coordinates fall inside this
    area's polygon and that aren't already assigned to it — the only options
    the area page's "add building" dropdown offers. Empty when the area has no
    (valid) polygon or no positioned building lies within it."""
    area = _get_or_404(area_id, admin.organization_id, db)
    ring = polygon_ring(area.area_polygon)
    if not ring:
        return []
    candidates = (
        db.query(models.Building)
        .filter(
            models.Building.organization_id == admin.organization_id,
            # fixes33 §2.2: area_id can now be NULL (unassigned) — `!=` alone
            # would silently exclude those buildings (NULL != x is NULL, not
            # TRUE), even though an unassigned building is exactly the kind
            # of candidate this "add building" picker should offer.
            or_(
                models.Building.area_id.is_(None),
                models.Building.area_id != area.id,
            ),
            models.Building.latitude.isnot(None),
            models.Building.longitude.isnot(None),
        )
        .order_by(models.Building.building_address, models.Building.id)
        .all()
    )
    return [
        b for b in candidates if point_in_polygon(b.longitude, b.latitude, ring)
    ]
