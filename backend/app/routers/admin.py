"""Platform superadmin: cross-tenant management of organizations and users.

Every route here is gated by `require_superadmin` and deliberately ignores the
per-organization scoping the rest of the API enforces. This is the backend for
the /admin dashboard. Destructive actions (org delete, impersonate) are logged.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.core.security import create_access_token, hash_password
from app.database import get_db
from app.deps import require_superadmin
from app.schemas import AdminOrgCreate, AdminOrganizationOut, AdminUserOut, Token
from app.seed import provision_org

router = APIRouter(prefix="/api/admin", tags=["admin"])

logger = logging.getLogger("app.admin")


def _org_out(db: Session, org: models.Organization) -> AdminOrganizationOut:
    """Serialize an org with its admin + user count for the dashboard list."""
    user_count = (
        db.query(func.count(models.User.id))
        .filter(models.User.organization_id == org.id)
        .scalar()
    ) or 0
    admin = (
        db.query(models.User)
        .filter(
            models.User.organization_id == org.id,
            models.User.role == "admin",
        )
        .order_by(models.User.created_at)
        .first()
    )
    return AdminOrganizationOut(
        id=org.id,
        guid=org.guid,
        name=org.name,
        is_active=org.is_active,
        created_at=org.created_at,
        user_count=user_count,
        admin_email=admin.email if admin else None,
        admin_name=admin.full_name if admin else None,
    )


def _get_org(db: Session, org_id: int) -> models.Organization:
    org = db.get(models.Organization, org_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return org


def _is_system_org(db: Session, org_id: int) -> bool:
    """True if the org hosts a superadmin — protected from delete/deactivate."""
    return (
        db.query(models.User.id)
        .filter(
            models.User.organization_id == org_id,
            models.User.role == "superadmin",
        )
        .first()
        is not None
    )


def _delete_organization_cascade(db: Session, org_id: int) -> None:
    """Delete an org and every row that belongs to it, children first.

    The FKs to `organizations` have no DB-level ON DELETE CASCADE, so we remove
    dependents in an order that never violates a foreign key. Two tables
    (custom_field_values, community_checklists) carry no organization_id — they
    are scoped through their contact.
    """
    contact_ids = db.query(models.Contact.id).filter(
        models.Contact.organization_id == org_id
    )

    # Tables scoped via contact (no organization_id column of their own).
    db.query(models.CustomFieldValue).filter(
        models.CustomFieldValue.contact_id.in_(contact_ids)
    ).delete(synchronize_session=False)
    db.query(models.CommunityChecklist).filter(
        models.CommunityChecklist.contact_id.in_(contact_ids)
    ).delete(synchronize_session=False)

    # Org-scoped tables, leaves → roots.
    ordered_models = [
        models.ContactPicklistValue,
        models.ContactMekuravSpecialDate,
        models.SignificantDateReminder,
        models.ContactShliachApartment,
        models.ContactShliachArea,
        models.VisitHistory,
        models.Donation,
        models.Interaction,
        models.ContactMekurav,
        models.ContactShliach,
        models.CustomFieldDefinition,
        models.PicklistValue,
        models.PicklistDefinition,
        models.SignificantDate,
        models.Apartment,
        models.Building,
        models.Area,
        models.Contact,
        models.FieldSetting,
        models.User,
    ]
    for model in ordered_models:
        db.query(model).filter(
            model.organization_id == org_id
        ).delete(synchronize_session=False)

    db.query(models.Organization).filter(
        models.Organization.id == org_id
    ).delete(synchronize_session=False)
    db.commit()


# --- Organizations ---------------------------------------------------------
@router.post("/organizations", response_model=AdminOrganizationOut, status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: AdminOrgCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    """Provision an org + its admin directly (already active & verified).

    No email verification / Google needed — the superadmin sets the credentials.
    """
    if db.query(models.User).filter(models.User.email == payload.admin_email).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")

    org = models.Organization(name=payload.organization_name)
    db.add(org)
    db.flush()
    db.add(
        models.User(
            organization_id=org.id,
            username=payload.admin_username,
            full_name=payload.admin_full_name,
            email=payload.admin_email,
            password_hash=hash_password(payload.admin_password),
            role="admin",
            is_active=True,
            email_verified=True,
        )
    )
    db.commit()
    provision_org(db, org.id)
    logger.info("superadmin %s created org '%s' (admin %s)", admin.email, org.name, payload.admin_email)
    db.refresh(org)
    return _org_out(db, org)


@router.get("/organizations", response_model=list[AdminOrganizationOut])
def list_organizations(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    orgs = db.query(models.Organization).order_by(models.Organization.created_at).all()
    return [_org_out(db, org) for org in orgs]


@router.get("/organizations/{org_id}", response_model=AdminOrganizationOut)
def get_organization(
    org_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    return _org_out(db, _get_org(db, org_id))


@router.get("/organizations/{org_id}/users", response_model=list[AdminUserOut])
def list_organization_users(
    org_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    _get_org(db, org_id)
    return (
        db.query(models.User)
        .filter(models.User.organization_id == org_id)
        .order_by(models.User.created_at)
        .all()
    )


@router.post("/organizations/{org_id}/deactivate", response_model=AdminOrganizationOut)
def deactivate_organization(
    org_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    if _is_system_org(db, org_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot disable the system organization")
    org = _get_org(db, org_id)
    org.is_active = False
    db.commit()
    logger.info("superadmin %s deactivated org %s", admin.email, org_id)
    return _org_out(db, org)


@router.post("/organizations/{org_id}/activate", response_model=AdminOrganizationOut)
def activate_organization(
    org_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    org = _get_org(db, org_id)
    org.is_active = True
    db.commit()
    logger.info("superadmin %s activated org %s", admin.email, org_id)
    return _org_out(db, org)


@router.delete("/organizations/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_organization(
    org_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    if _is_system_org(db, org_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot delete the system organization")
    _get_org(db, org_id)
    _delete_organization_cascade(db, org_id)
    logger.warning("superadmin %s DELETED org %s and all its data", admin.email, org_id)


@router.post("/organizations/{org_id}/impersonate", response_model=Token)
def impersonate_organization(
    org_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    """Issue an access token for the org's admin, so support can view its data."""
    if _is_system_org(db, org_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot impersonate the system organization")
    target = (
        db.query(models.User)
        .filter(
            models.User.organization_id == org_id,
            models.User.role == "admin",
            models.User.is_active.is_(True),
        )
        .order_by(models.User.created_at)
        .first()
    )
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No active admin to impersonate in this organization")
    logger.warning("superadmin %s impersonating org %s as user %s", admin.email, org_id, target.id)
    token = create_access_token(subject=str(target.id), role=target.role)
    return Token(access_token=token)


# --- Users -----------------------------------------------------------------
@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    return db.query(models.User).order_by(models.User.created_at).all()


def _get_manageable_user(db: Session, user_id: int, actor: models.User) -> models.User:
    user = db.get(models.User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.role == "superadmin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot modify a superadmin account")
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    user = _get_manageable_user(db, user_id, admin)
    # Interactions/contacts reference users; null the soft links, hard-delete the rest.
    db.query(models.Interaction).filter(
        models.Interaction.created_by == user_id
    ).delete(synchronize_session=False)
    db.query(models.Contact).filter(
        models.Contact.assigned_user_id == user_id
    ).update({models.Contact.assigned_user_id: None}, synchronize_session=False)
    db.query(models.ContactShliach).filter(
        models.ContactShliach.user_id == user_id
    ).update({models.ContactShliach.user_id: None}, synchronize_session=False)
    db.delete(user)
    db.commit()
    logger.warning("superadmin %s deleted user %s (%s)", admin.email, user_id, user.email)


@router.post("/users/{user_id}/deactivate", response_model=AdminUserOut)
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    user = _get_manageable_user(db, user_id, admin)
    user.is_active = False
    db.commit()
    return user


@router.post("/users/{user_id}/activate", response_model=AdminUserOut)
def activate_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    user = _get_manageable_user(db, user_id, admin)
    user.is_active = True
    db.commit()
    return user


@router.post("/users/{user_id}/verify", response_model=AdminUserOut)
def verify_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    """Manually mark a user's email verified + active (bypasses the email link)."""
    user = _get_manageable_user(db, user_id, admin)
    user.email_verified = True
    user.is_active = True
    db.commit()
    return user
