"""Org cloning (POST /api/admin/organizations/{id}/clone): copies an org's
full CRM data set into a brand-new org with fresh ids/guids, rewires every
internal reference (including the two different polymorphic entity_table/
entity_id conventions used by picklists vs. custom fields), never clones user
accounts, and never touches the source org."""
import datetime

import pytest

from app import models
from app.core.security import hash_password


def _make_org(db, name, **kw):
    org = models.Organization(name=name, **kw)
    db.add(org)
    db.flush()
    return org


def _make_user(db, org_id, username, role, email=None):
    user = models.User(
        organization_id=org_id,
        username=username,
        full_name=username,
        email=email,
        password_hash=hash_password("pw12345"),
        role=role,
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


@pytest.fixture
def superadmin_headers(client, db_session):
    org = _make_org(db_session, "System")
    _make_user(db_session, org.id, "superadmin", "superadmin", "root@system.local")
    db_session.commit()
    token = client.post(
        "/api/auth/token", data={"username": "superadmin", "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _clone_payload(name="Clone Target", table_row_limits=None):
    payload = {
        "organization_name": name,
        "admin_username": "clone_admin",
        "admin_full_name": "מנהל עותק",
        "admin_email": "clone_admin@example.com",
        "admin_password": "pw12345",
    }
    if table_row_limits is not None:
        payload["table_row_limits"] = table_row_limits
    return payload


def _build_rich_org(db):
    """A source org touching every FK shape the clone has to handle: a plain
    FK chain (area -> building -> apartment), a self-referential FK (a
    versioned apartment, root_id), the two different polymorphic conventions
    (PicklistLink's own entity_table vs. CustomFieldValue's storage_table
    mapping), and both user-reference columns that must be nulled."""
    org = _make_org(db, "Source Org")
    owner = _make_user(db, org.id, "source_admin", "admin", "source_admin@example.com")

    area = models.Area(organization_id=org.id, area_name="אזור מקור")
    db.add(area)
    db.flush()
    building = models.Building(
        organization_id=org.id, area_id=area.id, building_address="1 Source St"
    )
    db.add(building)
    db.flush()
    admin_area = models.AdminArea(organization_id=org.id, name="אזור מנהל מקור")
    db.add(admin_area)
    db.flush()

    # Versioned apartment: v1 retired, v2 active, root_id chains to v1 — a
    # real self-referential FK the clone must rewire without breaking.
    apt_v1 = models.Apartment(
        organization_id=org.id, building_id=building.id, apartment_name="A1",
        is_display=False, editor_id=owner.id,
    )
    db.add(apt_v1)
    db.flush()
    apt_v2 = models.Apartment(
        organization_id=org.id, building_id=building.id, apartment_name="A1",
        is_display=True, root_id=apt_v1.id,
    )
    db.add(apt_v2)
    db.flush()

    contact = models.Contact(
        organization_id=org.id, name="איש קשר מקור", phone="050-7440011",
        contact_type="mekurav", assigned_user_id=owner.guid,
    )
    db.add(contact)
    db.flush()
    mekurav = models.ContactMekurav(
        organization_id=org.id, contact_id=contact.id, apartment_id=apt_v2.id,
        admin_area_id=admin_area.id,
    )
    db.add(mekurav)
    db.flush()

    # fixes83: client_uuid is GLOBALLY unique (copying it crashed every prod
    # clone) and apartment_id must follow the clone, not the source.
    visit = models.VisitHistory(
        organization_id=org.id, contact_id=contact.id,
        visit_date=datetime.datetime(2026, 1, 15),
        client_uuid="11111111-2222-3333-4444-555555555555",
        apartment_id=apt_v2.id,
    )
    db.add(visit)
    db.flush()

    # A custom field boolean value on the visit (CustomFieldValue's
    # polymorphic convention: entity_table = the *storage* table, "visit_history").
    definition = models.CustomFieldDefinition(
        organization_id=org.id, entity_type="visit", field_key="tefillin",
        hebrew_label="תפילין", english_label="Tefillin", field_type="boolean",
    )
    db.add(definition)
    db.flush()
    cfv = models.CustomFieldValue(
        organization_id=org.id, entity_table="visit_history", entity_id=visit.id,
        definition_id=definition.id, visit_id=visit.id, checked=True,
    )
    db.add(cfv)
    db.flush()

    # A picklist-backed value on the contact (PicklistLink's own convention:
    # entity_table = "contacts", distinct from CustomFieldValue's mapping).
    pl_def = models.PicklistDefinition(
        organization_id=org.id, system_name="contact.pipeline_status",
        hebrew_display_name="סטטוס", entity_type="contact_mekurav",
    )
    db.add(pl_def)
    db.flush()
    pl_val = models.PicklistValue(
        organization_id=org.id, field_key="contact.pipeline_status",
        value="new", hebrew_label="חדש",
    )
    db.add(pl_val)
    db.flush()
    link = models.PicklistLink(
        organization_id=org.id, entity_table="contacts", entity_id=contact.id,
        picklist_definition_id=pl_def.id, picklist_value_id=pl_val.id,
    )
    db.add(link)
    db.flush()

    db.commit()
    return {
        "org": org, "owner": owner, "area": area, "building": building,
        "admin_area": admin_area, "apt_v1": apt_v1, "apt_v2": apt_v2,
        "contact": contact, "mekurav": mekurav, "visit": visit,
        "definition": definition, "cfv": cfv, "pl_def": pl_def,
        "pl_val": pl_val, "link": link,
    }


def test_clone_requires_superadmin(client, admin_headers, db_session):
    src = _make_org(db_session, "Src")
    db_session.commit()
    r = client.post(
        f"/api/admin/organizations/{src.id}/clone",
        json=_clone_payload(), headers=admin_headers,
    )
    assert r.status_code == 403


def test_clone_nonexistent_source_404(client, superadmin_headers):
    r = client.post(
        "/api/admin/organizations/999999/clone",
        json=_clone_payload(), headers=superadmin_headers,
    )
    assert r.status_code == 404


def test_clone_copies_org_settings_and_creates_fresh_admin(client, superadmin_headers, db_session):
    src = _make_org(
        db_session, "Configured Org",
        shliach_can_view_contacts=True, report_notes="הערה מקורית", default_zoom=15,
    )
    db_session.commit()

    r = client.post(
        f"/api/admin/organizations/{src.id}/clone",
        json=_clone_payload("My Sample"), headers=superadmin_headers,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["id"] != src.id
    assert body["name"] == "My Sample"

    db_session.expire_all()
    new_org = db_session.get(models.Organization, body["id"])
    assert new_org.shliach_can_view_contacts is True
    assert new_org.report_notes == "הערה מקורית"
    assert new_org.default_zoom == 15

    # The fresh admin can actually log in, and is the ONLY user in the new org.
    token = client.post(
        "/api/auth/token", data={"username": "clone_admin", "password": "pw12345"}
    ).json()["access_token"]
    assert token
    new_org_users = (
        db_session.query(models.User).filter(models.User.organization_id == new_org.id).all()
    )
    assert len(new_org_users) == 1
    assert new_org_users[0].username == "clone_admin"


def test_clone_deep_data_integrity(client, superadmin_headers, db_session):
    fx = _build_rich_org(db_session)
    src_org_id = fx["org"].id

    r = client.post(
        f"/api/admin/organizations/{src_org_id}/clone",
        json=_clone_payload(), headers=superadmin_headers,
    )
    assert r.status_code == 201
    new_org_id = r.json()["id"]
    assert new_org_id != src_org_id

    db_session.expire_all()

    def _one(model, **filters):
        q = db_session.query(model).filter(model.organization_id == new_org_id)
        for k, v in filters.items():
            q = q.filter(getattr(model, k) == v)
        rows = q.all()
        assert len(rows) == 1, f"expected exactly 1 {model.__name__} matching {filters}, got {len(rows)}"
        return rows[0]

    new_contact = _one(models.Contact, name="איש קשר מקור")
    assert new_contact.id != fx["contact"].id
    # User-reference columns are nulled, never copied from the source org.
    assert new_contact.assigned_user_id is None

    new_mekurav = _one(models.ContactMekurav, contact_id=new_contact.id)
    new_admin_area = _one(models.AdminArea, name="אזור מנהל מקור")
    assert new_mekurav.admin_area_id == new_admin_area.id

    new_apt_v2 = _one(models.Apartment, apartment_name="A1", is_display=True)
    assert new_mekurav.apartment_id == new_apt_v2.id
    assert new_apt_v2.editor_id is None  # was set on v1, not v2, but prove the rule anyway
    new_apt_v1 = _one(models.Apartment, apartment_name="A1", is_display=False)
    assert new_apt_v1.editor_id is None  # user-reference column nulled
    # Self-referential FK correctly rewired to the NEW v1's id, not the source's.
    assert new_apt_v2.root_id == new_apt_v1.id
    assert new_apt_v2.root_id != fx["apt_v1"].id

    new_visit = _one(models.VisitHistory, contact_id=new_contact.id)
    assert new_visit.id != fx["visit"].id
    # fixes83: offline-sync key not copied (it's globally unique); the visit's
    # apartment is the CLONED apartment, not the source org's.
    assert new_visit.client_uuid is None
    assert new_visit.apartment_id == new_apt_v2.id

    # CustomFieldValue: entity_table="visit_history" convention, remapped
    # against the NEW visit's id.
    new_cfv = _one(models.CustomFieldValue, entity_table="visit_history")
    assert new_cfv.entity_id == new_visit.id
    assert new_cfv.checked is True

    # PicklistLink: entity_table="contacts" convention (different mapping
    # than CustomFieldValue for the same conceptual contact), remapped
    # against the NEW contact's id.
    new_link = _one(models.PicklistLink, entity_table="contacts")
    assert new_link.entity_id == new_contact.id
    new_pl_val = _one(models.PicklistValue, value="new")
    assert new_link.picklist_value_id == new_pl_val.id


def test_clone_leaves_source_org_untouched(client, superadmin_headers, db_session):
    fx = _build_rich_org(db_session)
    src_org_id = fx["org"].id
    before_contacts = (
        db_session.query(models.Contact).filter(models.Contact.organization_id == src_org_id).count()
    )
    before_apartments = (
        db_session.query(models.Apartment).filter(models.Apartment.organization_id == src_org_id).count()
    )

    r = client.post(
        f"/api/admin/organizations/{src_org_id}/clone",
        json=_clone_payload(), headers=superadmin_headers,
    )
    assert r.status_code == 201

    db_session.expire_all()
    after_contacts = (
        db_session.query(models.Contact).filter(models.Contact.organization_id == src_org_id).count()
    )
    after_apartments = (
        db_session.query(models.Apartment).filter(models.Apartment.organization_id == src_org_id).count()
    )
    assert after_contacts == before_contacts
    assert after_apartments == before_apartments
    # The source contact's own assigned_user_id is untouched (only the clone's
    # copy gets nulled).
    src_contact = db_session.query(models.Contact).filter(
        models.Contact.organization_id == src_org_id
    ).one()
    assert src_contact.assigned_user_id == fx["owner"].guid


def test_clone_new_org_isolated_from_source_via_api(client, superadmin_headers, db_session):
    fx = _build_rich_org(db_session)
    src_org_id = fx["org"].id

    r = client.post(
        f"/api/admin/organizations/{src_org_id}/clone",
        json=_clone_payload(), headers=superadmin_headers,
    )
    assert r.status_code == 201

    clone_token = client.post(
        "/api/auth/token", data={"username": "clone_admin", "password": "pw12345"}
    ).json()["access_token"]
    clone_headers = {"Authorization": f"Bearer {clone_token}"}

    resp = client.get("/api/contacts", headers=clone_headers)
    assert resp.status_code == 200
    names = [c["name"] for c in resp.json()]
    assert names == ["איש קשר מקור"]  # sees the cloned copy...

    source_token = client.post(
        "/api/auth/token", data={"username": "source_admin", "password": "pw12345"}
    ).json()["access_token"]
    source_headers = {"Authorization": f"Bearer {source_token}"}
    src_resp = client.get("/api/contacts", headers=source_headers)
    src_ids = {c["id"] for c in src_resp.json()}
    clone_ids = {c["id"] for c in resp.json()}
    assert src_ids.isdisjoint(clone_ids)  # ...but it's a different row, not a shared one


def test_clone_table_row_limit_keeps_most_recent_rows(client, superadmin_headers, db_session):
    """A capped table keeps its highest-id (most recently created) rows —
    not an arbitrary/first-N slice."""
    org = _make_org(db_session, "Big Org")
    area = models.Area(organization_id=org.id, area_name="אזור")
    db_session.add(area)
    db_session.flush()
    building = models.Building(organization_id=org.id, area_id=area.id, building_address="1 Main St")
    db_session.add(building)
    db_session.flush()
    for i in range(1, 6):
        db_session.add(
            models.Apartment(organization_id=org.id, building_id=building.id, apartment_name=f"A{i}")
        )
    db_session.commit()

    r = client.post(
        f"/api/admin/organizations/{org.id}/clone",
        json=_clone_payload(table_row_limits={"apartments": 2}),
        headers=superadmin_headers,
    )
    assert r.status_code == 201
    new_org_id = r.json()["id"]

    db_session.expire_all()
    cloned_names = sorted(
        a.apartment_name
        for a in db_session.query(models.Apartment).filter(
            models.Apartment.organization_id == new_org_id
        )
    )
    assert cloned_names == ["A4", "A5"]  # the 2 most recently created, not A1/A2
    # The building itself wasn't capped — it's still there and correctly targeted.
    cloned_building = db_session.query(models.Building).filter(
        models.Building.organization_id == new_org_id
    ).one()
    for apt in db_session.query(models.Apartment).filter(
        models.Apartment.organization_id == new_org_id
    ):
        assert apt.building_id == cloned_building.id


def test_clone_table_row_limit_drops_rows_with_dangling_required_fk(
    client, superadmin_headers, db_session
):
    """Capping a parent table (buildings) below what a child table
    (apartments) needs must drop the orphaned child rows, not crash the
    whole clone with a NOT NULL violation. A nullable reference to the same
    dropped row (mekurav.apartment_id) degrades to NULL instead."""
    org = _make_org(db_session, "Org With Two Buildings")
    area = models.Area(organization_id=org.id, area_name="אזור")
    db_session.add(area)
    db_session.flush()

    old_building = models.Building(organization_id=org.id, area_id=area.id, building_address="Old St")
    db_session.add(old_building)
    db_session.flush()
    apt = models.Apartment(organization_id=org.id, building_id=old_building.id, apartment_name="A1")
    db_session.add(apt)
    db_session.flush()

    contact = models.Contact(
        organization_id=org.id, name="מקורב", phone="050-1112222", contact_type="mekurav",
    )
    db_session.add(contact)
    db_session.flush()
    mekurav = models.ContactMekurav(organization_id=org.id, contact_id=contact.id, apartment_id=apt.id)
    db_session.add(mekurav)
    db_session.flush()

    # Created after old_building, so it's the one a limit=1 cap keeps.
    new_building = models.Building(organization_id=org.id, area_id=area.id, building_address="New St")
    db_session.add(new_building)
    db_session.commit()

    r = client.post(
        f"/api/admin/organizations/{org.id}/clone",
        json=_clone_payload(table_row_limits={"buildings": 1}),
        headers=superadmin_headers,
    )
    assert r.status_code == 201
    new_org_id = r.json()["id"]

    db_session.expire_all()
    cloned_buildings = db_session.query(models.Building).filter(
        models.Building.organization_id == new_org_id
    ).all()
    assert len(cloned_buildings) == 1
    assert cloned_buildings[0].building_address == "New St"

    # The apartment belonging to the dropped building can't be inserted with
    # a NOT NULL building_id pointing nowhere — it must be skipped entirely.
    cloned_apartments = db_session.query(models.Apartment).filter(
        models.Apartment.organization_id == new_org_id
    ).all()
    assert cloned_apartments == []

    # The mekurav itself still clones (contact_id is satisfiable) — its
    # nullable apartment_id just degrades to NULL rather than dangling.
    cloned_mekurav = db_session.query(models.ContactMekurav).filter(
        models.ContactMekurav.organization_id == new_org_id
    ).one()
    assert cloned_mekurav.apartment_id is None


def test_clone_rewires_activist_version_lineage(client, superadmin_headers, db_session):
    """fixes83: ContactShliach.root_id used to keep pointing at the SOURCE
    org's first version."""
    org = _make_org(db_session, "Lineage Src")
    contact = models.Contact(
        organization_id=org.id, name="פעיל", phone="050-7441122", contact_type="shliach",
    )
    db_session.add(contact)
    db_session.flush()
    v1 = models.ContactShliach(
        organization_id=org.id, contact_id=contact.id, full_name="v1", is_display=False,
    )
    db_session.add(v1)
    db_session.flush()
    v2 = models.ContactShliach(
        organization_id=org.id, contact_id=contact.id, full_name="v2", is_display=True,
        root_id=v1.id,
    )
    db_session.add(v2)
    db_session.commit()

    r = client.post(
        f"/api/admin/organizations/{org.id}/clone",
        json=_clone_payload("Lineage Copy"), headers=superadmin_headers,
    )
    assert r.status_code == 201, r.text
    new_org_id = r.json()["id"]
    db_session.expire_all()
    rows = {
        sh.full_name: sh
        for sh in db_session.query(models.ContactShliach).filter_by(organization_id=new_org_id)
    }
    assert rows["v2"].root_id == rows["v1"].id
    assert rows["v2"].root_id != v1.id
