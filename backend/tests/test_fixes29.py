"""fixes29 §3: clearer email validation hint + §1 filter-toggle keys seeding."""

from app import models
from app.seed import seed_localization

NEW_HE = "נא להזין כתובת אימייל תקינה, לדוגמה name@example.com"
NEW_EN = "Please enter a valid email address, e.g. name@example.com"
OLD_HE = "כתובת אימייל תקינה, לדוגמה name@example.com"
OLD_EN = "A valid email address, e.g. name@example.com"


def _row(db, key):
    return (
        db.query(models.FieldLocalization)
        .filter(models.FieldLocalization.technical_name == key)
        .one()
    )


def test_email_hint_seeded_with_new_text(db_session):
    seed_localization(db_session)
    row = _row(db_session, "validation.email_hint")
    assert row.hebrew_label == NEW_HE
    assert row.english_label == NEW_EN


def test_email_hint_old_seed_upgraded_but_custom_kept(db_session):
    seed_localization(db_session)
    row = _row(db_session, "validation.email_hint")

    # An existing DB still carrying the old seeded text is upgraded in place.
    row.hebrew_label = OLD_HE
    row.english_label = OLD_EN
    db_session.commit()
    seed_localization(db_session)
    db_session.refresh(row)
    assert row.hebrew_label == NEW_HE
    assert row.english_label == NEW_EN

    # A custom admin label survives re-seeding untouched.
    row.hebrew_label = "טקסט מותאם"
    db_session.commit()
    seed_localization(db_session)
    db_session.refresh(row)
    assert row.hebrew_label == "טקסט מותאם"


def test_filter_toggle_keys_seeded(db_session):
    seed_localization(db_session)
    show = _row(db_session, "filter.show_filters")
    hide = _row(db_session, "filter.hide_filters")
    assert (show.hebrew_label, show.english_label) == ("הצג סינון", "Show filters")
    assert (hide.hebrew_label, hide.english_label) == ("הסתר סינון", "Hide filters")
