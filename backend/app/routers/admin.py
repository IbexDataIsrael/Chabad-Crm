"""Platform superadmin: cross-tenant management of organizations and users.

Every route here is gated by `require_superadmin` and deliberately ignores the
per-organization scoping the rest of the API enforces. This is the backend for
the /admin dashboard. Destructive actions (org delete, impersonate) are logged.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.core.email import (
    get_pending_signup_emails,
    send_email,
    send_org_approved_user,
    set_pending_signup_emails,
)
from app.core.org_clone import clone_organization, plan_demo_clone
from app.core import org_prefs
from app.core.security import create_access_token, hash_password
from app.core.user_delete import clear_user_references
from app.database import get_db
from app.deps import require_superadmin
from app.schemas import (
    AdminOrgCreate,
    AdminOrganizationOut,
    AdminUserDependenciesOut,
    AdminUserOut,
    ClonePlanIn,
    ClonePlanOut,
    CloneResultOut,
    EmailTemplateOut,
    EmailTemplateUpdate,
    OrgPrefsOut,
    OrgPrefsUpdate,
    PendingSignupEmails,
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
        # fixes82: why delete/disable/impersonate are refused — the UI
        # explains it (naming these accounts) instead of a bare error.
        superadmin_usernames=[
            u
            for (u,) in db.query(models.User.username).filter(
                models.User.organization_id == org.id,
                models.User.role == "superadmin",
            )
        ],
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
    dependents in an order that never violates a foreign key.

    fixes87: the order is derived from the schema (every table with an
    organization_id, dependency-sorted children → parents) instead of a
    hand-kept list — that list had fallen behind (tasks, campaigns, backups,
    announcements, …), so deleting any org with tasks failed with a
    ForeignKeyViolation. Child tables WITHOUT an organization_id are cleared
    first through their parent rows.
    """
    from sqlalchemy import select

    from app.database import Base

    tables = Base.metadata.sorted_tables  # parents before children
    org_scoped = {t.name for t in tables if "organization_id" in t.c}
    # fixes75: audit logs outlive the org (the superadmin still sees them);
    # only the reference goes. Also the DB-level ON DELETE SET NULL.
    keep = {"organizations", "system_access_logs", "error_logs"}
    for model in (models.SystemAccessLog, models.ErrorLog):
        db.query(model).filter(model.organization_id == org_id).update(
            {model.organization_id: None}, synchronize_session=False
        )

    # 1) Tables with no organization_id of their own that point at this
    #    org's rows (campaign_field_visibility, campaign_building_completion,
    #    user_preferences, …): delete the rows hanging off this org's parents.
    for table in reversed(tables):
        if "organization_id" in table.c or table.name in keep:
            continue
        conds = []
        for col in table.c:
            for fk in col.foreign_keys:
                parent = fk.column.table
                if parent.name in org_scoped and parent.name not in keep:
                    conds.append(
                        col.in_(
                            select(fk.column).where(parent.c.organization_id == org_id)
                        )
                    )
        if conds:
            from sqlalchemy import or_ as _or

            db.execute(table.delete().where(_or(*conds)))

    # 2) Org-scoped tables, children before parents.
    for table in reversed(tables):
        if table.name in org_scoped and table.name not in keep:
            db.execute(table.delete().where(table.c.organization_id == org_id))

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


