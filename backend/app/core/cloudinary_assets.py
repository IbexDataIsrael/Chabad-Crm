"""fixes91: remove an organization's images from Cloudinary when the
organization is deleted.

Safety rules (the Cloudinary account is shared by every environment — local
data is a copy of prod and points at the very same image URLs, and a clone
reuses its source org's logo):

- Only runs when `settings.cloudinary_delete_on_org_delete` is on (set it on
  the production backend only), so deleting an org locally never deletes a
  production image.
- Deletes by reference, never by folder: only image URLs the org itself uses
  (logo, public-page gallery, images inside its announcements) — folder ids
  like `orgs/<id>/` mean different orgs in different environments.
- Skips any image another organization in this database still uses (e.g. a
  clone sharing its source's logo).
- Only our own cloud's `image/upload` URLs are touched.
"""
import json
import logging
import re
from typing import Iterable, Optional

import requests
from sqlalchemy.orm import Session

from app import models
from app.config import settings

logger = logging.getLogger("app.cloudinary_assets")

_IMG_SRC_RE = re.compile(r"""<img[^>]+src=["']([^"']+)["']""", re.IGNORECASE)


def public_id_from_url(url: str) -> Optional[str]:
    """`https://res.cloudinary.com/<cloud>/image/upload/[transforms/][v123/]<public_id>.<ext>`
    → `<public_id>`; None for anything that isn't an upload on our cloud."""
    prefix = f"https://res.cloudinary.com/{settings.cloudinary_cloud_name}/image/upload/"
    if not settings.cloudinary_cloud_name or not url or not url.startswith(prefix):
        return None
    parts = url[len(prefix):].split("?")[0].split("/")
    # Our uploads' secure_url always carries a version segment (v123...); the
    # public id is everything after it (any transformations come before it).
    versions = [i for i, seg in enumerate(parts) if re.fullmatch(r"v\d+", seg)]
    if versions:
        parts = parts[versions[0] + 1:]
    path = "/".join(parts)
    return re.sub(r"\.[A-Za-z0-9]+$", "", path) or None


def _org_urls(org: models.Organization, announcements: Iterable[str]) -> set[str]:
    urls: set[str] = set()
    if org.logo_url:
        urls.add(org.logo_url)
    gallery = org.public_gallery
    if isinstance(gallery, str):
        try:
            gallery = json.loads(gallery)
        except ValueError:
            gallery = []
    for u in gallery or []:
        if isinstance(u, str):
            urls.add(u)
    for html in announcements:
        urls.update(_IMG_SRC_RE.findall(html or ""))
    return urls


def org_image_urls(db: Session, org_id: int) -> set[str]:
    """Every image URL this org uses (call BEFORE deleting the org's rows)."""
    org = db.get(models.Organization, org_id)
    if org is None:
        return set()
    contents = [
        c for (c,) in db.query(models.ShliachAnnouncement.message_content).filter(
            models.ShliachAnnouncement.organization_id == org_id
        )
    ]
    return _org_urls(org, contents)


def urls_used_by_other_orgs(db: Session, org_id: int, urls: set[str]) -> set[str]:
    """The subset of `urls` still referenced by any other organization."""
    if not urls:
        return set()
    used: set[str] = set()
    others = db.query(models.Organization).filter(models.Organization.id != org_id).all()
    contents_by_org: dict[int, list[str]] = {}
    for oid, content in db.query(
        models.ShliachAnnouncement.organization_id, models.ShliachAnnouncement.message_content
    ).filter(models.ShliachAnnouncement.organization_id != org_id):
        contents_by_org.setdefault(oid, []).append(content)
    for other in others:
        used |= urls & _org_urls(other, contents_by_org.get(other.id, []))
    return used


def plan_org_image_cleanup(db: Session, org_id: int) -> list[str]:
    """Cloudinary public ids safe to delete with this org (call before the
    org's rows are deleted). Empty when the feature is off."""
    if not (settings.cloudinary_delete_on_org_delete and settings.cloudinary_configured):
        return []
    urls = org_image_urls(db, org_id)
    urls -= urls_used_by_other_orgs(db, org_id, urls)
    ids = {pid for pid in (public_id_from_url(u) for u in urls) if pid}
    return sorted(ids)


def delete_images(public_ids: list[str]) -> list[str]:
    """Delete these images from Cloudinary (Admin API, ≤100 per call).
    Never raises — a failure is logged and the org deletion still stands.
    Returns the ids Cloudinary reported as deleted."""
    if not public_ids or not settings.cloudinary_configured:
        return []
    deleted: list[str] = []
    url = (
        f"https://api.cloudinary.com/v1_1/{settings.cloudinary_cloud_name}"
        "/resources/image/upload"
    )
    for i in range(0, len(public_ids), 100):
        batch = public_ids[i:i + 100]
        try:
            resp = requests.delete(
                url,
                params=[("public_ids[]", pid) for pid in batch],
                auth=(settings.cloudinary_api_key, settings.cloudinary_api_secret),
                timeout=30,
            )
        except requests.RequestException:
            logger.exception("Cloudinary delete failed (network) for %d images", len(batch))
            continue
        if not resp.ok:
            logger.warning("Cloudinary delete failed (%s): %s", resp.status_code, resp.text[:300])
            continue
        result = (resp.json() or {}).get("deleted", {})
        deleted += [pid for pid, state in result.items() if state == "deleted"]
    logger.info("Cloudinary: deleted %d of %d org images", len(deleted), len(public_ids))
    return deleted
