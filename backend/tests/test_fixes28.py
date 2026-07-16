"""Fixes28 acceptance tests: restricted (staff) users never associate with a
ContactShliach and never show on the shluchim listing; the Mivtzoim / custom
field filters obey the org's hidden state; contact email is a core CRUD field
with no visibility toggle."""

from app import models

_seq = iter(range(1000, 4999))


# --- Builders ----------------------------------------------------------------
def _mk_mekurav(client, headers, name, **extra):
    r = client.post(
        "/api/contacts",
        json={"name": name, "contact_type": "mekurav", **extra},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_visit(client, headers, contact_id, **fields):
    r = client.post(
        f"/api/contacts/{contact_id}/visits",
        json={"visit_date": "2026-07-01T10:00:00", **fields},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_shliach(client, headers, email, name="פעיל כח"):
    r = client.post(
        "/api/contacts",
        json={
            "name": name,
            "phone": f"0541{next(_seq):06d}",
            "contact_type": "shliach",
            "email": email,
            "shliach": {"password": "pw12345"},
        },
        headers=headers,
    )
    return r


def _mk_staff_user(client, headers, email, full_name="משתמש מוגבל"):
    r = client.post(
        "/api/users",
        json={"full_name": full_name, "email": email, "role": "staff",
              "password": "Pass1234"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _shluchim_ids(client, headers):
    r = client.get(
        "/api/contacts/list?contact_type=shliach&page=1&page_size=100",
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return [c["id"] for c in r.json()["items"]]


def _list_ids(client, headers, params):
    r = client.get(f"/api/contacts/list?{params}", headers=headers)
    assert r.status_code == 200, r.text
    return [c["id"] for c in r.json()["items"]]


# --- §2 restricted users vs Contact_shliach ----------------------------------
class TestRestrictedUserNoShliach:
    def test_staff_user_creation_creates_no_shliach_row(
        self, client, admin_headers, db_session
    ):
        before = _shluchim_ids(client, admin_headers)
        created = _mk_staff_user(client, admin_headers, "restricted28@x.com")
        link = (
            db_session.query(models.ContactShliach)
            .filter(models.ContactShliach.user_id == created["id"])
            .first()
        )
        assert link is None
        assert _shluchim_ids(client, admin_headers) == before

    def test_shliach_contact_with_staff_email_rejected(self, client, admin_headers):
        _mk_staff_user(client, admin_headers, "restricted28b@x.com")
        r = _mk_shliach(client, admin_headers, "restricted28b@x.com")
        assert r.status_code == 400
        assert "אינו פעיל" in r.json()["detail"]

    def test_recreate_with_staff_email_rejected(
        self, client, admin_headers, db_session
    ):
        staff = _mk_staff_user(client, admin_headers, "restricted28c@x.com")
        org_id = staff["organization_id"]
        # Legacy data: an unlinked shliach contact carrying the staff email.
        contact = models.Contact(
            organization_id=org_id,
            name="פעיל ישן",
            contact_type="shliach",
            email="restricted28c@x.com",
        )
        db_session.add(contact)
        db_session.commit()
        r = client.post(
            "/api/users/recreate",
            json={"email": "restricted28c@x.com"},
            headers=admin_headers,
        )
        assert r.status_code == 400
        assert "אינו פעיל" in r.json()["detail"]

    def test_shluchim_list_excludes_staff_linked_row(
        self, client, admin_headers, db_session
    ):
        real = _mk_shliach(client, admin_headers, "real.shliach28@x.com")
        assert real.status_code == 201
        real_id = real.json()["id"]

        staff = _mk_staff_user(client, admin_headers, "restricted28d@x.com")
        org_id = staff["organization_id"]
        # Legacy data: a shliach contact row wired to the staff login.
        contact = models.Contact(
            organization_id=org_id,
            name="מוגבל מקושר",
            contact_type="shliach",
            email="other28d@x.com",
        )
        db_session.add(contact)
        db_session.flush()
        db_session.add(
            models.ContactShliach(
                organization_id=org_id,
                contact_id=contact.id,
                user_id=staff["id"],
            )
        )
        db_session.commit()

        ids = _shluchim_ids(client, admin_headers)
        assert real_id in ids
        assert contact.id not in ids

    def test_shluchim_list_excludes_unlinked_staff_email_match(
        self, client, admin_headers, db_session
    ):
        staff = _mk_staff_user(client, admin_headers, "restricted28e@x.com")
        org_id = staff["organization_id"]
        # Legacy data: an unlinked shliach contact whose email is the staff
        # login's — the email-fallback resolution would treat them as one.
        contact = models.Contact(
            organization_id=org_id,
            name="מוגבל לפי אימייל",
            contact_type="shliach",
            email="Restricted28E@x.com",  # case-insensitive match
        )
        db_session.add(contact)
        db_session.commit()

        assert contact.id not in _shluchim_ids(client, admin_headers)

    def test_unlinked_shliach_without_login_still_listed(
        self, client, admin_headers, db_session
    ):
        """An imported shliach with no login account at all must keep showing
        (fixes27 §3 shows its 'missing login' notice instead)."""
        boss = (
            db_session.query(models.User)
            .filter(models.User.username == "boss")
            .first()
        )
        contact = models.Contact(
            organization_id=boss.organization_id,
            name="פעיל מיובא",
            contact_type="shliach",
            email="imported28@x.com",
        )
        db_session.add(contact)
        db_session.commit()

        assert contact.id in _shluchim_ids(client, admin_headers)


# --- §3 hidden fields never filter --------------------------------------------
class TestHiddenMivtzoimFilter:
    def _hide(self, client, headers, field_key, hidden=True):
        r = client.put(
            "/api/field-settings",
            json={"field_key": field_key, "is_visible": not hidden},
            headers=headers,
        )
        assert r.status_code == 200, r.text

    def test_hidden_flag_is_ignored(self, client, admin_headers):
        with_flag = _mk_mekurav(client, admin_headers, "עם תפילין")
        _mk_visit(client, admin_headers, with_flag["id"], tefillin=True)
        without = _mk_mekurav(client, admin_headers, "בלי תפילין")
        _mk_visit(client, admin_headers, without["id"])

        # Visible → the flag filters as before.
        ids = _list_ids(client, admin_headers, "contact_type=mekurav&mitzvot=tefillin")
        assert ids == [with_flag["id"]]

        # Hidden → the stale selection stops narrowing the list.
        self._hide(client, admin_headers, "visits.tefillin")
        ids = _list_ids(client, admin_headers, "contact_type=mekurav&mitzvot=tefillin")
        assert set(ids) >= {with_flag["id"], without["id"]}

        # Unknown names still 422 even while others are hidden.
        r = client.get(
            "/api/contacts/list?contact_type=mekurav&mitzvot=nope",
            headers=admin_headers,
        )
        assert r.status_code == 422

    def test_inactive_custom_field_key_is_ignored(self, client, admin_headers):
        d = client.post(
            "/api/custom-fields",
            json={"field_key": "purim_party28", "hebrew_label": "מסיבת פורים"},
            headers=admin_headers,
        ).json()
        attended = _mk_mekurav(client, admin_headers, "היה")
        v = _mk_visit(client, admin_headers, attended["id"])
        r = client.put(
            f"/api/visits/{v['id']}/custom-fields",
            json=[{"definition_id": d["id"], "checked": True, "note": None}],
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        skipped = _mk_mekurav(client, admin_headers, "לא היה")
        _mk_visit(client, admin_headers, skipped["id"])

        ids = _list_ids(
            client, admin_headers, "contact_type=mekurav&custom_fields=purim_party28"
        )
        assert ids == [attended["id"]]

        # Deactivate (the custom-fields page's "hide") → the key is ignored.
        r = client.delete(f"/api/custom-fields/{d['id']}", headers=admin_headers)
        assert r.status_code == 200
        ids = _list_ids(
            client, admin_headers, "contact_type=mekurav&custom_fields=purim_party28"
        )
        assert set(ids) >= {attended["id"], skipped["id"]}

        # A key that never existed still 422s.
        r = client.get(
            "/api/contacts/list?contact_type=mekurav&custom_fields=never_was",
            headers=admin_headers,
        )
        assert r.status_code == 422


# --- §1 email as a core CRUD field ---------------------------------------------
class TestContactEmailCore:
    def test_email_crud_roundtrip(self, client, admin_headers):
        created = _mk_mekurav(
            client, admin_headers, "בדיקת אימייל", email="crud28@x.com"
        )
        assert created["email"] == "crud28@x.com"

        r = client.get(f"/api/contacts/{created['id']}", headers=admin_headers)
        assert r.json()["email"] == "crud28@x.com"

        r = client.patch(
            f"/api/contacts/{created['id']}",
            json={"email": "crud28-new@x.com"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["email"] == "crud28-new@x.com"

        r = client.delete(f"/api/contacts/{created['id']}", headers=admin_headers)
        assert r.status_code == 204

    def test_email_has_no_visibility_toggle(self, client, admin_headers):
        r = client.get("/api/field-settings", headers=admin_headers)
        keys = [f["field_key"] for f in r.json()]
        assert "contacts.email" not in keys

        r = client.put(
            "/api/field-settings",
            json={"field_key": "contacts.email", "is_visible": False},
            headers=admin_headers,
        )
        assert r.status_code == 400
