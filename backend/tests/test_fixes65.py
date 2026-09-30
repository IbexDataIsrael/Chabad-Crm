"""fixes65: public landing page, activist self-registration, orphan tasks,
signed QR claim tokens, task printing, paper entry and signup alerts."""
import pytest

from app import models
from app.core.claim_token import make_claim_token, parse_claim_token
from app.core.security import hash_password


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def org_id(client, admin_headers):
    return _me(client, admin_headers)["organization_id"]


@pytest.fixture
def public_org(client, admin_headers, org_id):
    r = client.put(
        "/api/organizations/me",
        json={
            "slug": "Test-Org",
            "public_subtitle": "ברוכים הבאים",
            "public_gallery": ["https://img.example.com/1.jpg", "javascript:alert(1)"],
            "self_registration_enabled": True,
        },
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def task_setup(client, admin_headers, org_id, db_session):
    """An active campaign + a report number covering one apartment."""
    area = models.Area(organization_id=org_id, area_name="א65")
    db_session.add(area)
    db_session.flush()
    building = models.Building(organization_id=org_id, area_id=area.id, building_address="1 Main St")
    rn = models.ReportNumber(organization_id=org_id, name="RN65")
    db_session.add_all([building, rn])
    db_session.flush()
    apt = models.Apartment(
        organization_id=org_id, building_id=building.id, report_number_id=rn.id, floor="1",
        apartment_name="3",
    )
    empty_rn = models.ReportNumber(organization_id=org_id, name="EMPTY")
    db_session.add_all([apt, empty_rn])
    db_session.commit()
    campaign = client.post(
        "/api/campaigns", json={"name": "קמפיין", "is_active": True}, headers=admin_headers
    ).json()
    return {"campaign_id": campaign["id"], "rn_id": rn.id, "empty_rn_id": empty_rn.id, "apt_id": apt.id}


def _orphan_task(client, admin_headers, task_setup, rn_key="rn_id"):
    r = client.post(
        "/api/tasks",
        json={"campaign_id": task_setup["campaign_id"], "report_number_ids": [task_setup[rn_key]]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_shliach(db_session, org_id, username):
    user = models.User(
        organization_id=org_id, username=username, full_name=username,
        email=f"{username}@example.com", password_hash=hash_password("Passw0rd!"),
        role="shliach", is_active=True, email_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _login(client, username):
    return _bearer(
        client.post("/api/auth/token", data={"username": username, "password": "Passw0rd!"})
        .json()["access_token"]
    )


# --- §1 landing page ---------------------------------------------------------
def test_public_org_page(client, public_org):
    assert public_org["slug"] == "test-org"
    assert public_org["public_gallery"] == ["https://img.example.com/1.jpg"]
    r = client.get("/api/public/orgs/test-org")
    assert r.status_code == 200
    body = r.json()
    assert body["subtitle"] == "ברוכים הבאים"
    assert body["self_registration_enabled"] is True
    assert client.get("/api/public/orgs/nope").status_code == 404


def test_slug_validation_and_uniqueness(client, admin_headers, public_org, org_id):
    r = client.put("/api/organizations/me", json={"slug": "bad slug!"}, headers=admin_headers)
    assert r.status_code == 422
    client.post(
        "/api/auth/register",
        json={"username": "boss2", "full_name": "x", "password": "pw12345", "role": "admin"},
    )
    other = _bearer(
        client.post("/api/auth/token", data={"username": "boss2", "password": "pw12345"})
        .json()["access_token"]
    )
    r = client.put("/api/organizations/me", json={"slug": "test-org"}, headers=other)
    assert r.status_code == 409
    # Case-insensitive, and the live check agrees with the PUT.
    r = client.put("/api/organizations/me", json={"slug": "TEST-ORG"}, headers=other)
    assert r.status_code == 409
    assert client.get("/api/organizations/slug-available?slug=test-org", headers=other).json()["available"] is False
    assert client.get("/api/organizations/slug-available?slug=free-one", headers=other).json()["available"] is True
    # An org's own current slug counts as available to itself.
    assert client.get("/api/organizations/slug-available?slug=test-org", headers=admin_headers).json()["available"] is True


def test_self_registration_toggle_default_off(client, admin_headers):
    client.put("/api/organizations/me", json={"slug": "closed"}, headers=admin_headers)
    r = client.post(
        "/api/public/register",
        json={"full_name": "a b", "email": "a@example.com", "password": "Passw0rd1", "org_slug": "closed"},
    )
    assert r.status_code == 403


# --- §5 registration ---------------------------------------------------------
def test_public_registration_creates_activist(client, admin_headers, public_org, org_id, db_session):
    r = client.post(
        "/api/public/register",
        json={
            "full_name": "משה  כהן",
            "email": "Moshe@Example.com",
            "password": "Passw0rd1",
            "phone": "0501234567",
            "org_slug": "test-org",
        },
    )
    assert r.status_code == 201, r.text
    me = _me(client, _bearer(r.json()["access_token"]))
    assert me["role"] == "shliach"
    assert me["organization_id"] == org_id
    assert me["full_name"] == "משה כהן"
    assert me["registration_source"] == "public"
    assert me["shliach"] is not None  # linked ContactShliach

    users = client.get("/api/users", headers=admin_headers).json()
    assert any(u["email"] == "moshe@example.com" for u in users)

    # Immediately usable with a normal login too.
    r = client.post("/api/auth/token", data={"username": "moshe@example.com", "password": "Passw0rd1"})
    assert r.status_code == 200

    # Same email again → sign in instead.
    r = client.post(
        "/api/public/register",
        json={"full_name": "x y", "email": "moshe@example.com", "password": "Passw0rd1", "org_slug": "test-org"},
    )
    assert r.status_code == 409


def test_google_registration_uses_typed_name(client, public_org, monkeypatch):
    """The account takes the name typed in the form, not the Google profile
    name — and the typed name is required."""
    from app.routers import public as public_router

    monkeypatch.setattr(
        public_router,
        "verify_google_token",
        lambda cred: {"email": "g.user@gmail.com", "name": "Google Profile Name", "sub": "g-123"},
    )
    r = client.post(
        "/api/public/register-google",
        json={"credential": "x", "full_name": "  ", "org_slug": "test-org"},
    )
    assert r.status_code == 422
    r = client.post("/api/public/register-google", json={"credential": "x", "org_slug": "test-org"})
    assert r.status_code == 422
    r = client.post(
        "/api/public/register-google",
        json={"credential": "x", "full_name": "דוד  לוי", "org_slug": "test-org"},
    )
    assert r.status_code == 201, r.text
    me = _me(client, _bearer(r.json()["access_token"]))
    assert me["full_name"] == "דוד לוי"


def test_admin_rename_updates_split_name(client, admin_headers, public_org, db_session):
    r = client.post(
        "/api/public/register",
        json={"full_name": "old name", "email": "rn@example.com", "password": "Passw0rd1", "org_slug": "test-org"},
    )
    uid = _me(client, _bearer(r.json()["access_token"]))["id"]
    r = client.put(f"/api/users/{uid}", json={"full_name": "שם חדש לגמרי"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is True
    user = db_session.get(models.User, uid)
    db_session.refresh(user)
    assert (user.first_name, user.last_name) == ("שם", "חדש לגמרי")


def test_registration_requires_email_and_strong_password(client, public_org):
    r = client.post(
        "/api/public/register",
        json={"full_name": "a b", "email": "", "password": "Passw0rd1", "org_slug": "test-org"},
    )
    assert r.status_code == 422
    r = client.post(
        "/api/public/register",
        json={"full_name": "a b", "email": "a@example.com", "password": "weak", "org_slug": "test-org"},
    )
    assert r.status_code == 422


def test_registration_notifies_admins_and_survives_email_failure(
    client, public_org, org_id, db_session, monkeypatch
):
    db_session.add(
        models.User(
            organization_id=org_id, username="admmail", full_name="adm",
            email="admmail@example.com", role="admin", is_active=True, email_verified=True,
        )
    )
    db_session.commit()
    sent = []

    def boom(to, subject, body, **kw):
        sent.append(to)
        raise RuntimeError("smtp down")

    monkeypatch.setattr("app.routers.public.send_email", boom)
    r = client.post(
        "/api/public/register",
        json={"full_name": "a b", "email": "n@example.com", "password": "Passw0rd1", "org_slug": "test-org"},
    )
    assert r.status_code == 201, r.text
    assert sent == ["admmail@example.com"]  # attempted, failed, registration intact


def test_registration_emails_every_admin(client, public_org, org_id, db_session, monkeypatch):
    for i in range(2):
        db_session.add(
            models.User(
                organization_id=org_id, username=f"adm{i}", full_name="adm",
                email=f"adm{i}@example.com", role="admin", is_active=True, email_verified=True,
            )
        )
    db_session.commit()
    sent = []
    monkeypatch.setattr("app.routers.public.send_email", lambda to, *a, **k: sent.append(to))
    r = client.post(
        "/api/public/register",
        json={"full_name": "a b", "email": "n2@example.com", "password": "Passw0rd1", "org_slug": "test-org"},
    )
    assert r.status_code == 201
    assert sorted(sent) == ["adm0@example.com", "adm1@example.com"]


# --- §2 orphan tasks + §8 filter ------------------------------------------------
def test_assign_later_creates_orphan(client, admin_headers, task_setup, org_id, db_session):
    task = _orphan_task(client, admin_headers, task_setup)
    assert task["volunteer_user_id"] is None
    assert task["is_orphan"] is True
    assert task["apartment_count"] == 1

    sh = _mk_shliach(db_session, org_id, "assigned1")
    client.post(
        "/api/tasks",
        json={"campaign_id": task_setup["campaign_id"], "volunteer_user_id": sh.id},
        headers=admin_headers,
    )
    orphans = client.get("/api/tasks/list?assignment=orphan", headers=admin_headers).json()
    assert [t["id"] for t in orphans["items"]] == [task["id"]]
    assigned = client.get("/api/tasks/list?assignment=assigned", headers=admin_headers).json()
    assert assigned["total"] == 1
    everything = client.get("/api/tasks/list", headers=admin_headers).json()
    assert everything["total"] == 2
    single = client.get(f"/api/tasks/{task['id']}", headers=admin_headers).json()
    assert single["id"] == task["id"] and single["is_orphan"] is True


# --- §4 claim token ------------------------------------------------------------
def test_claim_token_signed():
    token = make_claim_token("11111111-2222-3333-4444-555555555555")
    assert parse_claim_token(token) == "11111111-2222-3333-4444-555555555555"
    guid, sig = token.split(".")
    assert parse_claim_token(f"{guid}.{sig[:-1]}x") is None
    assert parse_claim_token(f"99999999-2222-3333-4444-555555555555.{sig}") is None
    assert parse_claim_token("garbage") is None


def test_claim_flow_states(client, admin_headers, task_setup, org_id, db_session):
    task = _orphan_task(client, admin_headers, task_setup)
    printed = client.get(f"/api/tasks/{task['id']}/print-data", headers=admin_headers).json()
    token = printed["claim_token"]
    assert token and len(printed["apartments"]) == 1

    info = client.get(f"/api/public/claim/{token}").json()
    assert info["state"] == "available" and info["has_activist"] is False
    assert info["report_number_names"] == ["RN65"]

    alice = _login(client, _mk_shliach(db_session, org_id, "alice").username)
    bob = _login(client, _mk_shliach(db_session, org_id, "bob").username)

    r = client.post(f"/api/tasks/claim/{token}", headers=alice).json()
    assert r["state"] == "claimed"
    assert client.post(f"/api/tasks/claim/{token}", headers=alice).json()["state"] == "yours"
    assert client.get(f"/api/public/claim/{token}", headers=alice).json()["state"] == "yours"
    assert client.post(f"/api/tasks/claim/{token}", headers=bob).json()["state"] == "taken"

    claimed = client.get("/api/tasks/list", headers=admin_headers).json()["items"][0]
    assert claimed["claimed_via"] == "qr" and claimed["claimed_at"]
    # fixes66 §1: assigned now → reprints still carry the same QR (the
    # activist's door into the system); signed out it reads as an
    # activist-owned task, so the claim page offers sign-in.
    assert client.get(f"/api/tasks/{task['id']}/print-data", headers=admin_headers).json()["claim_token"] == token
    public = client.get(f"/api/public/claim/{token}").json()
    assert public["state"] == "taken" and public["has_activist"] is True

    # Admin unassign → same printout works for the next claimant.
    r = client.post(f"/api/tasks/{task['id']}/unassign", headers=admin_headers).json()
    assert r["is_orphan"] and r["claimed_at"] is None
    assert client.post(f"/api/tasks/claim/{token}", headers=bob).json()["state"] == "claimed"

    # Done → link stops working.
    client.put(f"/api/tasks/{task['id']}", json={"status": "COMPLETED"}, headers=admin_headers)
    assert client.get(f"/api/public/claim/{token}").json()["state"] == "invalid"


def test_claim_dies_with_deleted_task(client, admin_headers, task_setup):
    task = _orphan_task(client, admin_headers, task_setup)
    token = client.get(f"/api/tasks/{task['id']}/print-data", headers=admin_headers).json()["claim_token"]
    client.delete(f"/api/tasks/{task['id']}", headers=admin_headers)
    assert client.get(f"/api/public/claim/{token}").json()["state"] == "invalid"


def test_claim_grants_apartment_access(client, admin_headers, task_setup, org_id, db_session):
    from app.routers.apartments import _shliach_apartment_ids

    task = _orphan_task(client, admin_headers, task_setup)
    token = client.get(f"/api/tasks/{task['id']}/print-data", headers=admin_headers).json()["claim_token"]
    sh = _mk_shliach(db_session, org_id, "carol")
    assert _shliach_apartment_ids(db_session, sh) == []
    client.post(f"/api/tasks/claim/{token}", headers=_login(client, "carol"))
    db_session.expire_all()
    assert _shliach_apartment_ids(db_session, sh) == [task_setup["apt_id"]]


def test_qr_registration_autoclaims_even_with_toggle_off(client, admin_headers, task_setup):
    task = _orphan_task(client, admin_headers, task_setup)
    token = client.get(f"/api/tasks/{task['id']}/print-data", headers=admin_headers).json()["claim_token"]
    r = client.post(
        "/api/public/register",
        json={"full_name": "דוד לוי", "email": "david@example.com", "password": "Passw0rd1", "claim_token": token},
    )
    assert r.status_code == 201, r.text
    assert r.json()["claim_state"] == "claimed"
    me = _me(client, _bearer(r.json()["access_token"]))
    assert me["registration_source"] == "qr"
    t = client.get("/api/tasks/list", headers=admin_headers).json()["items"][0]
    assert t["volunteer_user_id"] == me["id"]

    r = client.post(
        "/api/public/register",
        json={"full_name": "x y", "email": "x@example.com", "password": "Passw0rd1", "claim_token": "bad.token"},
    )
    assert r.status_code == 410


def test_admin_cannot_claim(client, admin_headers, task_setup):
    task = _orphan_task(client, admin_headers, task_setup)
    token = client.get(f"/api/tasks/{task['id']}/print-data", headers=admin_headers).json()["claim_token"]
    r = client.post(f"/api/tasks/claim/{token}", headers=admin_headers).json()
    assert r["state"] == "available" and r["detail"]


# --- §3 printing ----------------------------------------------------------------
def test_print_refused_without_apartments(client, admin_headers, task_setup):
    task = _orphan_task(client, admin_headers, task_setup, rn_key="empty_rn_id")
    assert task["apartment_count"] == 0
    assert client.get(f"/api/tasks/{task['id']}/print-data", headers=admin_headers).status_code == 409


# --- §6 paper entry ---------------------------------------------------------------
def test_paper_entry_free_text_locks_orphan(client, admin_headers, task_setup, org_id, db_session):
    task = _orphan_task(client, admin_headers, task_setup)
    token = client.get(f"/api/tasks/{task['id']}/print-data", headers=admin_headers).json()["claim_token"]

    # Attribution is mandatory.
    r = client.post(
        f"/api/tasks/{task['id']}/paper-entries",
        json={"performer_type": "name", "performer_name": "  "},
        headers=admin_headers,
    )
    assert r.status_code == 422

    users_before = db_session.query(models.User).count()
    r = client.post(
        f"/api/tasks/{task['id']}/paper-entries",
        json={
            "performer_type": "name",
            "performer_name": "Moshe Cohen",
            "apartments": [
                {"apartment_id": task_setup["apt_id"], "apartment_notes": "נמסר", "fields": ["apartment_notes"]}
            ],
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    entry = r.json()
    assert entry["performer_type"] == "name" and entry["apartment_count"] == 1
    assert db_session.query(models.User).count() == users_before  # no account created

    active = (
        db_session.query(models.Apartment)
        .filter(models.Apartment.is_display.is_(True), models.Apartment.report_number_id == task_setup["rn_id"])
        .one()
    )
    assert active.apartment_notes == "נמסר"

    t = client.get("/api/tasks/list", headers=admin_headers).json()["items"][0]
    assert t["is_orphan"] is False and t["claimed_via"] == "paper" and t["volunteer_user_id"] is None
    assert client.get(f"/api/public/claim/{token}").json()["state"] == "taken"

    history = client.get(f"/api/tasks/{task['id']}/paper-entries", headers=admin_headers).json()
    assert history[0]["performer_name"] == "Moshe Cohen"


def test_paper_entry_registered_user_assigns(client, admin_headers, task_setup, org_id, db_session):
    task = _orphan_task(client, admin_headers, task_setup)
    sh = _mk_shliach(db_session, org_id, "paperguy")
    r = client.post(
        f"/api/tasks/{task['id']}/paper-entries",
        json={"performer_type": "user", "performer_user_id": sh.id},
        headers=admin_headers,
    )
    assert r.status_code == 201
    t = client.get("/api/tasks/list", headers=admin_headers).json()["items"][0]
    assert t["volunteer_user_id"] == sh.id


def test_paper_entry_rejects_foreign_apartment(client, admin_headers, task_setup, org_id, db_session):
    task = _orphan_task(client, admin_headers, task_setup, rn_key="empty_rn_id")
    r = client.post(
        f"/api/tasks/{task['id']}/paper-entries",
        json={
            "performer_type": "unknown",
            "apartments": [{"apartment_id": task_setup["apt_id"], "apartment_notes": "x", "fields": ["apartment_notes"]}],
        },
        headers=admin_headers,
    )
    assert r.status_code == 400


# --- §5 admin manual add ------------------------------------------------------------
def test_emailless_activist_gets_manual_user(client, admin_headers, db_session, org_id):
    r = client.post(
        "/api/contacts",
        json={"name": "פעיל", "last_name": "נייר", "contact_type": "shliach"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    user = (
        db_session.query(models.User)
        .filter(models.User.organization_id == org_id, models.User.role == "shliach")
        .one()
    )
    assert user.is_manual is True and user.email is None and user.password_hash is None
    contact = r.json()
    assert contact["shliach"]["user_id"] == user.id

    # Adding an email later upgrades the same user.
    r = client.put(
        f"/api/contacts/{contact['id']}", json={"email": "paper@example.com"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    db_session.expire_all()
    user = db_session.get(models.User, user.id)
    assert user.email == "paper@example.com" and user.is_manual is False


# --- §7 dashboard alert --------------------------------------------------------------
def test_new_signups_card(client, admin_headers, public_org):
    assert client.get("/api/dashboard/new-signups", headers=admin_headers).json()["count"] == 0
    for i in range(2):
        client.post(
            "/api/public/register",
            json={"full_name": "a b", "email": f"s{i}@example.com", "password": "Passw0rd1", "org_slug": "test-org"},
        )
    assert client.get("/api/dashboard/new-signups", headers=admin_headers).json()["count"] == 2
    r = client.post("/api/dashboard/new-signups/dismiss", headers=admin_headers)
    assert r.status_code == 200
    assert client.get("/api/dashboard/new-signups", headers=admin_headers).json()["count"] == 0
