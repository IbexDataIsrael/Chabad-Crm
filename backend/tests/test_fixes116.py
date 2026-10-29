"""fixes116: the user's language = the existing 'locale' preference.

PUT /api/preferences validates locale ("he" | "en" only); other keys keep their
free-form JSON. A write upserts exactly one key; the last write wins.
"""
import pytest

from app import models

URL = "/api/preferences"


def _put(client, headers, key, value):
    return client.put(URL, json={"key": key, "value": value}, headers=headers)


class TestLocaleValidation:
    @pytest.mark.parametrize("lang", ["he", "en"])
    def test_supported_languages_saved(self, client, admin_headers, lang):
        r = _put(client, admin_headers, "locale", lang)
        assert r.status_code == 200, r.text
        assert r.json()["locale"] == lang
        assert client.get(URL, headers=admin_headers).json()["locale"] == lang

    @pytest.mark.parametrize(
        "bad", ["fr", "", "HE", " he", 1, None, {"lang": "he"}, ["he"], True]
    )
    def test_invalid_language_rejected_and_nothing_changes(
        self, client, admin_headers, db_session, bad
    ):
        assert _put(client, admin_headers, "locale", "en").status_code == 200
        r = _put(client, admin_headers, "locale", bad)
        assert r.status_code == 400
        assert r.json()["detail"] == "Invalid language"
        assert client.get(URL, headers=admin_headers).json()["locale"] == "en"
        assert db_session.query(models.UserPreference).filter_by(key="locale").count() == 1

    def test_invalid_language_on_first_write_creates_no_row(
        self, client, admin_headers, db_session
    ):
        assert _put(client, admin_headers, "locale", "fr").status_code == 400
        assert "locale" not in client.get(URL, headers=admin_headers).json()
        assert db_session.query(models.UserPreference).count() == 0

    @pytest.mark.parametrize(
        "key,value",
        [
            ("contacts.columns", ["phone", "area"]),
            ("some.flag", True),
            ("some.number", 3),
            ("some.text", "fr"),  # "fr" is only invalid for locale
            ("some.null", None),
            ("some.obj", {"a": 1}),
        ],
    )
    def test_other_keys_unchanged_behaviour(self, client, admin_headers, key, value):
        r = _put(client, admin_headers, key, value)
        assert r.status_code == 200, r.text
        assert r.json()[key] == value


class TestSingleKeyWrite:
    def test_locale_write_leaves_other_keys(self, client, admin_headers):
        _put(client, admin_headers, "contacts.columns", ["phone", "owner"])
        _put(client, admin_headers, "apartments.columns", ["floor"])
        r = _put(client, admin_headers, "locale", "en")
        assert r.json() == {
            "contacts.columns": ["phone", "owner"],
            "apartments.columns": ["floor"],
            "locale": "en",
        }

    def test_other_key_write_leaves_locale(self, client, admin_headers):
        _put(client, admin_headers, "locale", "en")
        r = _put(client, admin_headers, "contacts.columns", ["phone"])
        assert r.json()["locale"] == "en"
        assert client.get(URL, headers=admin_headers).json()["locale"] == "en"

    def test_last_write_wins_single_row(self, client, admin_headers, db_session):
        _put(client, admin_headers, "locale", "en")
        _put(client, admin_headers, "locale", "he")
        assert client.get(URL, headers=admin_headers).json()["locale"] == "he"
        rows = db_session.query(models.UserPreference).filter_by(key="locale").all()
        assert len(rows) == 1 and rows[0].value == '"he"'


class TestScope:
    def test_users_cannot_see_or_change_each_others_locale(
        self, client, admin_headers, auth_headers
    ):
        _put(client, admin_headers, "locale", "en")
        assert "locale" not in client.get(URL, headers=auth_headers).json()
        # The other user's write (even with a smuggled user id) touches only them.
        r = client.put(
            URL, json={"key": "locale", "value": "he", "user_id": 1},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert client.get(URL, headers=auth_headers).json()["locale"] == "he"
        assert client.get(URL, headers=admin_headers).json()["locale"] == "en"

    def test_unauthenticated_401(self, client):
        assert client.get(URL).status_code == 401
        assert client.put(URL, json={"key": "locale", "value": "he"}).status_code == 401
