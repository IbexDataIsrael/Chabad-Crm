"""fixes117/fixes118: the chat helper's proof of write (`request_id`).

Shared by the contact update and the new-visit endpoints
(routers/assistant_contacts.py); the apartment update keeps its own copy of
the same rules (routers/assistant_apartments.py). The record is added in the
SAME transaction as the write, so it exists only if the write committed. The
same request_id again from the same user (same organization) with the same
request replays the stored outcome; with a different request it is a 422
`request_id_reused`. Another user's request_id is never matched.
"""
import hashlib
import json
from typing import Any, Optional

from sqlalchemy.orm import Session

from app import models


def request_hash(action: str, *parts: Any) -> str:
    raw = json.dumps([action, *parts], sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def find(db: Session, user: models.User, request_id: str) -> Optional[models.AssistantRequest]:
    return (
        db.query(models.AssistantRequest)
        .filter(
            models.AssistantRequest.user_id == user.id,
            models.AssistantRequest.organization_id == user.organization_id,
            models.AssistantRequest.request_id == request_id,
        )
        .first()
    )


def record(
    db: Session,
    user: models.User,
    request_id: str,
    action: str,
    hashed: str,
    outcome: str,
    target_id: int,
    result_id: int,
) -> None:
    db.add(models.AssistantRequest(
        organization_id=user.organization_id, user_id=user.id, request_id=request_id,
        action=action, request_hash=hashed, outcome=outcome,
        target_id=target_id, result_id=result_id,
    ))
