"""Cloudinary signed upload support (+ local-disk fallback, fixes25 §6).

The browser never sees the API secret. It asks this endpoint for a short-lived
signature, then POSTs the file directly to Cloudinary with that signature. Only
requests signed here (matching our cloud/key/folder) are accepted by Cloudinary,
so the credentials can't be abused to upload arbitrary, unscoped assets.

Public on purpose: the org logo is chosen during signup, before the user has an
account/JWT. Signing only authorizes an image upload into a fixed folder.

fixes25 §6: when Cloudinary is unconfigured, times out or errors, the logo is
saved to the backend's static uploads directory instead (`settings.upload_dir`,
served at /uploads/*) and the absolute local URL is returned — so branding
keeps working without external storage.
"""
import hashlib
import logging
import os
import time
import uuid

import requests
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from app import models
from app.config import settings
from app.deps import require_admin

router = APIRouter(prefix="/api/uploads", tags=["uploads"])
logger = logging.getLogger("app.uploads")

MAX_LOGO_BYTES = 5 * 1024 * 1024  # 5 MB

# content-type → file extension for locally saved logos (allowlist: anything
# else is rejected before saving).
#
# Security hardening: SVG deliberately excluded. Both /logo and
# /announcement-image are reachable by an unauthenticated or low-privilege
# caller and the result is served back from this API's own origin — an SVG
# can carry a <script> that executes when a browser is navigated to (or
# embeds) that URL directly, giving a stored-XSS/open-hosting vector on our
# domain. Sanitizing SVG safely needs a real parser; simplest is to not
# accept the format at all (PNG/JPEG/GIF/WEBP cover logos and announcement
# images fine).
_IMAGE_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}


def _save_logo_locally(data: bytes, content_type: str, request: Request) -> str:
    """Write the image under <upload_dir>/logos and return its absolute URL
    (request.base_url + the static /uploads mount path)."""
    ext = _IMAGE_EXTENSIONS.get(content_type, "png")
    folder = os.path.join(settings.upload_dir, "logos")
    os.makedirs(folder, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(folder, filename), "wb") as f:
        f.write(data)
    return f"{str(request.base_url).rstrip('/')}/uploads/logos/{filename}"


def _sign(params: dict[str, str], secret: str) -> str:
    """Cloudinary signature: SHA-1 of the sorted `k=v&...` params + the secret."""
    to_sign = "&".join(f"{k}={params[k]}" for k in sorted(params))
    return hashlib.sha1(f"{to_sign}{secret}".encode("utf-8")).hexdigest()


@router.get("/cloudinary-signature")
def cloudinary_signature() -> dict:
    """Return the params the browser needs for a signed Cloudinary upload.

    The client must echo `timestamp` and `folder` back to Cloudinary verbatim,
    along with `api_key` and `signature`, or the signature won't validate.
    """
    if not settings.cloudinary_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloudinary is not configured",
        )

    timestamp = int(time.time())
    signed_params = {
        "folder": settings.cloudinary_upload_folder,
        "timestamp": str(timestamp),
    }
    signature = _sign(signed_params, settings.cloudinary_api_secret)

    return {
        "cloud_name": settings.cloudinary_cloud_name,
        "api_key": settings.cloudinary_api_key,
        "timestamp": timestamp,
        "folder": settings.cloudinary_upload_folder,
        "signature": signature,
    }


@router.post("/logo")
async def upload_logo(request: Request, file: UploadFile = File(...)) -> dict:
    """Receive an image file and return a URL for it. Cloudinary first (when
    configured), the backend's local static uploads directory as the fallback
    (fixes25 §6 — broken/missing Cloudinary must not block branding).

    Public on purpose: the org logo is chosen during signup, before there's a JWT.
    """
    content_type = file.content_type or ""
    if content_type not in _IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File must be an image"
        )
    data = await file.read()
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image too large (max 5MB)",
        )

    if not settings.cloudinary_configured:
        return {"url": _save_logo_locally(data, content_type, request)}

    timestamp = int(time.time())
    signed_params = {
        "folder": settings.cloudinary_upload_folder,
        "timestamp": str(timestamp),
    }
    signature = _sign(signed_params, settings.cloudinary_api_secret)
    try:
        resp = requests.post(
            f"https://api.cloudinary.com/v1_1/{settings.cloudinary_cloud_name}/image/upload",
            data={
                "api_key": settings.cloudinary_api_key,
                "timestamp": timestamp,
                "folder": settings.cloudinary_upload_folder,
                "signature": signature,
            },
            files={"file": (file.filename or "logo", data, file.content_type)},
            timeout=30,
        )
    except requests.RequestException:
        logger.warning("Cloudinary unreachable — falling back to local logo storage")
        return {"url": _save_logo_locally(data, content_type, request)}

    if not resp.ok:
        logger.warning(
            "Cloudinary upload failed (%s) — falling back to local logo storage",
            resp.status_code,
        )
        return {"url": _save_logo_locally(data, content_type, request)}
    return {"url": resp.json()["secure_url"]}


