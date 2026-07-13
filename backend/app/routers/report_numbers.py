"""Report-number CRUD (מספר דוח, fixes19), org-scoped.

Reads: any authenticated user (the apartment forms' searchable dropdown needs
the list, and apartment editing is open beyond admins). Mutations: admins only.
Deleting a report number detaches it from apartments (FK nulled); shliach
links cascade with the bridge rows.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import ReportNumberCreate, ReportNumberOut, ReportNumberUpdate

router = APIRouter(prefix="/api/report-numbers", tags=["report-numbers"])


def _get_or_404(report_number_id: int, org_id: int, db: Session) -> models.ReportNumber:
    rn = (
        db.query(models.ReportNumber)
        .filter(
            models.ReportNumber.id == report_number_id,
            models.ReportNumber.organization_id == org_id,
        )
        .first()
    )
    if not rn:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report number not found")
    return rn


@router.get("", response_model=list[ReportNumberOut])
def list_report_numbers(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return (
        db.query(models.ReportNumber)
        .filter(models.ReportNumber.organization_id == current_user.organization_id)
        .order_by(models.ReportNumber.name)
        .all()
    )


@router.post("", response_model=ReportNumberOut, status_code=status.HTTP_201_CREATED)
def create_report_number(
    payload: ReportNumberCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    rn = models.ReportNumber(
        **payload.model_dump(), organization_id=admin.organization_id
    )
    db.add(rn)
    db.commit()
    db.refresh(rn)
    return rn


@router.get("/{report_number_id}", response_model=ReportNumberOut)
def get_report_number(
    report_number_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return _get_or_404(report_number_id, current_user.organization_id, db)


@router.put("/{report_number_id}", response_model=ReportNumberOut)
def update_report_number(
    report_number_id: int,
    payload: ReportNumberUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    rn = _get_or_404(report_number_id, admin.organization_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rn, field, value)
    db.commit()
    db.refresh(rn)
    return rn


@router.delete("/{report_number_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report_number(
    report_number_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    rn = _get_or_404(report_number_id, admin.organization_id, db)
    # Detach referencing apartments instead of blocking the delete; shliach
    # bridge rows are removed by the relationship cascade.
    db.query(models.Apartment).filter(
        models.Apartment.report_number_id == rn.id
    ).update({models.Apartment.report_number_id: None}, synchronize_session=False)
    db.delete(rn)
    db.commit()
