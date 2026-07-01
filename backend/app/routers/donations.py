"""Donation history (היסטורית תרומות) — admin-only, org-scoped.

Donations may be linked to a contact or stand alone (contact_id nullable).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import require_admin
from app.schemas import DonationCreate, DonationOut, DonationUpdate

router = APIRouter(prefix="/api/donations", tags=["donations"])


def _out(d: models.Donation) -> DonationOut:
    contact = d.contact
    name = None
    if contact:
        name = f"{contact.name} {contact.last_name or ''}".strip()
    return DonationOut(
        id=d.id,
        guid=d.guid,
        contact_id=d.contact_id,
        contact_name=name,
        donation_date=d.donation_date,
        amount=d.amount,
        is_ongoing=d.is_ongoing,
        number_of_payments=d.number_of_payments,
        notes=d.notes,
    )


def _validate_contact(contact_id: Optional[int], org_id: int, db: Session) -> None:
    if contact_id is None:
        return
    ok = (
        db.query(models.Contact)
        .filter(
            models.Contact.id == contact_id,
            models.Contact.organization_id == org_id,
        )
        .first()
    )
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "contact_id does not exist")


def _get_or_404(donation_id: int, org_id: int, db: Session) -> models.Donation:
    d = (
        db.query(models.Donation)
        .filter(
            models.Donation.id == donation_id,
            models.Donation.organization_id == org_id,
        )
        .first()
    )
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Donation not found")
    return d


@router.get("", response_model=list[DonationOut])
def list_donations(
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
    contact_id: Optional[int] = None,
):
    query = db.query(models.Donation).filter(
        models.Donation.organization_id == admin.organization_id
    )
    if contact_id is not None:
        query = query.filter(models.Donation.contact_id == contact_id)
    rows = query.order_by(models.Donation.donation_date.desc()).all()
    return [_out(d) for d in rows]


@router.post("", response_model=DonationOut, status_code=status.HTTP_201_CREATED)
def create_donation(
    payload: DonationCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    org_id = admin.organization_id
    _validate_contact(payload.contact_id, org_id, db)
    d = models.Donation(**payload.model_dump(), organization_id=org_id)
    db.add(d)
    db.commit()
    db.refresh(d)
    return _out(d)


@router.put("/{donation_id}", response_model=DonationOut)
def update_donation(
    donation_id: int,
    payload: DonationUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    d = _get_or_404(donation_id, admin.organization_id, db)
    data = payload.model_dump(exclude_unset=True)
    if "contact_id" in data:
        _validate_contact(data["contact_id"], admin.organization_id, db)
    for field, value in data.items():
        setattr(d, field, value)
    db.commit()
    db.refresh(d)
    return _out(d)


@router.delete("/{donation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_donation(
    donation_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    d = _get_or_404(donation_id, admin.organization_id, db)
    db.delete(d)
    db.commit()
