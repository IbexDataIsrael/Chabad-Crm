"""seed_superadmin must only ever pick the System-org superadmin — never a
tenant user who shares its email (that once turned org 1's admin into a
superadmin and replaced its password on a restart)."""
from app import models


def test_seed_superadmin_ignores_tenant_user_with_same_email(db_session, monkeypatch):
    from app.config import settings
    from app.core.security import hash_password, verify_password
    from app.seed import seed_superadmin

    monkeypatch.setattr(settings, "superadmin_email", "boss@example.com")
    monkeypatch.setattr(settings, "superadmin_password", "SuperPass1")
    monkeypatch.setattr(settings, "superadmin_username", "superadmin")
    tenant_org = models.Organization(name="Org One")
    db_session.add(tenant_org)
    db_session.flush()
    # The tenant user exists FIRST (lowest id) — the old email-only .first() picked it.
    tenant_user = models.User(
        organization_id=tenant_org.id, username="boss@example.com", full_name="Boss",
        email="boss@example.com", password_hash=hash_password("TenantPass1"),
        role="admin", is_active=True, email_verified=True,
    )
    db_session.add(tenant_user)
    db_session.commit()

    seed_superadmin(db_session)  # creates the System-org superadmin
    seed_superadmin(db_session)  # a restart: must update that one, not the tenant user
    db_session.refresh(tenant_user)
    assert tenant_user.role == "admin"
    assert tenant_user.username == "boss@example.com"
    assert verify_password("TenantPass1", tenant_user.password_hash)
    supers = db_session.query(models.User).filter_by(role="superadmin").all()
    assert len(supers) == 1 and supers[0].organization.name == settings.system_org_name
