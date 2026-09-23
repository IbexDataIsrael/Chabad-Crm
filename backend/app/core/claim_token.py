"""fixes65 §4: signed task claim tokens for the QR printed on orphan task sheets.

A token is `<task.guid>.<signature>`: the guid is the task's existing random
uuid4 (non-sequential, unguessable), the signature an HMAC-SHA256 over it
keyed with SECRET_KEY, so a token can't be forged or derived from a task id.
Nothing is stored — the same task always yields the same token, which is what
lets an old printout keep working after an admin unassigns the task. A
deleted task's guid no longer resolves, so its printouts die with it.
"""
import base64
import hashlib
import hmac
from typing import Optional

from app.config import settings

_SIG_BYTES = 16  # 128-bit truncated HMAC — ample against forgery


def _signature(guid: str) -> str:
    mac = hmac.new(
        settings.secret_key.encode("utf-8"),
        f"task-claim:{guid}".encode("utf-8"),
        hashlib.sha256,
    ).digest()[:_SIG_BYTES]
    return base64.urlsafe_b64encode(mac).rstrip(b"=").decode("ascii")


def make_claim_token(task_guid: str) -> str:
    return f"{task_guid}.{_signature(task_guid)}"


def parse_claim_token(token: str) -> Optional[str]:
    """The task guid a well-formed, correctly-signed token carries, else None."""
    if not token or token.count(".") != 1:
        return None
    guid, sig = token.split(".", 1)
    if not guid or len(guid) > 36 or not sig:
        return None
    if not hmac.compare_digest(sig, _signature(guid)):
        return None
    return guid

