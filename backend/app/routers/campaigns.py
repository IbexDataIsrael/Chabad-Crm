"""Campaign CRUD (fixes58 §3.1), org-scoped. Admin + Campaign Manager only —
the whole entity is off-limits to everyone else (staff/shliach), unlike
Report Numbers which are readable by any authenticated user. Soft-deleted
(`deleted_at`) rather than hard-deleted so a Task's `campaign_id` FK never
dangles; a soft-deleted campaign is also forced inactive so it stops
granting apartment access immediately.
"""
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import apartment_fields, models
from app.database import get_db
from app.deps import get_current_user, require_admin_or_campaign_manager
from app.schemas import (
    CampaignActiveOut,
    CampaignActiveStat,
    CampaignCreate,
    CampaignFieldVisibilityOut,
    CampaignFieldVisibilityUpdate,
    CampaignOut,
    CampaignUpdate,
)

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


def _deactivate_other_campaigns(db: Session, org_id: int, keep_id: int | None) -> None:
    """fixes71 §B: "one campaign is active at a time" — flip every other
    non-deleted org campaign to inactive whenever one is turned on."""
    query = db.query(models.Campaign).filter(
        models.Campaign.organization_id == org_id,
        models.Campaign.deleted_at.is_(None),
    )
    if keep_id is not None:
        query = query.filter(models.Campaign.id != keep_id)
    query.update({models.Campaign.is_active: False}, synchronize_session=False)


def _get_or_404(campaign_id: int, org_id: int, db: Session) -> models.Campaign:
    c = (
        db.query(models.Campaign)
        .filter(
            models.Campaign.id == campaign_id,
            models.Campaign.organization_id == org_id,
            models.Campaign.deleted_at.is_(None),
        )
        .first()
    )
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    return c


