"""fixes25 acceptance tests: visit-centric restructuring extras.

Covered elsewhere: visit Mivtzoim/interactions round-trips (test_contacts),
visit custom-field values (test_custom_fields), mitzvot filters over visits
(test_fixes15/17), backup/restore of visit engagement data (test_fixes16),
phone-optional validation (test_contacts.test_contact_phone_optional).
"""
import io
import os

from app.config import settings

_phone = [7000]


def _mk_contact(client, headers, **overrides):
    _phone[0] += 1
    payload = {"name": "מקורב", "phone": f"052-9{_phone[0]:06d}"}
    payload.update(overrides)
    r = client.post("/api/contacts", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _add_visit(client, headers, contact_id, date, **extra):
    r = client.post(
        f"/api/contacts/{contact_id}/visits",
        json={"visit_date": date, **extra},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


class TestVisitDateRangeFilter:
    """§4: 'טווח תאריכי ביקור' — contacts filtered to those holding a visit
    inside the range (inner-join semantics: no visit in range → excluded)."""

    def test_range_filters_contacts(self, client, admin_headers):
        early = _mk_contact(client, admin_headers, name="מוקדם")
        late = _mk_contact(client, admin_headers, name="מאוחר")
        never = _mk_contact(client, admin_headers, name="ללא ביקור")
        _add_visit(client, admin_headers, early["id"], "2026-01-15T10:00:00")
        _add_visit(client, admin_headers, late["id"], "2026-06-20T18:30:00")

        def ids(qs):
            r = client.get(f"/api/contacts/list{qs}", headers=admin_headers)
            assert r.status_code == 200, r.text
            return {c["id"] for c in r.json()["items"]}

        # No range → everyone.
        assert {early["id"], late["id"], never["id"]} <= ids("")
        # From-only, to-only, and a closed range.
        assert ids("?visit_from=2026-03-01") == {late["id"]}
        assert ids("?visit_to=2026-03-01") == {early["id"]}
        assert ids("?visit_from=2026-01-01&visit_to=2026-02-01") == {early["id"]}
        # A date-only upper bound includes visits later that same day.
        assert ids("?visit_from=2026-06-20&visit_to=2026-06-20") == {late["id"]}
        # An empty range matches nobody (never has no visits at all).
        assert ids("?visit_from=2027-01-01") == set()

    def test_range_combines_with_other_filters(self, client, admin_headers, db_session):
        from app import models
        from app.seed import seed_visit_mivtzoim_custom_fields

        a = _mk_contact(client, admin_headers, name="גם וגם")
        b = _mk_contact(client, admin_headers, name="רק ביקור")
        org_id = (
            db_session.query(models.Contact.organization_id)
            .filter(models.Contact.id == a["id"])
            .scalar()
        )
        seed_visit_mivtzoim_custom_fields(db_session, org_id)
        tefillin_def_id = (
            db_session.query(models.CustomFieldDefinition.id)
            .filter_by(organization_id=org_id, entity_type="visit", field_key="tefillin")
            .scalar()
        )
        va = _add_visit(client, admin_headers, a["id"], "2026-05-01T10:00:00")
        flip = client.put(
            f"/api/visits/{va['id']}/custom-fields",
            json=[{"definition_id": tefillin_def_id, "checked": True, "note": None}],
            headers=admin_headers,
        )
        assert flip.status_code == 200, flip.text
        _add_visit(client, admin_headers, b["id"], "2026-05-01T10:00:00")
        r = client.get(
            "/api/contacts/list?visit_from=2026-04-01&custom_fields=tefillin",
            headers=admin_headers,
        )
        assert {c["id"] for c in r.json()["items"]} == {a["id"]}


class TestVisitTorahThoughtValidation:
    def test_torah_thought_validated_against_picklist(
        self, client, admin_headers, db_session
    ):
        from app.seed import seed_picklists

        me = client.get("/api/auth/me", headers=admin_headers).json()
        seed_picklists(db_session, me["organization"]["id"])
        c = _mk_contact(client, admin_headers)
        bad = client.post(
            f"/api/contacts/{c['id']}/visits",
            json={"visit_date": "2026-07-01T00:00:00", "torah_thought": "nope"},
            headers=admin_headers,
        )
        assert bad.status_code == 400
        ok = client.post(
            f"/api/contacts/{c['id']}/visits",
            json={"visit_date": "2026-07-01T00:00:00", "torah_thought": "given"},
            headers=admin_headers,
        )
        assert ok.status_code == 201, ok.text


class TestLogoLocalFallback:
    """§6: when Cloudinary is unconfigured or unreachable, the logo lands on
    local disk and is served back from /uploads/*."""

    _PNG = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    def _assert_local_roundtrip(self, client, response):
        assert response.status_code == 200, response.text
        url = response.json()["url"]
        assert "/uploads/logos/" in url
        filename = url.rsplit("/", 1)[1]
        path = os.path.join(settings.upload_dir, "logos", filename)
        assert os.path.exists(path)
        # Served back through the static mount.
        served = client.get(f"/uploads/logos/{filename}")
        assert served.status_code == 200
        assert served.content == self._PNG
        os.remove(path)

    def test_unconfigured_cloudinary_saves_locally(self, client, monkeypatch):
        monkeypatch.setattr(settings, "cloudinary_cloud_name", "")
        assert not settings.cloudinary_configured
        r = client.post(
            "/api/uploads/logo",
            files={"file": ("logo.png", io.BytesIO(self._PNG), "image/png")},
        )
        self._assert_local_roundtrip(client, r)

    def test_unreachable_cloudinary_falls_back_locally(self, client, monkeypatch):
        import requests

        import app.routers.uploads as uploads_router

        monkeypatch.setattr(settings, "cloudinary_cloud_name", "demo")
        monkeypatch.setattr(settings, "cloudinary_api_key", "key")
        monkeypatch.setattr(settings, "cloudinary_api_secret", "secret")

        def _boom(*args, **kwargs):
            raise requests.ConnectionError("cloudinary down")

        monkeypatch.setattr(uploads_router.requests, "post", _boom)
        r = client.post(
            "/api/uploads/logo",
            files={"file": ("logo.png", io.BytesIO(self._PNG), "image/png")},
        )
        self._assert_local_roundtrip(client, r)

    def test_non_image_rejected(self, client):
        r = client.post(
            "/api/uploads/logo",
            files={"file": ("evil.exe", io.BytesIO(b"MZ"), "application/x-msdownload")},
        )
        assert r.status_code == 400
