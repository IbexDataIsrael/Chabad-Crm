"""fixes110: web image search (Google Programmable Search) for the public-page
gallery, and import-by-URL through the existing Cloudinary/local pipeline."""
import json
import os

import pytest
import requests

import app.routers.organizations as org_router
import app.routers.uploads as uploads_router
from app.config import settings

PNG_1PX = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


class _FakeResp:
    """Minimal stand-in for requests.Response covering exactly what the two
    endpoints touch (status_code / ok / headers / json / iter_content / CM)."""

    def __init__(self, status_code=200, payload=None, content=b"", headers=None):
        self.status_code = status_code
        self._payload = payload
        self._content = content
        self.headers = headers or {}
        self.ok = 200 <= status_code < 300

    def json(self):
        if self._payload is not None:
            return self._payload
        return json.loads(self._content.decode())

    def iter_content(self, chunk_size=65536):
        for i in range(0, len(self._content), chunk_size):
            yield self._content[i : i + chunk_size]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _configure_google(monkeypatch):
    monkeypatch.setattr(settings, "google_search_api_key", "test-key")
    monkeypatch.setattr(settings, "google_search_cx", "test-cx")


# --- POST /api/organizations/public-image-search -----------------------------

def test_search_requires_admin(client, auth_headers):
    r = client.post(
        "/api/organizations/public-image-search",
        json={"query": "חב״ד"},
        headers=auth_headers,
    )
    assert r.status_code == 403


def test_search_not_configured(client, admin_headers):
    # The test env carries no Google keys — the endpoint must say so (503).
    r = client.post(
        "/api/organizations/public-image-search",
        json={"query": "חב״ד"},
        headers=admin_headers,
    )
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "error.image_search_not_configured"


