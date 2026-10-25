"""Organization (tenant) settings — read for any member, edit for admins."""
import logging

import requests
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.core import cloudinary_assets
from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import OrganizationOut, OrganizationUpdate, PublicImageSearchRequest
from app.core.errors import api_error

router = APIRouter(prefix="/api/organizations", tags=["organizations"])
logger = logging.getLogger("app.organizations")

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


# fixes110: web image search for the public-page gallery. The admin's org is
# read only for context (404 guard) — the query itself is free text.
@router.post("/public-image-search")
def public_image_search(
    payload: PublicImageSearchRequest,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict:
    """Search the web for images (Google Programmable Search, searchType=image)
    that the admin can import into the org's public landing-page gallery via
    /api/uploads/gallery-image-url. 503 when the Google keys aren't configured."""
    org = db.get(models.Organization, admin.organization_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    query = payload.query.strip()
    if not query:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "error.image_search_query_required",
            "Image search query is required",
        )
    if not settings.google_search_api_key or not settings.google_search_cx:
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "error.image_search_not_configured",
            "Image search is not configured (GOOGLE_SEARCH_API_KEY/GOOGLE_SEARCH_CX missing)",
        )
    try:
        resp = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params={
                "key": settings.google_search_api_key,
                "cx": settings.google_search_cx,
                "q": query,
                "searchType": "image",
                "num": payload.count,
                "safe": "active",
            },
            timeout=15,
        )
    except requests.RequestException:
        logger.warning("Google image search unreachable")
        raise api_error(
            status.HTTP_502_BAD_GATEWAY,
            "error.image_search_upstream",
            "Image search service returned an error: {detail}",
            detail="unreachable",
        )
    if resp.status_code != 200:
        # Safe subset of the upstream error body: the message string only,
        # capped — never echo the raw payload back to the client.
        detail = ""
        try:
            message = resp.json().get("error", {}).get("message")
            if isinstance(message, str):
                detail = message[:200]
        except ValueError:
            pass
        raise api_error(
            status.HTTP_502_BAD_GATEWAY,
            "error.image_search_upstream",
            "Image search service returned an error: {detail}",
            detail=detail or f"HTTP {resp.status_code}",
        )
    try:
        data = resp.json()
    except ValueError:
        data = {}
    results = []
    for item in data.get("items") or []:
        if not isinstance(item, dict):
            continue
        image = item.get("image") or {}
        url = item.get("link")
        thumbnail = image.get("thumbnailLink")
        if not url or not thumbnail:
            continue
        results.append(
            {
                "url": url,
                "thumbnail": thumbnail,
                "width": image.get("width"),
                "height": image.get("height"),
                "title": item.get("title") or "",
            }
        )
    return {"results": results}