@router.post(
    "/organizations/{org_id}/clone",
    response_model=CloneResultOut,
    status_code=status.HTTP_201_CREATED,
)
def clone_organization_endpoint(
    org_id: int,
    payload: AdminOrgCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    """Copy an org's entire CRM data set into a brand-new organization, with
    a fresh admin login the caller supplies — for sample/demo/sandbox copies.
    The source org is never modified. See app.core.org_clone for exactly
    what's copied and how references are rewired."""
    source = _get_org(db, org_id)
    summary: dict = {}
    try:
        new_org = clone_organization(
            db,
            org_id,
            payload.organization_name,
            payload.admin_username,
            payload.admin_full_name,
            payload.admin_email,
            payload.admin_password,
            table_limits=payload.table_row_limits,
            demo_activist_user_ids=payload.demo_activist_user_ids,
            demo_password=payload.demo_password,
            summary=summary,
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except Exception:
        db.rollback()
        raise
    logger.info(
        "superadmin %s cloned org '%s' (id=%s) -> '%s' (id=%s)",
        admin.email, source.name, org_id, new_org.name, new_org.id,
    )
    db.refresh(new_org)
    return CloneResultOut(
        **_org_out(db, new_org).model_dump(exclude={"is_system"}),
        clone_activists=summary.get("activists", 0),
        clone_apartments=summary.get("apartments", 0),
        clone_tasks=summary.get("tasks", 0),
        demo_logins=summary.get("demo_logins", []),
    )


@router.post("/organizations/{org_id}/clone-plan", response_model=ClonePlanOut)
def clone_plan_endpoint(
    org_id: int,
    payload: ClonePlanIn,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    """fixes87: preview a demo clone (nothing is written) — the activists
    with tasks whose task apartments come closest to the target. The
    superadmin approves, then /clone receives exactly these user ids."""
    _get_org(db, org_id)
    return plan_demo_clone(db, org_id, payload.activist_count, payload.apartment_target)


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


@router.get("/organizations/{org_id}/prefs", response_model=OrgPrefsOut)
def get_organization_prefs(
    org_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    """fixes54 §8: the org's feature-toggle state — see OrgPrefsOut for the
    raw-vs-effective (cascaded) distinction."""
    _get_org(db, org_id)
    return OrgPrefsOut(
        raw=org_prefs.get_raw_prefs(db, org_id),
        effective=org_prefs.effective_flags(db, org_id),
    )


@router.put("/organizations/{org_id}/prefs", response_model=OrgPrefsOut)
def update_organization_prefs(
    org_id: int,
    payload: OrgPrefsUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    _get_org(db, org_id)
    org_prefs.set_prefs(db, org_id, payload.model_dump(exclude_unset=True))
    return OrgPrefsOut(
        raw=org_prefs.get_raw_prefs(db, org_id),
        effective=org_prefs.effective_flags(db, org_id),
    )


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
    # fixes75 §11: tasks go back to the pool (unassigned) on delete.
    out.assigned_tasks = (
        db.query(func.count(models.Task.id))
        .filter(models.Task.volunteer_user_id == user.id)
        .scalar()
    ) or 0
    shliach = (
        db.query(models.ContactShliach)
        .filter(
            models.ContactShliach.user_id == user_id,
            models.ContactShliach.is_display.is_(True),
        )
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
    out.has_dependencies = bool(assigned or out.assigned_tasks or shliach is not None)
    return out


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    user = _get_manageable_user(db, user_id, admin)
    # fixes75 §11: same cleanup as the org admin's delete.
    clear_user_references(db, user, admin)
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


class AdminPasswordReset(BaseModel):
    new_password: str


@router.post("/users/{user_id}/reset-password", response_model=AdminUserOut)
def reset_user_password(
    user_id: int,
    payload: AdminPasswordReset,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    """fixes75 §3: the superadmin sets a new password for any (non-superadmin)
    user. Same strength rule as the user's own change-password."""
    from app.routers.auth import _is_strong_password

    user = _get_manageable_user(db, user_id, admin)
    if not _is_strong_password(payload.new_password):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Password must be at least 8 characters with an uppercase letter, a lowercase letter, and a number.",
        )
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    logger.warning("superadmin %s reset the password of user %s", admin.email, user_id)
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


@router.get("/pending-signup-emails", response_model=PendingSignupEmails)
def get_pending_signup_emails_setting(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    """fixes81 §3: who (besides the env addresses) is emailed when a new
    organization signs up and awaits approval."""
    return PendingSignupEmails(emails=get_pending_signup_emails(db))


@router.put("/pending-signup-emails", response_model=PendingSignupEmails)
def update_pending_signup_emails_setting(
    payload: PendingSignupEmails,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_superadmin),
):
    emails = set_pending_signup_emails(db, payload.emails)
    db.commit()
    logger.info("superadmin %s set pending-signup notify emails (%d)", admin.email, len(emails))
    return PendingSignupEmails(emails=emails)
