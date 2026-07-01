"""Cloudinary signed upload support.

The browser never sees the API secret. It asks this endpoint for a short-lived
signature, then POSTs the file directly to Cloudinary with that signature. Only
requests signed here (matching our cloud/key/folder) are accepted by Cloudinary,
so the credentials can't be abused to upload arbitrary, unscoped assets.

Public on purpose: the org logo is chosen during signup, before the user has an
account/JWT. Signing only authorizes an image upload into a fixed folder.
"""
import hashlib
import time

from fastapi import APIRouter, HTTPException, status

from app.config import settings

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


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
