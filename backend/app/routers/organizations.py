"""Organization (tenant) settings — read for any member, edit for admins."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.core import cloudinary_assets
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import OrganizationOut, OrganizationUpdate
from app.core.errors import api_error

router = APIRouter(prefix="/api/organizations", tags=["organizations"])

MAX_GALLERY_IMAGES = 24


@router.get("/me", response_model=OrganizationOut)
def get_my_org(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org = db.get(models.Organization, current_user.organization_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return org


@router.get("/slug-available")
def slug_available(
    slug: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict:
    """fixes65 §1: live check for the Settings page — is this public-page
    address free (not used by any *other* org)? The PUT below enforces the
    same rule, and the DB's unique index backs both against races."""
    cleaned = (slug or "").strip().lower()
    taken = (
        db.query(models.Organization.id)
        .filter(
            models.Organization.slug == cleaned,
            models.Organization.id != admin.organization_id,
        )
        .first()
        is not None
    )
    return {"slug": cleaned, "available": bool(cleaned) and not taken}


@router.put("/me", response_model=OrganizationOut)
def update_my_org(
    payload: OrganizationUpdate,
    background: BackgroundTasks,
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
    # fixes99: images this edit removes (logo / gallery / footer) are deleted
    # from Cloudinary after it's saved.
    images_before = cloudinary_assets.images_before_change(db, org.id)
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
        # fixes65 §1: the public landing page's subtitle.
        "public_subtitle",
        # fixes85: English title + subtitle.
        "public_subtitle_en",
        "public_footer_html",
    ):
        if field in data:
            setattr(org, field, data[field])
    # fixes65 §1: public landing page slug (unique across all orgs) + gallery
    # + the self-registration switch.
    if "name_en" in data:
        org.name_en = (data["name_en"] or "").strip() or None
    if "slug" in data:
        slug = data["slug"]
        if slug:
            taken = (
                db.query(models.Organization.id)
                .filter(models.Organization.slug == slug, models.Organization.id != org.id)
                .first()
            )
            if taken:
                raise HTTPException(status.HTTP_409_CONFLICT, "This page address is already taken")
        org.slug = slug
    if "public_gallery" in data:
        gallery = [
            u.strip()
            for u in (data["public_gallery"] or [])
            if isinstance(u, str) and u.strip().startswith(("https://", "http://"))
        ]
        if len(gallery) > MAX_GALLERY_IMAGES:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "error.gallery_max",
                "A gallery holds at most {max} images", max=MAX_GALLERY_IMAGES,
            )
        org.public_gallery = gallery
    if data.get("self_registration_enabled") is not None:
        org.self_registration_enabled = data["self_registration_enabled"]
    db.commit()
    db.refresh(org)
    removed = cloudinary_assets.removed_image_ids(db, org.id, images_before)
    if removed:
        background.add_task(cloudinary_assets.delete_images, removed)
    return org
