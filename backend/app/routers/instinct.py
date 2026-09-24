"""Instinct test API (docs/system_api.md): one test-grade endpoint pair so
Instinct can add contacts.

- `GET  /api/instinct/ping`      — connectivity check.
- `POST /api/instinct/contacts`  — create a mekurav Contact.

Auth is a single shared key (`X-Instinct-Key` == env `INSTINCT_API_KEY`) —
test-grade only; production needs per-user tokens. With no user identity the
target org comes from env `INSTINCT_ORG_ID` (default 1).
"""
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.routers.contacts import _check_phone_unique, _geocode_fallback

router = APIRouter(prefix="/api/instinct", tags=["instinct"])


def check_key(x_instinct_key: str = Header(...)):
    expected = os.environ.get("INSTINCT_API_KEY")
    # An unset key must never match — otherwise the endpoint is open.
    if not expected or x_instinct_key != expected:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad key")


def _org_id() -> int:
    return int(os.environ.get("INSTINCT_ORG_ID", "1"))


class InstinctContactIn(BaseModel):
    first_name: str
    last_name: str
    phone: Optional[str] = None
    address: Optional[str] = None


@router.get("/ping", dependencies=[Depends(check_key)])
def ping():
    return {"ok": True}


@router.post(
    "/contacts",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_key)],
)
def create_contact(payload: InstinctContactIn, db: Session = Depends(get_db)):
    org_id = _org_id()
    if not db.get(models.Organization, org_id):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "INSTINCT_ORG_ID not found")

    data = {
        "name": payload.first_name.strip(),
        "last_name": payload.last_name.strip() or None,
        "phone": (payload.phone or "").strip() or None,
        "address": (payload.address or "").strip() or None,
    }
    if not data["name"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "first_name is required")
    if data["phone"]:
        _check_phone_unique(db, org_id, data["phone"])
    _geocode_fallback(data)

    contact = models.Contact(**data, organization_id=org_id, contact_type="mekurav")
    db.add(contact)
    db.flush()
    db.add(models.ContactMekurav(organization_id=org_id, contact_id=contact.id))
    db.commit()
    db.refresh(contact)

    return {
        "id": contact.id,
        "first_name": contact.name,
        "last_name": contact.last_name,
        "phone": contact.phone,
        "address": contact.address,
        "organization_id": contact.organization_id,
        "created_at": contact.created_at.isoformat() if contact.created_at else None,
    }
