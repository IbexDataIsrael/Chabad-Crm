"""Password hashing (bcrypt via passlib) and JWT creation/decoding (python-jose)."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)


def create_access_token(
    *, subject: str, role: str, expires_minutes: Optional[int] = None
) -> str:
    """Encode a JWT with the username (`sub`) and `role` claims."""
    minutes = expires_minutes or settings.access_token_expire_minutes
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    payload = {"sub": subject, "role": role, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> dict:
    """Decode and validate a JWT. Raises `jose.JWTError` on failure.
    fixes75: access tokens carry no `type` claim — an email-verification
    token (same key, same `sub`) must never work as a bearer token."""
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    if payload.get("type"):
        raise JWTError("not an access token")
    return payload


def verify_google_token(credential: str) -> dict:
    """Verify a Google Identity Services ID token; return its claims (email, sub).

    Raises ValueError if the token is invalid or not issued for our client id.
    """
    if not settings.google_client_id:
        raise ValueError("Google Sign-In is not configured")
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    info = google_id_token.verify_oauth2_token(
        credential, google_requests.Request(), settings.google_client_id
    )
    if not info.get("email"):
        raise ValueError("Google token has no email")
    return info


def create_email_token(user_id: int) -> str:
    """Signed, time-limited token embedded in the email-verification link."""
    expire = datetime.now(timezone.utc) + timedelta(
        hours=settings.verification_token_expire_hours
    )
    payload = {"sub": str(user_id), "type": "email_verify", "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_email_token(token: str) -> int:
    """Return the user id from a verification token. Raises `jose.JWTError` if the
    token is invalid, expired, or not an email-verification token."""
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    if payload.get("type") != "email_verify":
        raise JWTError("wrong token type")
    return int(payload["sub"])


# --- fixes75 §7: forgot-password reset links -----------------------------------
PASSWORD_RESET_EXPIRE_MINUTES = 60


def _password_fingerprint(password_hash: Optional[str]) -> str:
    """Changes whenever the password does — so a reset link works once."""
    import hashlib

    return hashlib.sha256((password_hash or "").encode()).hexdigest()[:16]


def create_password_reset_token(user_id: int, password_hash: Optional[str]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=PASSWORD_RESET_EXPIRE_MINUTES)
    payload = {
        "uid": user_id,  # deliberately not `sub`: never usable as an access token
        "type": "password_reset",
        "fp": _password_fingerprint(password_hash),
        "exp": expire,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_password_reset_token(token: str) -> tuple[int, str]:
    """(user id, password fingerprint). Raises `jose.JWTError` when invalid,
    expired or not a reset token."""
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    if payload.get("type") != "password_reset" or "uid" not in payload:
        raise JWTError("wrong token type")
    return int(payload["uid"]), str(payload.get("fp", ""))


def password_reset_token_matches(fingerprint: str, password_hash: Optional[str]) -> bool:
    return fingerprint == _password_fingerprint(password_hash)
