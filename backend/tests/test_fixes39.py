"""Fixes39 acceptance tests: idempotent seeding of the 6 default visit
custom fields (tefillin/tzedakah/shabbat_candles/torah_pamphlet/
letter_in_torah/connection_to_rebbe) and provision_org wiring.

Covered elsewhere: the fields rendering/saving through the ordinary
custom-field endpoints (test_contacts.py), the dynamic visit-summary
breakdown including an admin-added field (test_fixes38.py), filtering by
the migrated fields via `custom_fields`/`has_mitzvot` (test_fixes15/17/28.py).
"""
from app import models
from app.seed import VISIT_MIVTZOIM_CUSTOM_FIELDS, provision_org, seed_visit_mivtzoim_custom_fields


def _org_id(client, headers):
    r = client.post(
        "/api/contacts", json={"name": "בדיקה", "phone": "050-0000001"}, headers=headers
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _defs(db_session, org_id):
    return (
        db_session.query(models.CustomFieldDefinition)
        .filter_by(organization_id=org_id, entity_type="visit")
        .all()
    )


class TestSeedIdempotent:
    def test_creates_exactly_the_six_fields(self, client, admin_headers, db_session):
        cid = _org_id(client, admin_headers)
        org_id = db_session.get(models.Contact, cid).organization_id
        seed_visit_mivtzoim_custom_fields(db_session, org_id)
        defs = {d.field_key: d for d in _defs(db_session, org_id)}
        assert set(defs) == {key for key, *_ in VISIT_MIVTZOIM_CUSTOM_FIELDS}
        for key, field_type, hebrew_label, english_label, sort_order in VISIT_MIVTZOIM_CUSTOM_FIELDS:
            d = defs[key]
            assert d.field_type == field_type
            assert d.hebrew_label == hebrew_label
            assert d.english_label == english_label
            assert d.sort_order == sort_order
            assert d.is_active is True

    def test_running_twice_never_duplicates(self, client, admin_headers, db_session):
        cid = _org_id(client, admin_headers)
        org_id = db_session.get(models.Contact, cid).organization_id
        seed_visit_mivtzoim_custom_fields(db_session, org_id)
        seed_visit_mivtzoim_custom_fields(db_session, org_id)
        seed_visit_mivtzoim_custom_fields(db_session, org_id)
        assert len(_defs(db_session, org_id)) == len(VISIT_MIVTZOIM_CUSTOM_FIELDS)

    def test_reactivates_a_deactivated_field_without_duplicating(
        self, client, admin_headers, db_session
    ):
        cid = _org_id(client, admin_headers)
        org_id = db_session.get(models.Contact, cid).organization_id
        seed_visit_mivtzoim_custom_fields(db_session, org_id)
        tefillin = next(d for d in _defs(db_session, org_id) if d.field_key == "tefillin")
        tefillin.is_active = False
        db_session.commit()

        seed_visit_mivtzoim_custom_fields(db_session, org_id)

        defs = _defs(db_session, org_id)
        assert len(defs) == len(VISIT_MIVTZOIM_CUSTOM_FIELDS)
        assert next(d for d in defs if d.field_key == "tefillin").is_active is True

    def test_does_not_touch_an_unrelated_field_with_the_same_key_prefix(
        self, client, admin_headers, db_session
    ):
        """A field_key collision is only possible within (org, entity_type,
        field_key) — this just re-confirms seeding is scoped correctly and
        doesn't wipe out an org's own definitions for other entity types."""
        cid = _org_id(client, admin_headers)
        org_id = db_session.get(models.Contact, cid).organization_id
        other = models.CustomFieldDefinition(
            organization_id=org_id,
            entity_type="contact_mekurav",
            field_key="tefillin",
            field_type="boolean",
            hebrew_label="שדה אחר",
        )
        db_session.add(other)
        db_session.commit()

        seed_visit_mivtzoim_custom_fields(db_session, org_id)

        db_session.refresh(other)
        assert other.hebrew_label == "שדה אחר"
        assert other.entity_type == "contact_mekurav"


class TestProvisionOrgWiring:
    def test_provision_org_seeds_the_defaults(self, client, admin_headers, db_session):
        """fixes39: new organizations get the 6 fields automatically."""
        cid = _org_id(client, admin_headers)
        org_id = db_session.get(models.Contact, cid).organization_id
        # Not seeded yet — register() (which admin_headers/auth_headers use)
        # doesn't provision, unlike the real signup flow.
        assert _defs(db_session, org_id) == []

        provision_org(db_session, org_id)

        # The 6 Mivtzoim are there; the starter template (org_starter_template)
        # adds org 1's other visit fields on top.
        keys = {d.field_key for d in _defs(db_session, org_id)}
        assert {k for k, *_ in VISIT_MIVTZOIM_CUSTOM_FIELDS} <= keys
