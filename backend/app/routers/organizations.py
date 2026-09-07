"""Organization (tenant) settings — read for any member, edit for admins."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user
from app.schemas import OrganizationOut, OrganizationUpdate

router = APIRouter(prefix="/api/organizations", tags=["organizations"])


@router.get("/me", response_model=OrganizationOut)
def get_my_org(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org = db.get(models.Organization, current_user.organization_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return org


@router.put("/me", response_model=OrganizationOut)
def update_my_org(
    payload: OrganizationUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # fixes58 §3.7/§Volunteer View Settings: Campaign Manager gets the
    # shliach-config page ("Volunteer View Settings") but not global System
    # Settings — so they may PUT here only when the payload touches nothing
    # but shliach_view_config. Everyone else needs the plain admin gate.
    data = payload.model_dump(exclude_unset=True)
    if current_user.role == "campaign_manager":
        if set(data.keys()) - {"shliach_view_config"}:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Admin privileges required for these fields"
            )
    elif current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")

    org = db.get(models.Organization, current_user.organization_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    if data.get("name"):
        org.name = data["name"]
    if "logo_url" in data:  # present-but-null clears the logo
        org.logo_url = data["logo_url"]
    if "map_in_english" in data and data["map_in_english"] is not None:
        org.map_in_english = data["map_in_english"]
    # fixes18 §6: the shliach contacts-visibility switch.
    if (
        "shliach_can_view_contacts" in data
        and data["shliach_can_view_contacts"] is not None
    ):
        org.shliach_can_view_contacts = data["shliach_can_view_contacts"]
    for field in (
        "default_lat",
        "default_lng",
        "default_zoom",
        "report_notes",
        # fixes40 §4: global field-label text styling (each independently
        # nullable — present-but-null clears just that one property).
        "label_font_size",
        "label_color",
        "label_font_family",
        # fixes51 §4: the Shliach Role Configuration Panel's settings blob.
        "shliach_view_config",
    ):
        if field in data:
            setattr(org, field, data[field])
    db.commit()
    db.refresh(org)
    return org
