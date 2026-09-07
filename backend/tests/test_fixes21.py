"""Fixes21 acceptance tests: shliach apartment/area visibility when the login
is not linked to the shliach contact via user_id (resolved by email instead),
and the no-separator apartment-title concatenation."""
from app import models
from app.core.display import apartment_title


# --- Builders ----------------------------------------------------------------
def _mk_area(client, headers, name="שכונה כא"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="21 Link St, City"):
    r = client.post(
        "/api/buildings",
        json={"area_id": area_id, "building_address": address, "floors": ["1"]},
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


def _mk_report_number(client, headers, name="דוח כא"):
    r = client.post("/api/report-numbers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


_seq = iter(range(3000, 9999))


# --- §1 shliach visibility via email-resolved contact (unlinked user_id) --------
class TestUnlinkedShliachVisibility:
    def _make_unlinked_shliach(
        self, client, admin_headers, db_session, email, **shliach
    ):
        """A shliach contact whose ContactShliach.user_id is NULL — simulating an
        imported shliach whose login was never wired to the contact. The login
        user (matching email) still exists; only the FK link is missing."""
        shliach.setdefault("password", "pw12345")
        r = client.post(
            "/api/contacts",
            json={
                "name": "פעיל מיובא",
                "phone": f"0559{next(_seq):06d}",
                "contact_type": "shliach",
                "email": email,
                "shliach": shliach,
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        contact = r.json()
        # Break the auto-provisioned link (the login user keeps its email).
        cs = (
            db_session.query(models.ContactShliach)
            .filter(models.ContactShliach.contact_id == contact["id"])
            .one()
        )
        cs.user_id = None
        db_session.commit()
        token = client.post(
            "/api/auth/token", data={"username": email, "password": "pw12345"}
        ).json()["access_token"]
        return contact, {"Authorization": f"Bearer {token}"}

    def test_report_number_visible_without_user_id_link(
        self, client, admin_headers, db_session, grant_task_access
    ):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        rn = _mk_report_number(client, admin_headers, "דוח מיובא")
        covered = _mk_apartment(
            client, admin_headers, b["id"], apartment_name="A",
            report_number_id=rn["id"],
        )
        _mk_apartment(client, admin_headers, b["id"], apartment_name="B")

        _, shliach = self._make_unlinked_shliach(
            client, admin_headers, db_session, "imported21@example.com",
            report_number_ids=[rn["id"]],
        )
        # fixes58: Task.volunteer_user_id is a direct users.id FK — it never
        # goes through resolve_shliach(), so the broken ContactShliach.user_id
        # link this test simulates doesn't matter for this grant.
        user = db_session.query(models.User).filter(
            models.User.email == "imported21@example.com"
        ).one()
        grant_task_access(user.organization_id, user.id, rn["id"])
        # Resolved by email → sees the report-number apartment.
        assert [a["id"] for a in client.get("/api/apartments", headers=shliach).json()] == [
            covered["id"]
        ]
        page = client.get("/api/apartments/list", headers=shliach).json()
        assert [a["id"] for a in page["items"]] == [covered["id"]]

    def test_area_visible_without_user_id_link(
        self, client, admin_headers, db_session
    ):
        area = _mk_area(client, admin_headers, "אזור מיובא")
        _, shliach = self._make_unlinked_shliach(
            client, admin_headers, db_session, "importedarea21@example.com",
            area_ids=[area["id"]],
        )
        got = client.get("/api/areas", headers=shliach).json()
        assert [a["id"] for a in got] == [area["id"]]


# --- §2 no-separator apartment title --------------------------------------------
class TestApartmentTitleConcat:
    def test_number_and_floor(self):
        class A:
            id = 5
            apartment_name = "A"
            floor = "2"
            name = ""

        assert apartment_title(A()) == "A2"

    def test_number_only(self):
        class A:
            id = 5
            apartment_name = "12"
            floor = ""
            name = ""

        assert apartment_title(A()) == "12"

    def test_floor_only_then_resident_then_id(self):
        class A:
            id = 5
            apartment_name = ""
            floor = "3"
            name = "כהן"

        assert apartment_title(A()) == "3"
        A.floor = ""
        assert apartment_title(A()) == "כהן"
        A.name = ""
        assert apartment_title(A()) == "#5"

    def test_title_flows_to_search(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "שכונת חיפוש")
        b = _mk_building(client, admin_headers, area["id"], "9 Search St, X")
        _mk_apartment(
            client, admin_headers, b["id"],
            apartment_name="C", floor="4", name="משפחת דוד",
        )
        hits = client.get("/api/search?q=דוד", headers=admin_headers).json()["results"]
        apt = [h for h in hits if h["type"] == "apartment"]
        assert apt and apt[0]["title"] == "C4"
