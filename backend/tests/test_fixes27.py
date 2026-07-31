"""Fixes27 acceptance tests: visit-level contact filters (torah thought,
connection-to-the-Rebbe, dynamic custom fields), login-status enrichment on
the contacts list, and the visit fields in the visibility registry."""

_seq = iter(range(5000, 9999))


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


def _mk_shliach(client, headers, email, name="פעיל כז"):
    r = client.post(
        "/api/contacts",
        json={
            "name": name,
            "phone": f"0539{next(_seq):06d}",
            "contact_type": "shliach",
            "email": email,
            "shliach": {"password": "pw12345"},
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _list_ids(client, headers, params):
    r = client.get(f"/api/contacts/list?{params}", headers=headers)
    assert r.status_code == 200, r.text
    return [c["id"] for c in r.json()["items"]]


# --- §1 visit-level filters ----------------------------------------------------
class TestTorahThoughtFilter:
    def test_matches_through_any_visit(self, client, admin_headers):
        given = _mk_mekurav(client, admin_headers, "עם דבר תורה")
        _mk_visit(client, admin_headers, given["id"], torah_thought="given")
        other = _mk_mekurav(client, admin_headers, "בלי דבר תורה")
        _mk_visit(client, admin_headers, other["id"], torah_thought="not_given")
        _mk_mekurav(client, admin_headers, "בלי ביקורים")

        ids = _list_ids(
            client, admin_headers, "contact_type=mekurav&torah_thought=given"
        )
        assert ids == [given["id"]]

    def test_or_within_the_list(self, client, admin_headers):
        a = _mk_mekurav(client, admin_headers, "תורה א")
        _mk_visit(client, admin_headers, a["id"], torah_thought="given")
        b = _mk_mekurav(client, admin_headers, "תורה ב")
        _mk_visit(client, admin_headers, b["id"], torah_thought="scheduled")

        ids = _list_ids(
            client, admin_headers,
            "contact_type=mekurav&torah_thought=given&torah_thought=scheduled",
        )
        assert set(ids) >= {a["id"], b["id"]}


class TestRebbeFilter:
    def test_contains_match(self, client, admin_headers, db_session):
        from app import models
        from app.seed import seed_visit_mivtzoim_custom_fields

        strong = _mk_mekurav(client, admin_headers, "קשר חזק")
        org_id = (
            db_session.query(models.Contact.organization_id)
            .filter(models.Contact.id == strong["id"])
            .scalar()
        )
        seed_visit_mivtzoim_custom_fields(db_session, org_id)
        _mk_visit(
            client, admin_headers, strong["id"],
            custom_field_values={"connection_to_rebbe": "קשר חזק מאוד"},
        )
        weak = _mk_mekurav(client, admin_headers, "קשר אחר")
        _mk_visit(
            client, admin_headers, weak["id"],
            custom_field_values={"connection_to_rebbe": "התחלה"},
        )

        ids = _list_ids(
            client, admin_headers, "contact_type=mekurav&connection_to_rebbe=חזק"
        )
        assert ids == [strong["id"]]


class TestCustomFieldFilter:
    def _mk_def(self, client, headers, key, label="שדה"):
        r = client.post(
            "/api/custom-fields",
            json={"field_key": key, "hebrew_label": label},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        return r.json()

    def _check_field(self, client, headers, visit_id, definition_id):
        r = client.put(
            f"/api/visits/{visit_id}/custom-fields",
            json=[{"definition_id": definition_id, "checked": True, "note": None}],
            headers=headers,
        )
        assert r.status_code == 200, r.text

    def test_checked_on_any_visit_matches(self, client, admin_headers):
        d = self._mk_def(client, admin_headers, "hanuka_party27", "מסיבת חנוכה")
        party = _mk_mekurav(client, admin_headers, "היה במסיבה")
        v = _mk_visit(client, admin_headers, party["id"])
        self._check_field(client, admin_headers, v["id"], d["id"])
        no_party = _mk_mekurav(client, admin_headers, "לא היה")
        _mk_visit(client, admin_headers, no_party["id"])

        ids = _list_ids(
            client, admin_headers,
            "contact_type=mekurav&custom_fields=hanuka_party27",
        )
        assert ids == [party["id"]]

    def test_and_semantics_across_keys(self, client, admin_headers):
        d1 = self._mk_def(client, admin_headers, "cf_a27", "א")
        d2 = self._mk_def(client, admin_headers, "cf_b27", "ב")
        only_a = _mk_mekurav(client, admin_headers, "רק א")
        v = _mk_visit(client, admin_headers, only_a["id"])
        self._check_field(client, admin_headers, v["id"], d1["id"])
        both = _mk_mekurav(client, admin_headers, "גם וגם")
        v2 = _mk_visit(client, admin_headers, both["id"])
        r = client.put(
            f"/api/visits/{v2['id']}/custom-fields",
            json=[
                {"definition_id": d1["id"], "checked": True, "note": None},
                {"definition_id": d2["id"], "checked": True, "note": None},
            ],
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text

        ids = _list_ids(
            client, admin_headers,
            "contact_type=mekurav&custom_fields=cf_a27&custom_fields=cf_b27",
        )
        assert ids == [both["id"]]

    def test_unknown_key_is_422(self, client, admin_headers):
        r = client.get(
            "/api/contacts/list?custom_fields=no_such_key", headers=admin_headers
        )
        assert r.status_code == 422


# --- §3 login-status enrichment on the list -------------------------------------
class TestListLoginStatus:
    def _row(self, client, headers, contact_id):
        r = client.get(
            "/api/contacts/list?contact_type=shliach&page_size=100", headers=headers
        )
        assert r.status_code == 200, r.text
        return next(c for c in r.json()["items"] if c["id"] == contact_id)

    def test_active_disabled_missing(self, client, admin_headers):
        email = "rowstatus27@example.com"
        sh = _mk_shliach(client, admin_headers, email)
        assert self._row(client, admin_headers, sh["id"])["login_status"] == "active"

        users = client.get("/api/users", headers=admin_headers).json()
        uid = next(u["id"] for u in users if u["email"] == email)
        r = client.put(
            f"/api/users/{uid}", json={"is_active": False}, headers=admin_headers
        )
        assert r.status_code == 200, r.text
        assert self._row(client, admin_headers, sh["id"])["login_status"] == "disabled"

        r = client.delete(f"/api/users/{uid}", headers=admin_headers)
        assert r.status_code == 204, r.text
        assert self._row(client, admin_headers, sh["id"])["login_status"] == "missing"

    def test_mekurav_rows_have_no_status(self, client, admin_headers):
        c = _mk_mekurav(client, admin_headers, "מקורב ללא סטטוס")
        r = client.get(
            "/api/contacts/list?contact_type=mekurav&page_size=100",
            headers=admin_headers,
        )
        row = next(item for item in r.json()["items"] if item["id"] == c["id"])
        assert row["login_status"] is None


# --- §4 visit fields in the visibility registry ----------------------------------
class TestVisitFieldSettings:
    def test_registry_lists_visit_fields(self, client, admin_headers):
        """fixes39: only visits.torah_thought (picklist-backed) is left in
        this registry — the Mivtzoim flags + connection_to_rebbe are now
        ordinary custom fields, hidden via CustomFieldDefinition.is_active
        instead (see TestCustomFieldFilter above), not field_settings."""
        r = client.get("/api/field-settings", headers=admin_headers)
        assert r.status_code == 200, r.text
        by_key = {f["field_key"]: f for f in r.json()}
        assert "visits.torah_thought" in by_key
        assert by_key["visits.torah_thought"]["entity"] == "visit"
        assert by_key["visits.torah_thought"]["is_visible"] is True  # default-visible
        for key in (
            "visits.tefillin",
            "visits.tzedakah",
            "visits.shabbat_candles",
            "visits.torah_pamphlet",
            "visits.letter_in_torah",
            "visits.connection_to_rebbe",
        ):
            assert key not in by_key, key

    def test_toggle_roundtrip(self, client, admin_headers):
        r = client.put(
            "/api/field-settings",
            json={"field_key": "visits.torah_thought", "is_visible": False},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        r = client.get("/api/field-settings", headers=admin_headers)
        row = next(f for f in r.json() if f["field_key"] == "visits.torah_thought")
        assert row["is_visible"] is False
