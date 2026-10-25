"""fixes113: assistant actions as confirm-before-write proposals
(`/api/assistant`). Independent of any chat UI — the caller sends fields that
are already structured; no LLM is involved here.

- `POST /proposals`                 — validate; answer `needs_information`
  (missing fields, nothing stored) or store a pending proposal bound to the
  JWT's user + organization and return its exact draft details. Never writes
  a contact.
- `POST /proposals/{id}/confirm`    — recheck permissions + validation and
  create the draft through the shared service (app/core/contact_drafts.py).
  Idempotent: the proposal is claimed (pending -> executed) by a conditional
  UPDATE in the same transaction that inserts the contact, so concurrent
  confirms and retries after a lost response create exactly one contact; a
  replay returns the original result.

User and organization come only from the JWT — the request schemas forbid
extra keys, so an `organization_id` in a body is a 422, never used. A
proposal of another user or organization is a 404 (its existence never
leaks).
"""
import datetime
import hashlib
import hmac
import json
from typing import Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app.core.contact_drafts import DRAFT_FIELD_MAX_LENGTH, create_draft_contact
from app.database import get_db
from app.deps import forbid_campaign_manager
from app.routers.contacts import _check_phone_unique
from app.routers.instinct.common import clean_email, clean_phone

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

# Storage: the assistant_proposals table. A pending proposal can be confirmed
# for this long; an executed one stays replayable with no time limit.
PROPOSAL_TTL = datetime.timedelta(minutes=15)

ACTION_CREATE_CONTACT_DRAFT = "create_contact_draft"
DRAFT_FIELDS = ("first_name", "last_name", "phone", "email", "address")
REQUIRED_FIELDS = ("first_name", "last_name")
# payload key -> contacts column
_CONTACT_COLUMN = {
    "first_name": "name",
    "last_name": "last_name",
    "phone": "phone",
    "email": "email",
    "address": "address",
}


class ContactDraftFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None


class ProposalIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["create_contact_draft"]
    fields: ContactDraftFields


class ConfirmIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payload_hash: str
    # Optional: the details the user saw. When sent they must normalize to
    # exactly the stored payload — a changed field needs a new proposal.
    fields: Optional[ContactDraftFields] = None


def _now() -> datetime.datetime:
    return datetime.datetime.utcnow()


def _normalize(
    db: Session, org_id: int, fields: dict, check_phone_taken: bool = True
) -> tuple[dict, list[str], list[dict]]:
    """Same rules as the Instinct draft create (Israeli mobile, email shape)
    plus the contacts column limits and the per-org phone uniqueness. Returns
    (canonical payload, missing field names, invalid fields as
    {field, code})."""
    payload: dict = {}
    for key in DRAFT_FIELDS:
        value = fields.get(key)
        payload[key] = (value.strip() or None) if isinstance(value, str) else None
    missing = [key for key in REQUIRED_FIELDS if not payload[key]]
    invalid: list[dict] = []

    if payload["phone"]:
        try:
            payload["phone"] = clean_phone(payload["phone"])
        except HTTPException:
            invalid.append({"field": "phone", "code": "invalid_phone"})
        else:
            if check_phone_taken:
                try:
                    _check_phone_unique(db, org_id, payload["phone"])
                except HTTPException:
                    invalid.append({"field": "phone", "code": "phone_taken"})
    if payload["email"]:
        try:
            payload["email"] = clean_email(payload["email"])
        except ValueError:
            invalid.append({"field": "email", "code": "invalid_email"})
    for key, column in _CONTACT_COLUMN.items():
        limit = DRAFT_FIELD_MAX_LENGTH.get(column)
        if limit and payload[key] and len(payload[key]) > limit:
            invalid.append({"field": key, "code": "too_long", "max_length": limit})
    return payload, missing, invalid


def _canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _payload_hash(proposal_id: str, action: str, org_id: int, user_id: int, payload_json: str) -> str:
    bound = json.dumps([proposal_id, action, org_id, user_id, payload_json], ensure_ascii=False)
    return hashlib.sha256(bound.encode("utf-8")).hexdigest()


def _invalid(invalid: list[dict], missing: Optional[list[str]] = None) -> HTTPException:
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"status": "invalid", "invalid_fields": invalid, "missing_fields": missing or []},
    )


def _draft_details(payload: dict, user: models.User) -> dict:
    """What confirming will create — shown to the user before they confirm."""
    return {
        "contact_type": "mekurav",
        "status": "draft",
        "source": "assistant",
        "assigned_user_id": user.guid,
        **payload,
    }


def _contact_out(contact: models.Contact) -> dict:
    return {
        "id": contact.id,
        "status": contact.status,
        "contact_type": contact.contact_type,
        "source": contact.source,
        "first_name": contact.name,
        "last_name": contact.last_name,
        "phone": contact.phone,
        "email": contact.email,
        "address": contact.address,
        "assigned_user_id": contact.assigned_user_id,
        "created_at": contact.created_at.isoformat() if contact.created_at else None,
    }


def _get_proposal(db: Session, proposal_id: str, user: models.User) -> models.AssistantProposal:
    proposal = (
        db.query(models.AssistantProposal)
        .filter(
            models.AssistantProposal.id == proposal_id,
            models.AssistantProposal.organization_id == user.organization_id,
            models.AssistantProposal.user_id == user.id,
        )
        .populate_existing()
        .first()
    )
    if proposal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposal not found")
    return proposal