@router.get("", response_model=list[CampaignOut])
def list_campaigns(
    active: bool | None = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    query = db.query(models.Campaign).filter(
        models.Campaign.organization_id == current_user.organization_id,
        models.Campaign.deleted_at.is_(None),
    )
    if active is not None:
        query = query.filter(models.Campaign.is_active.is_(active))
    return query.order_by(models.Campaign.name).all()


@router.get("/active-stats", response_model=list[CampaignActiveStat])
def campaign_active_stats(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes58 §3.2/Phase 6: the activist homepage's dynamic stat tiles — one
    per active campaign, `count` = distinct report numbers currently linked
    to an ACTIVE task under that campaign."""
    campaigns = (
        db.query(models.Campaign)
        .filter(
            models.Campaign.organization_id == current_user.organization_id,
            models.Campaign.is_active.is_(True),
            models.Campaign.deleted_at.is_(None),
        )
        .order_by(models.Campaign.name)
        .all()
    )
    if not campaigns:
        return []
    task_filter = [
        models.Task.campaign_id.in_([c.id for c in campaigns]),
        models.Task.status == "ACTIVE",
    ]
    if current_user.role == "shliach":
        task_filter.append(models.Task.volunteer_user_id == current_user.id)

    rows = (
        db.query(
            models.Task.campaign_id,
            models.ReportNumber.name,
        )
        .join(models.TaskReportNumber, models.TaskReportNumber.task_id == models.Task.id)
        .join(models.ReportNumber, models.ReportNumber.id == models.TaskReportNumber.report_number_id)
        .filter(*task_filter)
        .distinct()
        .order_by(models.ReportNumber.name)
        .all()
    )
    report_numbers: dict[int, list[str]] = {c.id: [] for c in campaigns}
    for campaign_id, report_number_name in rows:
        report_numbers[campaign_id].append(report_number_name)

    return [
        CampaignActiveStat(
            id=c.id,
            name=c.name,
            custom_stats_text=(
                "מספרי דוח: " + ", ".join(report_numbers[c.id])
                if current_user.role == "shliach"
                else c.custom_stats_text
            ),
            count=len(report_numbers[c.id]),
        )
        for c in campaigns
        if current_user.role != "shliach" or report_numbers[c.id]
    ]


@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
def create_campaign(
    payload: CampaignCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    campaign = models.Campaign(
        **payload.model_dump(), organization_id=current_user.organization_id
    )
    db.add(campaign)
    db.flush()
    if payload.is_active:
        _deactivate_other_campaigns(db, current_user.organization_id, campaign.id)
    db.commit()
    db.refresh(campaign)
    return campaign


@router.get("/active", response_model=Optional[CampaignActiveOut])
def get_active_campaign(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes71 §B/§C: the org's one active campaign (or None), plus which
    apartment fields it hides — what street2 shows an activist. Open to any
    authenticated user (activists included), unlike the rest of this router.
    Declared before /{campaign_id} so "active" is never coerced into that
    int path param (same reason /active-stats already precedes it)."""
    campaign = (
        db.query(models.Campaign)
        .filter(
            models.Campaign.organization_id == current_user.organization_id,
            models.Campaign.is_active.is_(True),
            models.Campaign.deleted_at.is_(None),
        )
        .order_by(models.Campaign.id)
        .first()
    )
    if campaign is None:
        return None
    hidden = {
        row.field_key
        for row in db.query(models.CampaignFieldVisibility).filter(
            models.CampaignFieldVisibility.campaign_id == campaign.id,
            models.CampaignFieldVisibility.is_visible.is_(False),
        )
    }
    return CampaignActiveOut(
        id=campaign.id, name=campaign.name, hidden_field_keys=sorted(hidden)
    )


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    return _get_or_404(campaign_id, current_user.organization_id, db)


@router.put("/{campaign_id}", response_model=CampaignOut)
def update_campaign(
    campaign_id: int,
    payload: CampaignUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    campaign = _get_or_404(campaign_id, current_user.organization_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(campaign, field, value)
    if payload.is_active:
        _deactivate_other_campaigns(db, current_user.organization_id, campaign.id)
    db.commit()
    db.refresh(campaign)
    return campaign


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    campaign = _get_or_404(campaign_id, current_user.organization_id, db)
    campaign.deleted_at = datetime.datetime.utcnow()
    campaign.is_active = False
    db.commit()


@router.get("/{campaign_id}/field-visibility", response_model=list[CampaignFieldVisibilityOut])
def list_campaign_field_visibility(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    """fixes71 §B.5/§B.6: the full apartment field catalog with this
    campaign's visibility for each — mirrors field_settings.py's
    list_field_settings shape, apartment-only, campaign-keyed."""
    campaign = _get_or_404(campaign_id, current_user.organization_id, db)
    saved = {
        row.field_key: row.is_visible
        for row in db.query(models.CampaignFieldVisibility).filter(
            models.CampaignFieldVisibility.campaign_id == campaign.id
        )
    }
    return [
        CampaignFieldVisibilityOut(
            field_key=f.field_key,
            label_key=f.label_key,
            entity=f.entity,
            is_visible=saved.get(f.field_key, True),
            label=f.label,
            english_label=f.english_label,
        )
        for f in apartment_fields.list_apartment_field_keys(db, current_user.organization_id)
    ]


@router.put("/{campaign_id}/field-visibility", response_model=CampaignFieldVisibilityOut)
def set_campaign_field_visibility(
    campaign_id: int,
    payload: CampaignFieldVisibilityUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    """Show/hide a single apartment field for this campaign (autosave,
    mirrors field_settings.py's set_field_setting). Upserts the campaign's row."""
    campaign = _get_or_404(campaign_id, current_user.organization_id, db)
    catalog = {
        f.field_key: f
        for f in apartment_fields.list_apartment_field_keys(db, current_user.organization_id)
    }
    meta = catalog.get(payload.field_key)
    if meta is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"unknown field_key '{payload.field_key}'"
        )
    row = (
        db.query(models.CampaignFieldVisibility)
        .filter(
            models.CampaignFieldVisibility.campaign_id == campaign.id,
            models.CampaignFieldVisibility.field_key == payload.field_key,
        )
        .first()
    )
    if row is None:
        row = models.CampaignFieldVisibility(
            campaign_id=campaign.id,
            field_key=payload.field_key,
            is_visible=payload.is_visible,
        )
        db.add(row)
    else:
        row.is_visible = payload.is_visible
    db.commit()
    return CampaignFieldVisibilityOut(
        field_key=meta.field_key,
        label_key=meta.label_key,
        entity=meta.entity,
        is_visible=payload.is_visible,
        label=meta.label,
        english_label=meta.english_label,
    )
