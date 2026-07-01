"""Visit history (היסטורית ביקורים).

Two routers over the same `VisitHistory` entity:
- `router`      — per-contact sub-resource (/api/contacts/{id}/visits), open to any
                  authenticated org member; powers the contact page's visit section.
- `all_router`  — top-level (/api/visits), **admin-only**; the org-wide visits page
                  with an optional ?contact_id filter. Visits may be contact-less.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.picklist_utils import validate_picklist_value
from app.schemas import VisitCreate, VisitOut, VisitUpdate

router = APIRouter(prefix="/api/contacts", tags=["visits"])
all_router = APIRouter(prefix="/api/visits", tags=["visits"])


def _out(v: models.VisitHistory) -> VisitOut:
    contact = v.contact
    name = f"{contact.name} {contact.last_name or ''}".strip() if contact else None
    return VisitOut(
        id=v.id,
        guid=v.guid,
        contact_id=v.contact_id,
        contact_name=name,
        visit_date=v.visit_date,
        visit_type=v.visit_type,
        location=v.location,
        notes=v.notes,
    )


def _contact_or_404(contact_id: int, org_id: int, db: Session) -> models.Contact:
    c = (
        db.query(models.Contact)
        .filter(
            models.Contact.id == contact_id,
            models.Contact.organization_id == org_id,
        )
        .first()
    )
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    return c


def _validate_contact(contact_id: Optional[int], org_id: int, db: Session) -> None:
    """Contact is optional; if given it must belong to the caller's org."""
    if contact_id is not None:
        _contact_or_404(contact_id, org_id, db)


def _visit_or_404(
    visit_id: int, org_id: int, db: Session, contact_id: Optional[int] = None
) -> models.VisitHistory:
    q = db.query(models.VisitHistory).filter(
        models.VisitHistory.id == visit_id,
        models.VisitHistory.organization_id == org_id,
    )
    if contact_id is not None:
        q = q.filter(models.VisitHistory.contact_id == contact_id)
    v = q.first()
    if not v:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visit not found")
    return v


# --- Per-contact sub-resource (contact page) -------------------------------
@router.get("/{contact_id}/visits", response_model=list[VisitOut])
def list_visits(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _contact_or_404(contact_id, current_user.organization_id, db)
    rows = (
        db.query(models.VisitHistory)
        .filter(
            models.VisitHistory.contact_id == contact_id,
            models.VisitHistory.organization_id == current_user.organization_id,
        )
        .order_by(models.VisitHistory.visit_date.desc())
        .all()
    )
    return [_out(v) for v in rows]


@router.post("/{contact_id}/visits", response_model=VisitOut, status_code=status.HTTP_201_CREATED)
def add_visit(
    contact_id: int,
    payload: VisitCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    _contact_or_404(contact_id, org_id, db)
    validate_picklist_value(db, org_id, "visit.type", payload.visit_type)
    v = models.VisitHistory(
        organization_id=org_id,
        contact_id=contact_id,
        visit_date=payload.visit_date,
        visit_type=payload.visit_type,
        location=payload.location,
        notes=payload.notes,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return _out(v)


@router.put("/{contact_id}/visits/{visit_id}", response_model=VisitOut)
def update_visit(
    contact_id: int,
    visit_id: int,
    payload: VisitUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    v = _visit_or_404(visit_id, org_id, db, contact_id=contact_id)
    data = payload.model_dump(exclude_unset=True)
    if "visit_type" in data:
        validate_picklist_value(db, org_id, "visit.type", data["visit_type"])
    # contact_id stays locked to the path on the sub-resource.
    data.pop("contact_id", None)
    for field, value in data.items():
        setattr(v, field, value)
    db.commit()
    db.refresh(v)
    return _out(v)


@router.delete("/{contact_id}/visits/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_visit(
    contact_id: int,
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    v = _visit_or_404(visit_id, current_user.organization_id, db, contact_id=contact_id)
    db.delete(v)
    db.commit()


# --- Top-level entity (admin-only org-wide visits page) --------------------
@all_router.get("", response_model=list[VisitOut])
def list_all_visits(
    contact_id: Optional[int] = None,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    q = db.query(models.VisitHistory).filter(
        models.VisitHistory.organization_id == admin.organization_id
    )
    if contact_id is not None:
        q = q.filter(models.VisitHistory.contact_id == contact_id)
    rows = q.order_by(models.VisitHistory.visit_date.desc()).all()
    return [_out(v) for v in rows]


@all_router.post("", response_model=VisitOut, status_code=status.HTTP_201_CREATED)
def create_visit(
    payload: VisitCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    org_id = admin.organization_id
    _validate_contact(payload.contact_id, org_id, db)
    validate_picklist_value(db, org_id, "visit.type", payload.visit_type)
    v = models.VisitHistory(
        organization_id=org_id,
        contact_id=payload.contact_id,
        visit_date=payload.visit_date,
        visit_type=payload.visit_type,
        location=payload.location,
        notes=payload.notes,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return _out(v)


@all_router.put("/{visit_id}", response_model=VisitOut)
def update_any_visit(
    visit_id: int,
    payload: VisitUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    org_id = admin.organization_id
    v = _visit_or_404(visit_id, org_id, db)
    data = payload.model_dump(exclude_unset=True)
    if "contact_id" in data:
        _validate_contact(data["contact_id"], org_id, db)
    if "visit_type" in data:
        validate_picklist_value(db, org_id, "visit.type", data["visit_type"])
    for field, value in data.items():
        setattr(v, field, value)
    db.commit()
    db.refresh(v)
    return _out(v)


@all_router.delete("/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_any_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    v = _visit_or_404(visit_id, admin.organization_id, db)
    db.delete(v)
    db.commit()
