"""Fixes18 acceptance tests: the מבצעים localization rename, the tzedaka-values
aggregation endpoint + exact-match filter, admin-area contact column/filter,
area add-activist + polygon-scoped eligible buildings, apartment picklist
filters + hyphen-free titles, and the shliach contacts-visibility permission."""
import json

import pytest

from app import models, picklist_utils
from app.core.display import apartment_title
from app.core.geo import point_in_polygon, polygon_ring
from app.core.security import hash_password
from app.seed import seed_localization


# --- Builders ------------------------------------------------------------------
def _mk_area(client, headers, name="שכונה", polygon=None):
    payload = {"area_name": name}
    if polygon is not None:
        payload["area_polygon"] = polygon
    r = client.post("/api/areas", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="1 Test St, City", **kw):
    r = client.post(
        "/api/buildings",
        json={
            "area_id": area_id,
            "building_address": address,
            "floors": ["1"],
            **kw,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_apartment(client, headers, building_id, **kw):
    r = client.post(
        "/api/apartments", json={"building_id": building_id, **kw}, headers=headers
    )
    assert r.status_code == 201, r.text
    return r.json()


_seq = iter(range(2000, 9999))


def _mk_contact(client, headers, name="פלוני", **overrides):
    payload = {
        "name": name,
        "phone": f"0528{next(_seq):06d}",
        "contact_type": "mekurav",
        **overrides,
    }
    r = client.post("/api/contacts", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


def _org(db_session, org_id):
    return db_session.get(models.Organization, org_id)


def _shliach_login(client, db_session, admin_headers, username="shliach18"):
    """An active shliach login inside the admin's org."""
    org_id = _me(client, admin_headers)["organization_id"]
    user = models.User(
        organization_id=org_id,
        username=username,
        full_name="שליח שמונה-עשרה",
        email=f"{username}@example.com",
        password_hash=hash_password("pw12345"),
        role="shliach",
        is_active=True,
        email_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    token = client.post(
        "/api/auth/token", data={"username": username, "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# A simple square around lng 34.0-35.0 / lat 31.0-32.0 (GeoJSON [lng, lat]).
SQUARE = json.dumps(
    {
        "type": "Polygon",
        "coordinates": [
            [[34.0, 31.0], [35.0, 31.0], [35.0, 32.0], [34.0, 32.0], [34.0, 31.0]]
        ],
    }
)


# --- §general: מצוות קהילה → מבצעים seed rename -------------------------------------
class TestMivtzoimRename:
    def _labels(self, db_session, key):
        row = (
            db_session.query(models.FieldLocalization)
            .filter(models.FieldLocalization.technical_name == key)
            .one()
        )
        return row.hebrew_label, row.english_label

    def test_fresh_seed_uses_new_labels(self, db_session):
        seed_localization(db_session)
        assert self._labels(db_session, "filter.all_mitzvot") == ("מבצעים", "Mivtzoim")

    def test_old_labels_are_force_renamed(self, db_session):
        seed_localization(db_session)
        row = (
            db_session.query(models.FieldLocalization)
            .filter(models.FieldLocalization.technical_name == "filter.all_mitzvot")
            .one()
        )
        row.hebrew_label, row.english_label = "מצוות קהילה", "Community mitzvot"
        db_session.commit()
        seed_localization(db_session)
        assert self._labels(db_session, "filter.all_mitzvot") == ("מבצעים", "Mivtzoim")

    def test_admin_customized_labels_survive(self, db_session):
        seed_localization(db_session)
        row = (
            db_session.query(models.FieldLocalization)
            .filter(models.FieldLocalization.technical_name == "filter.all_mitzvot")
            .one()
        )
        row.hebrew_label = "מותאם אישית"
        db_session.commit()
        seed_localization(db_session)
        he, _ = self._labels(db_session, "filter.all_mitzvot")
        assert he == "מותאם אישית"

    def test_new_fixes18_keys_are_seeded(self, db_session):
        seed_localization(db_session)
        keys = {
            r.technical_name
            for r in db_session.query(models.FieldLocalization.technical_name).all()
        }
        assert {
            "logo.upload", "logo.alt", "signup.org_logo", "settings.map_pick_hint",
            "select.search_ph", "filter.all_admin_areas", "filter.all_tzedaka",
            "page.shliach_view_contacts",
        } <= keys


# --- §3.2 tzedaka values + exact filter ----------------------------------------------
class TestTzedakaValues:
    def test_distinct_sorted_values(self, client, admin_headers):
        _mk_contact(client, admin_headers, mekurav={"tzedaka_potential": "גבוה"})
        _mk_contact(client, admin_headers, mekurav={"tzedaka_potential": "גבוה"})
        _mk_contact(client, admin_headers, mekurav={"tzedaka_potential": "  נמוך "})
        _mk_contact(client, admin_headers)  # no value
        r = client.get("/api/contacts/tzedaka-values", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json() == sorted(["גבוה", "נמוך"])

    def test_org_isolation(self, client, admin_headers):
        _mk_contact(client, admin_headers, mekurav={"tzedaka_potential": "סודי"})
        # /register provisions a brand-new org for the new user (fixes14).
        client.post(
            "/api/auth/register",
            json={
                "username": "boss2", "full_name": "מנהל ב",
                "password": "pw12345", "role": "admin",
            },
        )
        token = client.post(
            "/api/auth/token", data={"username": "boss2", "password": "pw12345"}
        ).json()["access_token"]
        other = {"Authorization": f"Bearer {token}"}
        assert _me(client, other)["organization_id"] != _me(client, admin_headers)[
            "organization_id"
        ]
        r = client.get("/api/contacts/tzedaka-values", headers=other)
        assert r.json() == []


# --- §3.4/§3.5 admin-area column + filter --------------------------------------------
class TestAdminAreaFilter:
    def _mk_admin_area(self, client, headers, name="צפון"):
        r = client.post("/api/admin-areas", json={"name": name}, headers=headers)
        assert r.status_code == 201, r.text
        return r.json()

    def test_list_enriched_with_admin_area_name(self, client, admin_headers):
        aa = self._mk_admin_area(client, admin_headers)
        c = _mk_contact(client, admin_headers, mekurav={"admin_area_id": aa["id"]})
        page = client.get(
            "/api/contacts/list?contact_type=mekurav", headers=admin_headers
        ).json()
        row = next(x for x in page["items"] if x["id"] == c["id"])
        assert row["admin_area_name"] == "צפון"

    def test_filter_by_admin_area_ids(self, client, admin_headers):
        aa1 = self._mk_admin_area(client, admin_headers, "צפון")
        aa2 = self._mk_admin_area(client, admin_headers, "דרום")
        c1 = _mk_contact(client, admin_headers, mekurav={"admin_area_id": aa1["id"]})
        c2 = _mk_contact(client, admin_headers, mekurav={"admin_area_id": aa2["id"]})
        _mk_contact(client, admin_headers)  # unlinked
        page = client.get(
            f"/api/contacts/list?admin_area_ids={aa1['id']}", headers=admin_headers
        ).json()
        assert [x["id"] for x in page["items"]] == [c1["id"]]
        both = client.get(
            f"/api/contacts/list?admin_area_ids={aa1['id']}&admin_area_ids={aa2['id']}",
            headers=admin_headers,
        ).json()
        assert {x["id"] for x in both["items"]} == {c1["id"], c2["id"]}

    def test_emails_respect_admin_area_filter(self, client, admin_headers):
        aa = self._mk_admin_area(client, admin_headers)
        _mk_contact(
            client, admin_headers, email="in@x.com",
            mekurav={"admin_area_id": aa["id"]},
        )
        _mk_contact(client, admin_headers, email="out@x.com")
        r = client.get(
            f"/api/contacts/emails?admin_area_ids={aa['id']}", headers=admin_headers
        )
        assert r.json() == ["in@x.com"]


# --- §4.2 add-activist endpoint -------------------------------------------------------
class TestAddAreaShliach:
    def test_assign_and_idempotent(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        sh = _mk_contact(
            client, admin_headers, name="פעיל", contact_type="shliach",
            email="activist18@x.com",
        )
        r = client.post(
            f"/api/areas/{area['id']}/shluchim",
            json={"contact_id": sh["id"]},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        assert [c["id"] for c in r.json()] == [sh["id"]]
        # Re-adding is a no-op, not an error or a duplicate.
        r = client.post(
            f"/api/areas/{area['id']}/shluchim",
            json={"contact_id": sh["id"]},
            headers=admin_headers,
        )
        assert r.status_code == 201
        assert [c["id"] for c in r.json()] == [sh["id"]]

    def test_rejects_non_shliach_contact(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        mek = _mk_contact(client, admin_headers)
        r = client.post(
            f"/api/areas/{area['id']}/shluchim",
            json={"contact_id": mek["id"]},
            headers=admin_headers,
        )
        assert r.status_code == 400

    def test_admin_only(self, client, admin_headers, auth_headers):
        area = _mk_area(client, admin_headers)
        r = client.post(
            f"/api/areas/{area['id']}/shluchim",
            json={"contact_id": 1},
            headers=auth_headers,
        )
        assert r.status_code == 403


# --- §4.3 eligible buildings (point-in-polygon) ---------------------------------------
class TestEligibleBuildings:
    def test_geo_helpers(self):
        ring = polygon_ring(SQUARE)
        assert ring is not None
        assert point_in_polygon(34.5, 31.5, ring) is True
        assert point_in_polygon(33.5, 31.5, ring) is False
        assert polygon_ring(None) is None
        assert polygon_ring("not json") is None
        assert polygon_ring('{"coordinates": [[[1,2]]]}') is None  # < 3 points

    def test_only_buildings_inside_polygon(self, client, admin_headers):
        target = _mk_area(client, admin_headers, name="יעד", polygon=SQUARE)
        other = _mk_area(client, admin_headers, name="אחר")
        inside = _mk_building(
            client, admin_headers, other["id"], address="1 In St, City",
            longitude=34.5, latitude=31.5,
        )
        _mk_building(
            client, admin_headers, other["id"], address="2 Out St, City",
            longitude=33.0, latitude=31.5,
        )
        _mk_building(client, admin_headers, other["id"], address="3 NoCoords St, City")
        # A building already in the target area is not re-offered.
        _mk_building(
            client, admin_headers, target["id"], address="4 Home St, City",
            longitude=34.6, latitude=31.6,
        )
        r = client.get(
            f"/api/areas/{target['id']}/eligible-buildings", headers=admin_headers
        )
        assert r.status_code == 200, r.text
        assert [b["id"] for b in r.json()] == [inside["id"]]

    def test_no_polygon_returns_empty(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        other = _mk_area(client, admin_headers, name="אחר")
        _mk_building(
            client, admin_headers, other["id"], longitude=34.5, latitude=31.5
        )
        r = client.get(
            f"/api/areas/{area['id']}/eligible-buildings", headers=admin_headers
        )
        assert r.json() == []


# --- §5.1 apartment titles (fixes21 §2: number+floor, no separator) -------------------
class TestApartmentTitle:
    def test_number_and_floor_concatenated(self):
        # fixes21 §2: "[number][floor]" with no separator.
        class A:
            id = 7
            apartment_name = "A"
            floor = "1"
            name = "משפחה"

        assert apartment_title(A()) == "A1"

    def test_fallbacks(self):
        class A:
            id = 7
            apartment_name = ""
            floor = "2"
            name = "משפחה"

        assert apartment_title(A()) == "2"  # only floor
        A.floor = ""
        assert apartment_title(A()) == "משפחה"  # resident
        A.name = ""
        assert apartment_title(A()) == "#7"  # id

    def test_number_only(self):
        class A:
            id = 7
            apartment_name = "5"
            floor = ""
            name = ""

        assert apartment_title(A()) == "5"


# --- §5.2 apartment picklist filters --------------------------------------------------
class TestApartmentFilters:
    def _setup(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        return b

    def test_filter_by_jewish_and_mezuzah(self, client, admin_headers, db_session):
        b = self._setup(client, admin_headers)
        a1 = _mk_apartment(client, admin_headers, b["id"], apartment_name="1")
        a2 = _mk_apartment(client, admin_headers, b["id"], apartment_name="2")
        a3 = _mk_apartment(client, admin_headers, b["id"], apartment_name="3")
        # Set the values directly via PicklistLink — the picklist registry
        # values vary per org (fixes32: no longer real columns).
        org_id = _me(client, admin_headers)["organization_id"]
        picklist_utils.set_value(
            db_session, org_id, "apartments", a1["id"], "apartment.Jewish_status", "jewish"
        )
        picklist_utils.set_value(
            db_session, org_id, "apartments", a1["id"], "apartment.mezuzah_status", "has_mezuzah"
        )
        picklist_utils.set_value(
            db_session, org_id, "apartments", a2["id"], "apartment.Jewish_status", "jewish"
        )
        picklist_utils.set_value(
            db_session, org_id, "apartments", a2["id"], "apartment.mezuzah_status", "no_mezuzah"
        )
        picklist_utils.set_value(
            db_session, org_id, "apartments", a3["id"], "apartment.Jewish_status", "not_jewish"
        )
        db_session.commit()

        r = client.get(
            "/api/apartments/list?jewish_status=jewish", headers=admin_headers
        ).json()
        assert {a["id"] for a in r["items"]} == {a1["id"], a2["id"]}
        r = client.get(
            "/api/apartments/list?jewish_status=jewish&mezuzah_status=has_mezuzah",
            headers=admin_headers,
        ).json()
        assert [a["id"] for a in r["items"]] == [a1["id"]]
        r = client.get(
            "/api/apartments/list?mezuzah_status=has_mezuzah&mezuzah_status=no_mezuzah",
            headers=admin_headers,
        ).json()
        assert {a["id"] for a in r["items"]} == {a1["id"], a2["id"]}


# --- §6 shliach contacts-visibility permission ----------------------------------------
class TestShliachContactsPermission:
    def test_flag_defaults_false_and_admin_can_toggle(self, client, admin_headers):
        org = client.get("/api/organizations/me", headers=admin_headers).json()
        assert org["shliach_can_view_contacts"] is False
        r = client.put(
            "/api/organizations/me",
            json={"shliach_can_view_contacts": True},
            headers=admin_headers,
        )
        assert r.status_code == 200
        assert r.json()["shliach_can_view_contacts"] is True

    def test_blocked_shliach_sees_no_mekuravim(
        self, client, admin_headers, db_session
    ):
        sh_headers = _shliach_login(client, db_session, admin_headers, "blocked18")
        own = _mk_contact(client, sh_headers, name="שלי")  # created by the shliach
        # Flag off (default): the mekurav vanishes from every read surface.
        page = client.get(
            "/api/contacts/list?contact_type=mekurav", headers=sh_headers
        ).json()
        assert page["total"] == 0
        assert client.get("/api/contacts", headers=sh_headers).json() == []
        assert (
            client.get(f"/api/contacts/{own['id']}", headers=sh_headers).status_code
            == 404
        )
        hits = client.get("/api/search?q=שלי", headers=sh_headers).json()["results"]
        assert not [h for h in hits if h["type"] == "contact"]

    def test_opted_in_shliach_sees_own_mekuravim(
        self, client, admin_headers, db_session
    ):
        sh_headers = _shliach_login(client, db_session, admin_headers, "allowed18")
        own = _mk_contact(client, sh_headers, name="נראה")
        client.put(
            "/api/organizations/me",
            json={"shliach_can_view_contacts": True},
            headers=admin_headers,
        )
        page = client.get(
            "/api/contacts/list?contact_type=mekurav", headers=sh_headers
        ).json()
        assert [c["id"] for c in page["items"]] == [own["id"]]
        assert (
            client.get(f"/api/contacts/{own['id']}", headers=sh_headers).status_code
            == 200
        )

    def test_staff_in_org_unaffected(self, client, admin_headers, db_session):
        c = _mk_contact(client, admin_headers, name="גלוי")
        # A staff user inside the same org (auth_headers lives in its own org).
        org_id = _me(client, admin_headers)["organization_id"]
        staff = models.User(
            organization_id=org_id,
            username="staff18",
            full_name="צוות",
            email="staff18@example.com",
            password_hash=hash_password("pw12345"),
            role="staff",
            is_active=True,
            email_verified=True,
        )
        db_session.add(staff)
        db_session.commit()
        token = client.post(
            "/api/auth/token", data={"username": "staff18", "password": "pw12345"}
        ).json()["access_token"]
        page = client.get(
            "/api/contacts/list?contact_type=mekurav",
            headers={"Authorization": f"Bearer {token}"},
        ).json()
        assert c["id"] in [x["id"] for x in page["items"]]