def _result(db: Session, proposal: models.AssistantProposal, user: models.User, replayed: bool) -> dict:
    """Read the saved contact back from the DB (org-scoped) — the answer is
    what was stored, not what was sent."""
    db.expire_all()
    contact = (
        db.query(models.Contact)
        .filter(
            models.Contact.id == proposal.result_contact_id,
            models.Contact.organization_id == user.organization_id,
        )
        .first()
    )
    return {
        "status": "created",
        "replayed": replayed,
        "proposal_id": proposal.id,
        "contact_id": proposal.result_contact_id,
        # None only on a replay after the contact was deleted.
        "contact": _contact_out(contact) if contact else None,
    }


def _claim(db: Session, proposal_id: str) -> bool:
    """pending -> executed, atomically: of any number of concurrent confirms
    only one UPDATE matches (Postgres row lock; SQLite database lock)."""
    now = _now()
    claimed = (
        db.query(models.AssistantProposal)
        .filter(
            models.AssistantProposal.id == proposal_id,
            models.AssistantProposal.status == "pending",
            models.AssistantProposal.expires_at > now,
        )
        .update(
            {models.AssistantProposal.status: "executed", models.AssistantProposal.executed_at: now},
            synchronize_session=False,
        )
    )
    return claimed == 1


@router.post("/proposals")
def create_proposal(
    body: ProposalIn,
    response: Response,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(forbid_campaign_manager),
):
    org_id = current_user.organization_id
    payload, missing, invalid = _normalize(db, org_id, body.fields.model_dump())
    if missing:
        return {
            "status": "needs_information",
            "action": body.action,
            "missing_fields": missing,
            "invalid_fields": invalid,
            "fields": payload,
        }
    if invalid:
        raise _invalid(invalid)

    proposal_id = str(uuid4())
    payload_json = _canonical(payload)
    proposal = models.AssistantProposal(
        id=proposal_id,
        organization_id=org_id,
        user_id=current_user.id,
        action=body.action,
        payload=payload_json,
        payload_hash=_payload_hash(proposal_id, body.action, org_id, current_user.id, payload_json),
        status="pending",
        expires_at=_now() + PROPOSAL_TTL,
    )
    db.add(proposal)
    db.commit()
    response.status_code = status.HTTP_201_CREATED
    return {
        "status": "proposal",
        "action": body.action,
        "proposal_id": proposal.id,
        "payload_hash": proposal.payload_hash,
        "expires_at": proposal.expires_at.isoformat() + "Z",
        "draft": _draft_details(payload, current_user),
    }


@router.post("/proposals/{proposal_id}/confirm")
def confirm_proposal(
    proposal_id: str,
    body: ConfirmIn,
    response: Response,
    db: Session = Depends(get_db),
    # get_current_user reloads the user each request: a deactivated user
    # (401) or a role changed to campaign_manager (403) is refused here.
    current_user: models.User = Depends(forbid_campaign_manager),
):
    org_id = current_user.organization_id
    proposal = _get_proposal(db, proposal_id, current_user)
    if not hmac.compare_digest(body.payload_hash, proposal.payload_hash):
        raise HTTPException(status.HTTP_409_CONFLICT, "The confirmed details do not match this proposal")
    if body.fields is not None:
        sent, _, _ = _normalize(db, org_id, body.fields.model_dump(), check_phone_taken=False)
        if _canonical(sent) != proposal.payload:
            raise HTTPException(status.HTTP_409_CONFLICT, "The confirmed details do not match this proposal")

    if proposal.status == "executed":
        return _result(db, proposal, current_user, replayed=True)
    if proposal.expires_at <= _now():
        raise HTTPException(status.HTTP_410_GONE, "Proposal has expired — create a new one")

    # Revalidate: the phone may have been taken since the proposal was made.
    payload, missing, invalid = _normalize(db, org_id, json.loads(proposal.payload))
    if missing or invalid:
        raise _invalid(invalid, missing)

    data = {column: payload[key] for key, column in _CONTACT_COLUMN.items()}
    try:
        if not _claim(db, proposal.id):
            db.rollback()
            return _after_lost_claim(db, proposal_id, current_user)
        contact = create_draft_contact(
            db, org_id, data, source="assistant", assigned_user_id=current_user.guid
        )
        db.query(models.AssistantProposal).filter(
            models.AssistantProposal.id == proposal.id
        ).update(
            {models.AssistantProposal.result_contact_id: contact.id},
            synchronize_session=False,
        )
        db.commit()
    except IntegrityError:
        # A concurrent confirm of this proposal, or another contact taking
        # the same phone, committed first — nothing of ours was saved.
        db.rollback()
        return _after_lost_claim(db, proposal_id, current_user, phone=payload["phone"])
    except Exception:
        db.rollback()
        raise

    response.status_code = status.HTTP_201_CREATED
    return _result(db, _get_proposal(db, proposal_id, current_user), current_user, replayed=False)


def _after_lost_claim(
    db: Session, proposal_id: str, user: models.User, phone: Optional[str] = None
) -> dict:
    proposal = _get_proposal(db, proposal_id, user)
    if proposal.status == "executed":
        return _result(db, proposal, user, replayed=True)
    if proposal.expires_at <= _now():
        raise HTTPException(status.HTTP_410_GONE, "Proposal has expired — create a new one")
    if phone:
        try:
            _check_phone_unique(db, user.organization_id, phone)
        except HTTPException:
            raise _invalid([{"field": "phone", "code": "phone_taken"}])
    raise HTTPException(status.HTTP_409_CONFLICT, "The proposal could not be confirmed — try again")
