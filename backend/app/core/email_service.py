"""Client for the shared email-service microservice (fixes103).

One call: POST {EMAIL_SERVICE_URL}/send with the X-Internal-Token header. A 200
means the service queued the email and owns delivering it (it retries on its
own), so there is no retry logic here. Anything else — an exception, a timeout,
a non-200 — raises EmailServiceError so the caller can fall back to Gmail.
"""
import logging
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger("app.email_service")

TIMEOUT_SECONDS = 5
PROJECT = "minicrm"


class EmailServiceError(Exception):
    """The service did not accept the email."""


def send(
    to: str,
    subject: str,
    html: Optional[str] = None,
    text: Optional[str] = None,
    from_address: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> str:
    """Queue one email (one recipient) and return the service's id."""
    payload = {"to": to, "subject": subject, "project": PROJECT}
    if html:
        payload["html"] = html
    if text:
        payload["text"] = text
    if from_address:
        payload["from_address"] = from_address
    if reply_to:
        payload["reply_to"] = reply_to
    try:
        response = httpx.post(
            f"{settings.email_service_url}/send",
            json=payload,
            headers={"X-Internal-Token": settings.email_service_token},
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise EmailServiceError(f"{type(exc).__name__}: {exc}") from exc
    if response.status_code != 200:
        logger.error(
            "email-service returned %s for to=%s subject=%r: %s",
            response.status_code,
            to,
            subject,
            response.text[:300],
        )
        raise EmailServiceError(f"HTTP {response.status_code}: {response.text[:300]}")
    # A 200 is never a failure, even if the body is not the JSON we expect.
    try:
        email_id = str((response.json() or {}).get("id", ""))
    except ValueError:
        email_id = ""
    logger.info("email-service queued id=%s to=%s subject=%r", email_id, to, subject)
    return email_id
