"""Fixes11 acceptance tests: shliach-scoped plain apartments list, contacts
list sorting, and the assigned-user filter."""
import pytest

from app import models
from app.core.security import hash_password

_phone = [9000]


def _mk_contact(client, headers, **overrides):
    _phone[0] += 1
    payload = {"name": "מקורב אחת-עשרה", "phone": f"050-99{_phone[0]:05d}"}
    payload.update(overrides)
    r = client.post("/api/contacts", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


@pytest.fixture
def shliach_headers(client, db_session, admin_headers):
    org_id = _me(client, admin_headers)["organization_id"]
    user = models.User(
        organization_id=org_id,
        username="shliach11",
        full_name="שליח אחת-עשרה",
        email="shliach11@example.com",
        password_hash=hash_password("pw12345"),
        role="shliach",
        is_active=True,
        email_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    token = client.post(
        "/api/auth/token", data={"username": "shliach11", "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# --- §1.2 plain apartments list scoped for shliach ------------------------------
def test_plain_apartments_list_scoped_for_shliach(
    client, admin_headers, shliach_headers, db_session
):
    area = client.post("/api/areas", json={"area_name": "א"}, headers=admin_headers).json()
    b = client.post(
        "/api/buildings",
        json={"area_id": area["id"], "building_address": "1 Scope St", "floors": ["1"]},
        headers=admin_headers,
    ).json()
    covered = client.post(
        "/api/apartments",
        json={"building_id": b["id"], "apartment_name": "COVERED"},
        headers=admin_headers,
    ).json()
    client.post(
        "/api/apartments",
        json={"building_id": b["id"], "apartment_name": "OTHER"},
        headers=admin_headers,
    )

    # Link a shliach contact record (with one covered apartment) to the login.
    _phone[0] += 1
    sh = client.post(
        "/api/contacts",
        json={
            "name": "שליח",
            "phone": f"050-99{_phone[0]:05d}",
            "contact_type": "shliach",
            "email": "sh11@example.com",
            "shliach": {"apartment_ids": [covered["id"]], "area_ids": []},
        },
        headers=admin_headers,
    ).json()
    login = (
        db_session.query(models.User).filter(models.User.username == "shliach11").one()
    )
    cs = (
        db_session.query(models.ContactShliach)
        .filter(models.ContactShliach.contact_id == sh["id"])
        .one()
    )
    cs.user_id = login.id
    db_session.commit()

    # Admin sees both apartments; the shliach only the covered one.
    admin_names = [
        a["apartment_name"]
        for a in client.get("/api/apartments", headers=admin_headers).json()
    ]
    assert {"COVERED", "OTHER"} <= set(admin_names)
    shliach_names = [
        a["apartment_name"]
        for a in client.get("/api/apartments", headers=shliach_headers).json()
    ]
    assert shliach_names == ["COVERED"]


def test_plain_apartments_empty_for_uncovered_shliach(client, shliach_headers):
    assert client.get("/api/apartments", headers=shliach_headers).json() == []


# --- §2.3 contacts list sorting ---------------------------------------------------
def test_contacts_list_sorting(client, admin_headers):
    a = _mk_contact(client, admin_headers, name="בבב")
    b = _mk_contact(client, admin_headers, name="אאא")
    c = _mk_contact(client, admin_headers, name="גגג")

    # Default stays alphabetical ascending (back-compat).
    default = client.get("/api/contacts/list", headers=admin_headers).json()
    assert [x["id"] for x in default["items"]] == [b["id"], a["id"], c["id"]]

    # Creation date descending — newest first (the page's default presentation).
    created = client.get(
        "/api/contacts/list?sort=created&dir=desc", headers=admin_headers
    ).json()
    assert [x["id"] for x in created["items"]] == [c["id"], b["id"], a["id"]]

    # Explicit alphabetical, descending.
    named = client.get(
        "/api/contacts/list?sort=name&dir=desc", headers=admin_headers
    ).json()
    assert [x["id"] for x in named["items"]] == [c["id"], a["id"], b["id"]]

    assert (
        client.get("/api/contacts/list?sort=bogus", headers=admin_headers).status_code
        == 422
    )
    assert (
        client.get("/api/contacts/list?dir=sideways", headers=admin_headers).status_code
        == 422
    )


# --- §2.2 assigned-user filter -----------------------------------------------------
def test_contacts_list_assigned_user_filter(client, admin_headers, db_session):
    me = _me(client, admin_headers)
    other = models.User(
        organization_id=me["organization_id"],
        username="staff11",
        full_name="צוות",
        password_hash=hash_password("pw12345"),
        role="staff",
        is_active=True,
        email_verified=True,
    )
    db_session.add(other)
    db_session.commit()

    mine = _mk_contact(client, admin_headers)  # auto-assigned to me
    theirs = _mk_contact(client, admin_headers, assigned_user_id=other.guid)

    filtered = client.get(
        f"/api/contacts/list?assigned_user_id={me['guid']}", headers=admin_headers
    ).json()
    ids = [x["id"] for x in filtered["items"]]
    assert mine["id"] in ids and theirs["id"] not in ids

    all_of_them = client.get("/api/contacts/list", headers=admin_headers).json()
    assert {mine["id"], theirs["id"]} <= {x["id"] for x in all_of_them["items"]}
