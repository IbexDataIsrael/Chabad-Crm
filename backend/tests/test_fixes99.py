"""fixes99: an image a user removes (logo, gallery photo, announcement or
footer image) is deleted from Cloudinary — unless it's still used anywhere
else (this org or another), and only when the feature switch is on."""
import pytest

from app import models

BASE = "https://res.cloudinary.com/testcloud/image/upload"


@pytest.fixture
def cloud(monkeypatch):
    """Cloudinary configured + switch on; returns the deleted public ids."""
    from app.config import settings

    monkeypatch.setattr(settings, "cloudinary_cloud_name", "testcloud")
    monkeypatch.setattr(settings, "cloudinary_api_key", "k")
    monkeypatch.setattr(settings, "cloudinary_api_secret", "s")
    monkeypatch.setattr(settings, "cloudinary_delete_on_org_delete", True)
    deleted: list[str] = []

    class _Resp:
        ok = True
        status_code = 200
        text = ""

        def __init__(self, ids):
            self._ids = ids

        def json(self):
            return {"deleted": {i: "deleted" for i in self._ids}}

    def fake_delete(url, params=None, auth=None, timeout=None):
        ids = [v for k, v in params if k == "public_ids[]"]
        deleted.extend(ids)
        return _Resp(ids)

    monkeypatch.setattr("app.core.cloudinary_assets.requests.delete", fake_delete)
    return deleted


def _put_org(client, headers, **data):
    r = client.put("/api/organizations/me", json=data, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_replacing_and_clearing_the_logo_deletes_the_old_one(client, admin_headers, cloud):
    _put_org(client, admin_headers, logo_url=f"{BASE}/v1/org_logos/old")
    _put_org(client, admin_headers, logo_url=f"{BASE}/v2/org_logos/new")
    assert cloud == ["org_logos/old"]
    _put_org(client, admin_headers, logo_url=None)
    assert cloud == ["org_logos/old", "org_logos/new"]


def test_unrelated_edit_deletes_nothing(client, admin_headers, cloud):
    _put_org(client, admin_headers, logo_url=f"{BASE}/v1/org_logos/keep",
             public_gallery=[f"{BASE}/v1/g/a.jpg"])
    _put_org(client, admin_headers, name="שם חדש")
    assert cloud == []


def test_removing_a_gallery_photo_deletes_only_it(client, admin_headers, cloud):
    _put_org(client, admin_headers, public_gallery=[f"{BASE}/v1/g/a.jpg", f"{BASE}/v1/g/b.jpg"])
    _put_org(client, admin_headers, public_gallery=[f"{BASE}/v1/g/b.jpg"])
    assert cloud == ["g/a"]


def test_image_still_used_elsewhere_in_the_org_is_kept(client, admin_headers, cloud):
    logo = f"{BASE}/v1/org_logos/both"
    _put_org(client, admin_headers, logo_url=logo, public_gallery=[logo])
    _put_org(client, admin_headers, logo_url=None)  # still a gallery photo
    assert cloud == []


def test_image_used_by_another_org_is_kept(client, admin_headers, db_session, cloud):
    shared = f"{BASE}/v1/org_logos/shared"
    _put_org(client, admin_headers, logo_url=shared)
    other = models.Organization(name="Clone", logo_url=shared)
    db_session.add(other)
    db_session.commit()
    _put_org(client, admin_headers, logo_url=None)
    assert cloud == []


def test_announcement_edit_and_delete(client, admin_headers, cloud):
    a, b = f"{BASE}/v3/ann/a.png", f"{BASE}/v3/ann/b.png"
    r = client.post(
        "/api/shliach-messages/announcements",
        json={"message_title": "t", "message_content": f'<img src="{a}"><img src="{b}">'},
        headers=admin_headers,
    )
    aid = r.json()["id"]
    client.put(f"/api/shliach-messages/announcements/{aid}",
               json={"message_content": f'<p>x</p><img src="{b}">'}, headers=admin_headers)
    assert cloud == ["ann/a"]
    client.delete(f"/api/shliach-messages/announcements/{aid}", headers=admin_headers)
    assert cloud == ["ann/a", "ann/b"]


def test_footer_images_count_as_used(client, admin_headers, cloud):
    img = f"{BASE}/v1/footer/f.png"
    _put_org(client, admin_headers, logo_url=img, public_footer_html=f'<img src="{img}">')
    _put_org(client, admin_headers, logo_url=None)  # the footer still shows it
    assert cloud == []
    _put_org(client, admin_headers, public_footer_html="<p>no image</p>")
    assert cloud == ["footer/f"]


def test_non_cloudinary_urls_are_ignored(client, admin_headers, cloud):
    _put_org(client, admin_headers, logo_url="https://example.com/logo.png")
    _put_org(client, admin_headers, logo_url=None)
    assert cloud == []


def test_switch_off_deletes_nothing(client, admin_headers, cloud, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "cloudinary_delete_on_org_delete", False)
    _put_org(client, admin_headers, logo_url=f"{BASE}/v1/org_logos/x")
    _put_org(client, admin_headers, logo_url=None)
    assert cloud == []


# --- username editable from the Users page ------------------------------------
def test_admin_edits_a_users_username(client, admin_headers):
    u = client.post(
        "/api/users",
        json={"full_name": "Dana Levi", "email": "dana99@example.com", "role": "staff",
              "password": "Passw0rd1"},
        headers=admin_headers,
    ).json()
    assert u["username"] == "dana99@example.com"
    r = client.put(f"/api/users/{u['id']}", json={"username": "  dana  "}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["username"] == "dana"
    assert client.post("/api/auth/token", data={"username": "dana", "password": "Passw0rd1"}).status_code == 200

    other = client.post(
        "/api/users",
        json={"full_name": "Other", "email": "other99@example.com", "role": "staff",
              "password": "Passw0rd1"},
        headers=admin_headers,
    ).json()
    assert client.put(f"/api/users/{other['id']}", json={"username": "dana"},
                      headers=admin_headers).status_code == 400  # taken in this org
    assert client.put(f"/api/users/{other['id']}", json={"username": "  "},
                      headers=admin_headers).status_code == 400
    assert client.put(f"/api/users/{other['id']}", json={"username": "x" * 51},
                      headers=admin_headers).status_code == 400