def test_search_happy_path(client, admin_headers, monkeypatch):
    _configure_google(monkeypatch)
    seen = {}

    def _fake_get(url, params=None, **kwargs):
        seen["url"] = url
        seen["params"] = params
        return _FakeResp(
            payload={
                "items": [
                    {
                        "link": "https://cdn.example.com/a.jpg",
                        "image": {
                            "thumbnailLink": "https://cdn.example.com/a-t.jpg",
                            "width": 800,
                            "height": 600,
                        },
                        "title": "Photo A",
                    },
                    {
                        # Defensive parsing: missing dims/title, extra item
                        # without a thumbnail is skipped.
                        "link": "https://cdn.example.com/b.jpg",
                        "image": {"thumbnailLink": "https://cdn.example.com/b-t.jpg"},
                    },
                    {
                        "link": "https://cdn.example.com/c.jpg",
                        "title": "no thumbnail — skipped",
                    },
                ]
            }
        )

    monkeypatch.setattr(org_router.requests, "get", _fake_get)
    r = client.post(
        "/api/organizations/public-image-search",
        json={"query": "  בית חב״ד  "},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert seen["url"] == "https://www.googleapis.com/customsearch/v1"
    assert seen["params"]["q"] == "בית חב״ד"  # stripped
    assert seen["params"]["searchType"] == "image"
    assert seen["params"]["safe"] == "active"
    results = r.json()["results"]
    assert results == [
        {
            "url": "https://cdn.example.com/a.jpg",
            "thumbnail": "https://cdn.example.com/a-t.jpg",
            "width": 800,
            "height": 600,
            "title": "Photo A",
        },
        {
            "url": "https://cdn.example.com/b.jpg",
            "thumbnail": "https://cdn.example.com/b-t.jpg",
            "width": None,
            "height": None,
            "title": "",
        },
    ]


def test_search_missing_items_returns_empty(client, admin_headers, monkeypatch):
    _configure_google(monkeypatch)
    monkeypatch.setattr(
        org_router.requests, "get", lambda *a, **k: _FakeResp(payload={})
    )
    r = client.post(
        "/api/organizations/public-image-search",
        json={"query": "nothing"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json() == {"results": []}


def test_search_upstream_non_200(client, admin_headers, monkeypatch):
    _configure_google(monkeypatch)
    monkeypatch.setattr(
        org_router.requests,
        "get",
        lambda *a, **k: _FakeResp(
            status_code=403, payload={"error": {"message": "quota exceeded"}}
        ),
    )
    r = client.post(
        "/api/organizations/public-image-search",
        json={"query": "x"},
        headers=admin_headers,
    )
    assert r.status_code == 502
    body = r.json()["detail"]
    assert body["code"] == "error.image_search_upstream"
    assert "quota exceeded" in body["message"]


def test_search_upstream_unreachable(client, admin_headers, monkeypatch):
    _configure_google(monkeypatch)

    def _boom(*a, **k):
        raise requests.ConnectionError("no route")

    monkeypatch.setattr(org_router.requests, "get", _boom)
    r = client.post(
        "/api/organizations/public-image-search",
        json={"query": "x"},
        headers=admin_headers,
    )
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "error.image_search_upstream"


def test_search_empty_query(client, admin_headers, monkeypatch):
    _configure_google(monkeypatch)
    r = client.post(
        "/api/organizations/public-image-search",
        json={"query": "   "},
        headers=admin_headers,
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "error.image_search_query_required"


def test_search_count_clamped(client, admin_headers, monkeypatch):
    _configure_google(monkeypatch)
    seen = []

    def _fake_get(url, params=None, **kwargs):
        seen.append(params["num"])
        return _FakeResp(payload={"items": []})

    monkeypatch.setattr(org_router.requests, "get", _fake_get)
    client.post(
        "/api/organizations/public-image-search",
        json={"query": "x", "count": 500},
        headers=admin_headers,
    )
    client.post(
        "/api/organizations/public-image-search",
        json={"query": "x", "count": 0},
        headers=admin_headers,
    )
    client.post(
        "/api/organizations/public-image-search",
        json={"query": "x"},
        headers=admin_headers,
    )
    assert seen == [10, 1, 7]


# --- POST /api/uploads/gallery-image-url -------------------------------------

def test_import_requires_admin(client, auth_headers):
    r = client.post(
        "/api/uploads/gallery-image-url",
        json={"url": "https://example.com/a.png"},
        headers=auth_headers,
    )
    assert r.status_code == 403


def test_import_rejects_non_http_scheme(client, admin_headers):
    r = client.post(
        "/api/uploads/gallery-image-url",
        json={"url": "ftp://example.com/a.png"},
        headers=admin_headers,
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "error.image_url_not_allowed"


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/x.png",
        "http://localhost/x.png",
        "http://192.168.1.1/x.png",
        "http://[::1]/x.png",
        "http://10.0.0.5/a.png",
    ],
)
def test_import_rejects_private_hosts(client, admin_headers, url):
    r = client.post(
        "/api/uploads/gallery-image-url", json={"url": url}, headers=admin_headers
    )
    assert r.status_code == 400, url
    assert r.json()["detail"]["code"] == "error.image_url_not_allowed"


def test_import_rejects_unresolvable_host(client, admin_headers):
    # ".invalid" never resolves — the SSRF guard refuses it without network.
    r = client.post(
        "/api/uploads/gallery-image-url",
        json={"url": "http://no-such-host.invalid/x.png"},
        headers=admin_headers,
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "error.image_url_not_allowed"


def _public_dns(monkeypatch):
    """Point every hostname at a public IP so no real DNS/network is needed."""
    monkeypatch.setattr(
        uploads_router.socket,
        "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))],
    )


def test_import_oversize_download(client, admin_headers, monkeypatch):
    _public_dns(monkeypatch)
    big = b"\x89PNG\r\n\x1a\n" + b"x" * (uploads_router.MAX_LOGO_BYTES + 1)
    monkeypatch.setattr(
        uploads_router.requests,
        "get",
        lambda *a, **k: _FakeResp(content=big, headers={"Content-Type": "image/png"}),
    )
    r = client.post(
        "/api/uploads/gallery-image-url",
        json={"url": "http://example.com/big.png"},
        headers=admin_headers,
    )
    assert r.status_code == 413


def test_import_oversize_content_length_header(client, admin_headers, monkeypatch):
    _public_dns(monkeypatch)
    # Content-Length alone trips the pre-download check — the fake body is
    # empty, so a 413 proves the header was honored before streaming.
    monkeypatch.setattr(
        uploads_router.requests,
        "get",
        lambda *a, **k: _FakeResp(
            content=b"",
            headers={
                "Content-Type": "image/png",
                "Content-Length": str(uploads_router.MAX_LOGO_BYTES + 1),
            },
        ),
    )
    r = client.post(
        "/api/uploads/gallery-image-url",
        json={"url": "http://example.com/big.png"},
        headers=admin_headers,
    )
    assert r.status_code == 413


def test_import_wrong_content_type(client, admin_headers, monkeypatch):
    _public_dns(monkeypatch)
    monkeypatch.setattr(
        uploads_router.requests,
        "get",
        lambda *a, **k: _FakeResp(
            content=b"<html></html>", headers={"Content-Type": "text/html"}
        ),
    )
    r = client.post(
        "/api/uploads/gallery-image-url",
        json={"url": "http://example.com/page"},
        headers=admin_headers,
    )
    assert r.status_code == 415
    assert r.json()["detail"]["code"] == "error.image_url_not_image"


def test_import_upstream_error(client, admin_headers, monkeypatch):
    _public_dns(monkeypatch)
    monkeypatch.setattr(
        uploads_router.requests,
        "get",
        lambda *a, **k: _FakeResp(status_code=404, payload={"error": "not found"}),
    )
    r = client.post(
        "/api/uploads/gallery-image-url",
        json={"url": "http://example.com/missing.png"},
        headers=admin_headers,
    )
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "error.image_download_failed"


def test_import_happy_path_local_fallback(client, admin_headers, monkeypatch):
    """Cloudinary off (forced) — the downloaded bytes land under
    <upload_dir>/gallery/{org_id}/ and are served back from /uploads/*, the
    same contract test_fixes25 asserts for the logo."""
    monkeypatch.setattr(settings, "cloudinary_cloud_name", "")
    assert not settings.cloudinary_configured
    _public_dns(monkeypatch)
    monkeypatch.setattr(
        uploads_router.requests,
        "get",
        lambda *a, **k: _FakeResp(content=PNG_1PX, headers={"Content-Type": "image/png"}),
    )
    org_id = client.get("/api/auth/me", headers=admin_headers).json()["organization_id"]

    r = client.post(
        "/api/uploads/gallery-image-url",
        json={"url": "http://example.com/photo.png"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert f"/uploads/gallery/{org_id}/" in url
    filename = url.rsplit("/", 1)[1]
    path = os.path.join(settings.upload_dir, "gallery", str(org_id), filename)
    assert os.path.exists(path)
    served = client.get(f"/uploads/gallery/{org_id}/{filename}")
    assert served.status_code == 200
    assert served.content == PNG_1PX
    os.remove(path)
