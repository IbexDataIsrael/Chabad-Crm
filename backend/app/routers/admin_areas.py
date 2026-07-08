"""Admin-area CRUD (אזור מנהל, fixes9 §2), org-scoped.

Reads: admin or staff (shliach users are blocked from the whole section —
fixes10 §3.6). Mutations: admins only. Deleting an admin area detaches it from
any mekurav contacts that reference it (FK is nulled).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import require_admin, require_staff_or_admin
from app.schemas import AdminAreaCreate, AdminAreaOut, AdminAreaUpdate

router = APIRouter(prefix="/api/admin-areas", tags=["admin-areas"])


def _get_or_404(admin_area_id: int, org_id: int, db: Session) -> models.AdminArea:
    aa = (
        db.query(models.AdminArea)
        .filter(
            models.AdminArea.id == admin_area_id,
            models.AdminArea.organization_id == org_id,
        )
        .first()
    )
    if not aa:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Admin area not found")
    return aa


@router.get("", response_model=list[AdminAreaOut])
def list_admin_areas(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff_or_admin),
):
    return (
        db.query(models.AdminArea)
        .filter(models.AdminArea.organization_id == current_user.organization_id)
        .order_by(models.AdminArea.name)
        .all()
    )


@router.post("", response_model=AdminAreaOut, status_code=status.HTTP_201_CREATED)
def create_admin_area(
    payload: AdminAreaCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    aa = models.AdminArea(**payload.model_dump(), organization_id=admin.organization_id)
    db.add(aa)
    db.commit()
    db.refresh(aa)
    return aa


@router.get("/{admin_area_id}", response_model=AdminAreaOut)
def get_admin_area(
    admin_area_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff_or_admin),
):
    return _get_or_404(admin_area_id, current_user.organization_id, db)


@router.put("/{admin_area_id}", response_model=AdminAreaOut)
def update_admin_area(
    admin_area_id: int,
    payload: AdminAreaUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    aa = _get_or_404(admin_area_id, admin.organization_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(aa, field, value)
    db.commit()
    db.refresh(aa)
    return aa


@router.delete("/{admin_area_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_area(
    admin_area_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    aa = _get_or_404(admin_area_id, admin.organization_id, db)
    # Detach referencing mekurav contacts instead of blocking the delete.
    db.query(models.ContactMekurav).filter(
        models.ContactMekurav.admin_area_id == aa.id
    ).update({models.ContactMekurav.admin_area_id: None}, synchronize_session=False)
    db.delete(aa)
    db.commit()
