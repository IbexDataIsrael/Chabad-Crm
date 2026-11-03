"""New orgs start with prod org 1's lists + custom fields (org_starter_template);
applied once, existing orgs are never touched, admin deletions stick."""
from app import models
from app.core.security import hash_password
from app.org_starter_template import (
    CUSTOM_FIELDS, PICKLIST_DEFINITIONS, PICKLIST_VALUES, MARKER_KEY,
    apply_starter_template, mark_existing_orgs,
)
from app.seed import provision_org


def _org(db, name, status="approved"):
    org = models.Organization(name=name, is_active=True, approval_status=status)
    db.add(org)
    db.commit()
    return org


def _snapshot(db, org_id):
    defs = {d.system_name: d for d in db.query(models.PicklistDefinition).filter_by(organization_id=org_id)}
    vals = {}
    for v in db.query(models.PicklistValue).filter_by(organization_id=org_id).order_by(models.PicklistValue.sort_order):
        vals.setdefault(v.field_key, []).append(v)
    cfs = {(c.entity_type, c.field_key): c for c in db.query(models.CustomFieldDefinition).filter_by(organization_id=org_id)}
    return defs, vals, cfs


def test_new_org_gets_the_full_template(db_session):
    org = _org(db_session, "Fresh", status="pending")
    provision_org(db_session, org.id)
    defs, vals, cfs = _snapshot(db_session, org.id)

    for name, entity, he, en, multi, _sys in PICKLIST_DEFINITIONS:
        assert name in defs, name
        assert (defs[name].hebrew_display_name, defs[name].english_display_name,
                defs[name].entity_type, defs[name].allow_multiple) == (he, en, entity, multi)
    # Every value list is exactly the template, in template order.
    for field_key, rows in PICKLIST_VALUES.items():
        got = [(v.value, v.hebrew_label, v.english_value, v.is_active) for v in vals.get(field_key, [])]
        assert got == [(r[0], r[1], r[2], r[4]) for r in rows], field_key
    for entity, key, ftype, he, en, active in CUSTOM_FIELDS:
        c = cfs[(entity, key)]
        assert (c.field_type, c.hebrew_label, c.english_label, c.is_active) == (ftype, he, en, active)
    # Test leftovers are not part of it.
    assert ("task", "test") not in cfs and ("contact_shliach", "Test") not in cfs
    # Select custom fields have their backing list.
    assert "shliach.Chanukah" in defs and "shliach.status_married" in defs
    assert [v.value for v in vals["apartment.language"]].count("english") == 1


def test_applied_once_admin_deletions_stick(db_session):
    org = _org(db_session, "Once", status="pending")
    provision_org(db_session, org.id)
    db_session.query(models.CustomFieldDefinition).filter_by(
        organization_id=org.id, entity_type="contact_mekurav", field_key="jewish_name").delete()
    db_session.query(models.PicklistValue).filter_by(
        organization_id=org.id, field_key="task.activist_type", value="subway").delete()
    db_session.commit()
    # Second provisioning (e.g. approval after email verification).
    provision_org(db_session, org.id)
    _, vals, cfs = _snapshot(db_session, org.id)
    assert ("contact_mekurav", "jewish_name") not in cfs
    assert "subway" not in [v.value for v in vals["task.activist_type"]]
    assert apply_starter_template(db_session, org.id) is False


def test_existing_orgs_marked_at_boot_and_left_alone(db_session):
    old = _org(db_session, "In use")
    pending = _org(db_session, "Waiting", status="pending")
    mark_existing_orgs(db_session)
    marked = {
        p.organization_id for p in db_session.query(models.OrganizationPreference).filter_by(key=MARKER_KEY)
    }
    assert old.id in marked and pending.id not in marked
    provision_org(db_session, old.id)  # e.g. a new user's email verification
    _, _, cfs = _snapshot(db_session, old.id)
    assert ("contact_mekurav", "jewish_name") not in cfs
    provision_org(db_session, pending.id)
    _, _, cfs = _snapshot(db_session, pending.id)
    assert ("contact_mekurav", "jewish_name") in cfs


def test_superadmin_created_org_gets_template(client, db_session):
    sys_org = _org(db_session, "System")
    db_session.add(models.User(
        organization_id=sys_org.id, username="sa", full_name="sa", email="sa@x.local",
        password_hash=hash_password("pw12345"), role="superadmin", is_active=True, email_verified=True,
    ))
    db_session.commit()
    tok = client.post("/api/auth/token", data={"username": "sa", "password": "pw12345"}).json()["access_token"]
    r = client.post("/api/admin/organizations", headers={"Authorization": f"Bearer {tok}"}, json={
        "organization_name": "Brand New", "admin_email": "a@brand.new", "admin_full_name": "A",
        "admin_username": "newadmin", "admin_password": "pw12345",
    })
    assert r.status_code == 201
    org_id = r.json()["id"]
    _, vals, cfs = _snapshot(db_session, org_id)
    assert ("visit", "chinoch") in cfs
    assert [v.value for v in vals["apartment.lulav"]] == ["didntTakeLulav", "tookLulav"]
