"""fixes38d -- remove orphaned FieldLocalization rows.

`seed_localization` is purely additive/idempotent (it inserts rows missing
from `LOCALIZATION` and backfills blank English labels on existing ones) --
it has never deleted a row no longer present in that list. Over several
fixes rounds this left the table carrying dead weight: keys with zero
`t(key, ...)` call sites anywhere in the frontend, plus an entire legacy
namespace (`community_checklists.*`, `interactions.*`) left behind after the
fixes25 visit-restructure migration dropped both of those tables and moved
the same data onto `visit_history`.

This migration deletes exactly those 70 now-unreferenced rows (verified via
a full-codebase audit, cross-checked against every dynamic `t(\`prefix.${x}\`)`
construction site so nothing still in use is touched). Downgrade re-inserts
them with their pre-deletion default label text -- if an admin had since
customized any of these specific labels via the Translations page, that
customization is not recoverable by the downgrade (translation copy only,
not business data; a period backup exists separately for anything beyond
that).
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, Sequence[str], None] = "a0b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (entity_type, technical_name, hebrew_label, english_label) -- exactly the
# rows removed from seed.py's LOCALIZATION list in the same fixes38d round.
REMOVED_ROWS = [
    ("table", "users", "משתמשים", "Users"),
    ("table", "community_checklists", "מבצעים", "Mivtzoim"),
    ("table", "interactions", "אינטראקציות", "Interactions"),
    ("column", "buildings.longitude", "קו אורך", "Longitude"),
    ("column", "buildings.latitude", "קו רוחב", "Latitude"),
    ("column", "significant_dates.is_set_reminder", "האם לשלוח תזכורת", "Send a reminder"),
    ("column", "users.username", "שם משתמש", "Username"),
    ("column", "users.role", "תפקיד", "Role"),
    ("column", "interactions.category", "קטגוריה", "Category"),
    ("column", "interactions.note", "הערה", "Note"),
    ("column", "interactions.created_at", "נוצר בתאריך", "Created at"),
    ("column", "community_checklists.tefillin", "תפילין", "Tefillin"),
    ("column", "community_checklists.tefillin_notes", "הערה תפילין", "Tefillin note"),
    ("column", "community_checklists.tzedakah", "צדקה", "Tzedakah"),
    ("column", "community_checklists.charity_note", "הערה צדקה", "Tzedakah note"),
    ("column", "community_checklists.shabbat_candles", "נרות", "Shabbat candles"),
    ("column", "community_checklists.shabbat_candles_notes", "הערה נרות", "Candles note"),
    ("column", "community_checklists.torah_pamphlet", "עלון", "Torah pamphlet"),
    ("column", "community_checklists.torah_pamphlet_notes", "הערה עלון", "Pamphlet note"),
    ("column", "community_checklists.torah_thought", "דבר תורה", "Torah thought"),
    ("column", "community_checklists.torah_letter", "אות בספר", "Letter in a Torah"),
    ("column", "community_checklists.letter_torah_notes", "הערה אות בספר", "Letter note"),
    ("interaction_category", "heart_connection", "חיבור לב", "Heart connection"),
    ("interaction_category", "recommendation", "המלצה", "Recommendation"),
    ("interaction_category", "background", "רקע", "Background"),
    ("nav", "nav.visits", "ביקורים", "Visits"),
    ("action", "action.save_changes", "שמור שינויים", "Save changes"),
    ("action", "common.yes", "כן", "Yes"),
    ("action", "common.no", "לא", "No"),
    ("action", "common.none_dash", "—", "—"),
    ("auth", "auth.google_failed", "התחברות עם Google נכשלה", "Google sign-in failed"),
    ("auth", "signup.create", "צור חשבון", "Create account"),
    ("auth", "signup.google_hint", "הרשמה מהירה עם Google — די למלא שם ארגון בלבד.", "Quick sign-up with Google — just fill in an organization name."),
    ("auth", "signup.org_required_for_google", "יש למלא שם ארגון לפני ההרשמה עם Google", "Please enter an organization name before signing up with Google"),
    ("auth", "signup.check_email_title", "בדוק את האימייל שלך", "Check your email"),
    ("auth", "signup.resend_link", "שליחת הקישור מחדש", "Resend the link"),
    ("page", "page.show_details", "הצג פרטים ומפה", "Show details & map"),
    ("page", "page.hide_details", "הסתר פרטים", "Hide details"),
    ("page", "page.hide_shluchim", "הסתר פעילים", "Hide activists"),
    ("page", "page.org_settings", "הגדרות ארגון", "Organization settings"),
    ("auth", "signup.sent_to", "שלחנו קישור אימות אל", "We sent a verification link to"),
    ("auth", "signup.click_to_activate", "יש ללחוץ על הקישור כדי להפעיל את חשבון הארגון.", "Click the link to activate your organization account."),
    ("apt", "apt.no_apartments", "אין דירות עדיין.", "No apartments yet."),
    ("apt", "apt.add_building_apartment", "הוסף בניין ודירה", "Add a building and apartment"),
    ("apt", "apt.to_link_shliach", "כדי לשייך לפעיל.", "to assign to an activist."),
    ("apt", "apt.search_placeholder", "חפש דירה לפי שם דירה או בניין…", "Search by apartment or building name…"),
    ("int", "int.category_placeholder", "קטגוריה…", "Category…"),
    ("int", "int.add_note_placeholder", "הוסף הערה…", "Add a note…"),
    ("int", "int.none", "אין אינטראקציות עדיין.", "No interactions yet."),
    ("shliach", "shliach.add_area_first", "נא להוסיף אזור קודם", "Please add an area first"),
    ("shliach", "shliach.select_area_first", "יש לבחור אזור תחילה", "Select an area first"),
    ("shliach", "shliach.no_buildings_in_area", "אין בניינים באזורים שנבחרו.", "No buildings in the selected areas."),
    ("pl", "pl.add_list", "הוספת רשימת בחירה", "Add picklist"),
    ("ai", "ai.title", "תאום דיגיטלי", "Digital twin"),
    ("ai", "ai.intro", "שאל את התאום הדיגיטלי שאלות על הקריירה שלי.", "Ask the digital twin questions about my career."),
    ("users", "users.status_active", "פעיל", "Active"),
    ("filter", "filter.by_building", "סנן לפי בניין:", "Filter by building:"),
    ("pl", "pl.group_apartment", "דירה", "Apartment"),
    ("pl", "pl.group_general", "אנשי קשר", "Contacts"),
    ("filter", "filter.mitzvot_only", "רק עם מבצעים", "Mivtzoim only"),
    ("filter", "filter.areas_multi", "אזורים", "Areas"),
    ("filter", "filter.buildings_multi", "בניינים", "Buildings"),
    ("column", "contacts.area", "אזור", "Area"),
    ("admin", "admin.deps_interactions", "אינטראקציות שנוצרו: {n}", "Interactions created: {n}"),
    ("table", "report_number", "מספר דוח", "Report number"),
    ("visits", "visits.details", "פרטי ביקור", "Visit details"),
    ("visits", "visits.extra_fields", "שדות נוספים", "Extra fields"),
    ("cf", "cf.visit_fields", "שדות ביקור מובנים", "Built-in visit fields"),
    ("cf", "cf.visit_fields_intro", "שדה מוסתר לא יופיע בטופסי הביקור, בכרטיסי הביקור או באפשרויות הסינון.", "A hidden field disappears from the visit forms, visit cards and filter options."),
    ("pl", "pl.group_visit", "ביקורים", "Visits"),
]


def upgrade() -> None:
    conn = op.get_bind()
    keys = [row[1] for row in REMOVED_ROWS]
    conn.execute(
        sa.text(
            'DELETE FROM field_localization WHERE technical_name = ANY(:keys)'
        ),
        {"keys": keys},
    )


def downgrade() -> None:
    conn = op.get_bind()
    table = sa.table(
        "field_localization",
        sa.column("guid", sa.String),
        sa.column("entity_type", sa.String),
        sa.column("technical_name", sa.String),
        sa.column("hebrew_label", sa.Text),
        sa.column("english_label", sa.Text),
    )
    conn.execute(
        table.insert(),
        [
            {
                "guid": str(uuid.uuid4()),
                "entity_type": entity,
                "technical_name": key,
                "hebrew_label": he,
                "english_label": en,
            }
            for entity, key, he, en in REMOVED_ROWS
        ],
    )
