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
from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status

from app.config import settings

router = APIRouter(prefix="/api/uploads", tags=["uploads"])
logger = logging.getLogger("app.uploads")

MAX_LOGO_BYTES = 5 * 1024 * 1024  # 5 MB

# content-type → file extension for locally saved logos (allowlist: anything
# else is rejected before saving).
_IMAGE_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
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