# fixes56 §2: image picker for the announcement WYSIWYG editor
# (/dashboard/shliach-config). Unlike the logo endpoints above (public,
# single shared folder — the org isn't known yet at signup time), these are
# admin-only and strictly scoped to the caller's own organization: each org
# gets its own Cloudinary folder / local subfolder, so one org can never
# list or upload into another org's image gallery.
def _announcement_folder(org_id: int, kind: str = "announcements") -> str:
    return f"orgs/{org_id}/{kind}"


def _save_announcement_image_locally(
    data: bytes, content_type: str, request: Request, org_id: int,
    kind: str = "announcements",
) -> str:
    ext = _IMAGE_EXTENSIONS.get(content_type, "png")
    folder = os.path.join(settings.upload_dir, kind, str(org_id))
    os.makedirs(folder, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(folder, filename), "wb") as f:
        f.write(data)
    return f"{str(request.base_url).rstrip('/')}/uploads/{kind}/{org_id}/{filename}"


def _list_announcement_images_locally(request: Request, org_id: int) -> list[dict]:
    folder = os.path.join(settings.upload_dir, "announcements", str(org_id))
    if not os.path.isdir(folder):
        return []
    entries = [
        (name, os.path.getmtime(os.path.join(folder, name)))
        for name in os.listdir(folder)
        if os.path.isfile(os.path.join(folder, name))
    ]
    entries.sort(key=lambda e: e[1], reverse=True)
    base = str(request.base_url).rstrip("/")
    return [
        {"url": f"{base}/uploads/announcements/{org_id}/{name}", "public_id": name}
        for name, _mtime in entries
    ]


@router.get("/announcement-images")
def list_announcement_images(
    request: Request, admin: models.User = Depends(require_admin)
) -> dict:
    """Gallery of previously-uploaded announcement images, scoped to the
    caller's own org (via `require_admin` — never trusts a client-supplied
    org id)."""
    org_id = admin.organization_id
    if not settings.cloudinary_configured:
        return {"images": _list_announcement_images_locally(request, org_id)}

    try:
        resp = requests.get(
            f"https://api.cloudinary.com/v1_1/{settings.cloudinary_cloud_name}"
            "/resources/image/upload",
            params={
                "prefix": f"{_announcement_folder(org_id)}/",
                "type": "upload",
                "max_results": 100,
            },
            auth=(settings.cloudinary_api_key, settings.cloudinary_api_secret),
            timeout=15,
        )
    except requests.RequestException:
        logger.warning("Cloudinary unreachable — falling back to local announcement images")
        return {"images": _list_announcement_images_locally(request, org_id)}

    if not resp.ok:
        logger.warning("Cloudinary list failed (%s)", resp.status_code)
        return {"images": _list_announcement_images_locally(request, org_id)}

    resources = resp.json().get("resources", [])
    return {
        "images": [
            {
                "url": r["secure_url"],
                "public_id": r["public_id"],
                "created_at": r.get("created_at"),
            }
            for r in resources
        ]
    }


@router.post("/announcement-image")
async def upload_announcement_image(
    request: Request,
    file: UploadFile = File(...),
    admin: models.User = Depends(require_admin),
) -> dict:
    """Upload one image into the caller's own org folder. Admin-only (unlike
    /logo, this always has an authenticated org to scope to)."""
    return await _upload_org_image(request, file, admin.organization_id, "announcements")


@router.post("/gallery-image")
async def upload_gallery_image(
    request: Request,
    file: UploadFile = File(...),
    admin: models.User = Depends(require_admin),
) -> dict:
    """fixes65 §1: one photo for the org's public landing-page gallery —
    same admin-only, org-scoped storage as announcement images, own folder."""
    return await _upload_org_image(request, file, admin.organization_id, "gallery")


async def _upload_org_image(
    request: Request, file: UploadFile, org_id: int, kind: str
) -> dict:
    content_type = file.content_type or ""
    if content_type not in _IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File must be an image"
        )
    data = await file.read()
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image too large (max 5MB)",
        )

    if not settings.cloudinary_configured:
        return {
            "url": _save_announcement_image_locally(data, content_type, request, org_id, kind)
        }

    folder = _announcement_folder(org_id, kind)
    timestamp = int(time.time())
    signed_params = {"folder": folder, "timestamp": str(timestamp)}
    signature = _sign(signed_params, settings.cloudinary_api_secret)
    try:
        resp = requests.post(
            f"https://api.cloudinary.com/v1_1/{settings.cloudinary_cloud_name}/image/upload",
            data={
                "api_key": settings.cloudinary_api_key,
                "timestamp": timestamp,
                "folder": folder,
                "signature": signature,
            },
            files={"file": (file.filename or "image", data, file.content_type)},
            timeout=30,
        )
    except requests.RequestException:
        logger.warning(
            "Cloudinary unreachable — falling back to local announcement-image storage"
        )
        return {
            "url": _save_announcement_image_locally(data, content_type, request, org_id, kind)
        }

    if not resp.ok:
        logger.warning(
            "Cloudinary upload failed (%s) — falling back to local announcement-image storage",
            resp.status_code,
        )
        return {
            "url": _save_announcement_image_locally(data, content_type, request, org_id, kind)
        }
    return {"url": resp.json()["secure_url"]}
