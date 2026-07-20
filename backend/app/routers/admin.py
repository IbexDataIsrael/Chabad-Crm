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
from app.config import settings
from app.core.email import send_email, send_org_approved_user
from app.core.security import create_access_token, hash_password
from app.database import get_db
from app.deps import require_superadmin
from app.schemas import (
    AdminOrgCreate,
    AdminOrganizationOut,
    AdminUserDependenciesOut,
    AdminUserOut,
    EmailTemplateOut,
    EmailTemplateUpdate,
    SystemConfigOut,
    SystemConfigUpdate,
    Token,
)
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
        approval_status=org.approval_status,
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
    dependents in an order that never violates a foreign key. One table
    (custom_field_values) carries no organization_id — it is scoped through
    its visit (fixes25).
    """
    visit_ids = db.query(models.VisitHistory.id).filter(
        models.VisitHistory.organization_id == org_id
    )
    db.query(models.CustomFieldValue).filter(
        models.CustomFieldValue.visit_id.in_(visit_ids)
    ).delete(synchronize_session=False)

    # Org-scoped tables, leaves → roots.
    ordered_models = [
        models.PicklistLink,  # fixes32: replaces ContactPicklistValue (generic now)
        models.ContactMekuravSpecialDate,
        models.SignificantDateReminder,
        models.ReportNumberContactShliach,
        models.ContactShliachArea,
        models.VisitHistory,
        models.Donation,
        models.ContactMekurav,
        models.ContactShliach,
        models.CustomFieldDefinition,
        models.PicklistValue,
        models.PicklistDefinition,
        models.SignificantDate,
        models.Apartment,
        models.ReportNumber,  # after Apartment, which references it
        models.Floor,  # before Building (FK); DB-level cascade only covers PG
        models.Building,
        models.Area,
        models.AdminArea,  # after ContactMekurav, which references it
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


# --- Diagnostics -----------------------------------------------------------
@router.post("/test-email")
def test_email(
    to: str,
    admin: models.User = Depends(require_superadmin),
) -> dict:
    """Send a real test email and report the exact outcome + SMTP config.

    Lets us trigger a send on prod and see success or the precise exception,
    instead of guessing from logs. Returns no secrets (password length only).
    """
    config = {
        "smtp_host": settings.smtp_host,
        "smtp_port": settings.smtp_port,
        "smtp_user": settings.smtp_user,
        "email_from": settings.email_from,
        "smtp_password_set": bool(settings.smtp_password),
        "smtp_password_len": len(settings.smtp_password or ""),
    }
    logger.info("test-email requested by %s → %s | config=%s", admin.email, to, config)
    try:
        send_email(to, "MiniCRM test email", "This is a test email from the admin panel.")
        return {"sent": True, "to": to, "config": config, "error": None}
    except Exception as e:  # noqa: BLE001 — report the failure to the caller
        return {
            "sent": False,
            "to": to,
            "config": config,
            "error": f"{type(e).__name__}: {e}",
        }


# --- Organizations ---------------------------------------------------------
@router.post("/organizations", response_model=AdminOrganizationOut, status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: AdminOrgCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    """Provision an org + its admin directly (already active & verified).

    No email verification / Google needed — the superadmin sets the credentials.
    fixes14: the admin email may already exist in *other* organizations (email
    is unique per org, and the login flow offers an org selection).
    """
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


@router.get("/users/{user_id}/dependencies", response_model=AdminUserDependenciesOut)
def user_dependencies(
    user_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    """Everything still tied to a user (fixes15 §2.2) — surfaced in the
    delete-confirm modal so a shliach's data ties are visible before deleting."""
    user = _get_manageable_user(db, user_id, _)
    assigned = (
        db.query(func.count(models.Contact.id))
        .filter(models.Contact.assigned_user_id == user.guid)
        .scalar()
    ) or 0
    # fixes25: interaction rows are gone (visit JSON, author as plain text).
    out = AdminUserDependenciesOut(assigned_contacts=assigned)
    shliach = (
        db.query(models.ContactShliach)
        .filter(models.ContactShliach.user_id == user_id)
        .first()
    )
    if shliach:
        out.shliach_contact_id = shliach.contact_id
        if shliach.contact:
            out.shliach_contact_name = " ".join(
                filter(None, [shliach.contact.last_name, shliach.contact.name])
            )
        out.covered_report_numbers = len(shliach.report_numbers)
        out.covered_areas = len(shliach.areas)
    out.has_dependencies = bool(assigned or shliach is not None)
    return out


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    user = _get_manageable_user(db, user_id, admin)
    # Contacts reference users; null the soft links, hard-delete the rest.
    db.query(models.Contact).filter(
        models.Contact.assigned_user_id == user.guid
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


# --- Signup approval -------------------------------------------------------
@router.post("/organizations/{org_id}/approve", response_model=AdminOrganizationOut)
def approve_organization(
    org_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    """Approve a pending org: activate it, provision its picklists, and email
    the org admin the 'approved' notice with a login link."""
    org = _get_org(db, org_id)
    org.is_active = True
    org.approval_status = "approved"
    db.commit()
    provision_org(db, org.id)
    logger.info("superadmin %s APPROVED org %s (%s)", admin.email, org_id, org.name)
    target = (
        db.query(models.User)
        .filter(models.User.organization_id == org_id, models.User.role == "admin")
        .order_by(models.User.created_at)
        .first()
    )
    if target and target.email:
        try:
            send_org_approved_user(db, target.email, target.full_name, org.name)
        except Exception:
            logger.exception("Failed to send org-approved email for org %s", org_id)
    return _org_out(db, org)


# --- Editable email templates ----------------------------------------------
@router.get("/email-templates", response_model=list[EmailTemplateOut])
def list_email_templates(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    return db.query(models.EmailTemplate).order_by(models.EmailTemplate.key).all()


@router.put("/email-templates/{key}", response_model=EmailTemplateOut)
def update_email_template(
    key: str,
    payload: EmailTemplateUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    tpl = (
        db.query(models.EmailTemplate)
        .filter(models.EmailTemplate.key == key)
        .first()
    )
    if tpl is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Email template not found")
    if payload.subject is not None:
        tpl.subject = payload.subject
    if payload.body is not None:
        tpl.body = payload.body
    if payload.body_hebrew is not None:
        tpl.body_hebrew = payload.body_hebrew
    db.commit()
    db.refresh(tpl)
    logger.info("superadmin %s edited email template %s", admin.email, key)
    return tpl


# --- System title configuration (fixes9 §1) ----------------------------------
_SYSTEM_CONFIG_KEYS = {
    "title_template": "system_title_template",
    "fallback_name": "system_fallback_org_name",
}


@router.get("/system-settings", response_model=SystemConfigOut)
def get_system_settings(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    from app.routers.metadata import read_system_settings

    values = read_system_settings(db)
    return SystemConfigOut(
        title_template=values["system_title_template"],
        fallback_name=values["system_fallback_org_name"],
    )


@router.put("/system-settings", response_model=SystemConfigOut)
def update_system_settings(
    payload: SystemConfigUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    for field, key in _SYSTEM_CONFIG_KEYS.items():
        value = getattr(payload, field)
        if value is None:
            continue
        row = (
            db.query(models.SystemSetting)
            .filter(models.SystemSetting.key == key)
            .first()
        )
        if row is None:
            row = models.SystemSetting(key=key)
            db.add(row)
        row.value = value.strip()
    db.commit()
    logger.info("superadmin %s updated system settings", admin.email)
    return get_system_settings(db, admin)
