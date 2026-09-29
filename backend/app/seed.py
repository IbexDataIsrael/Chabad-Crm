"""Idempotent database seeding (multi-tenant).

- `seed_localization`  — global Hebrew UI labels (no org).
- `provision_org`      — seed a single org's picklists (+ default region). Used on
                          email verification (Phase 8) and for the demo org.
- `seed_all`           — global labels + a demo organization with admin + sample data.
"""
import datetime
import logging

from sqlalchemy.orm import Session

from app import custom_field_utils, models, picklist_utils
from app.config import settings
from app.core.security import hash_password
from app.picklist_utils import MULTI_VALUE_PICKLIST_FIELDS, PICKLIST_FIELDS

logger = logging.getLogger("app.seed")

# (entity_type, technical_name, hebrew_label, english_label) — global UI strings.
# entity_type groups them ('table'/'column'/'interaction_category'/'nav'/'action'/
# 'auth'/'page'/'msg'/'field'). technical_name is the key used by the frontend `t()`.
LOCALIZATION: list[tuple[str, str, str, str]] = [
    ("table", "contacts", "אנשי קשר", "Contacts"),
    ("table", "areas", "אזורים", "Areas"),
    ("table", "buildings", "בניינים", "Buildings"),
    ("table", "apartments", "דירות", "Apartments"),
    ("table", "significant_dates", "תאריכים חשובים", "Significant dates"),
    ("table", "contact_mekurav", "מקורב", "Mekurav"),
    ("table", "contact_shliach", "פעיל", "Shliach"),
    ("column", "contacts.name", "שם פרטי", "First name"),
    ("column", "contacts.last_name", "שם משפחה", "Last name"),
    ("column", "contacts.phone", "טלפון", "Phone"),
    ("column", "contacts.email", "אימייל", "Email"),
    ("column", "contacts.contact_type", "סוג איש קשר", "Contact type"),
    ("column", "contacts.assigned_user_id", "משויך ל", "Assigned to"),
    ("column", "contacts.address", "כתובת", "Address"),
    ("column", "contacts.latitude", "קו רוחב", "Latitude"),
    ("column", "contacts.longitude", "קו אורך", "Longitude"),
    ("column", "contacts.coordinates", "קואורדינטות", "Coordinates"),
    ("column", "contacts.pipeline_status", "סטטוס", "Status"),
    ("column", "contacts.priority_score", "ציון עדיפות", "Priority score"),
    ("column", "contacts.color_tag", "צבע", "Color"),
    ("column", "contact_mekurav.apartment_id", "דירה", "Apartment"),
    ("column", "contact_mekurav.first_visit", "ביקור ראשון", "First visit"),
    ("column", "contact_mekurav.potential_next_step", "פוטנציאל לצעד", "Potential next step"),
    ("column", "contact_mekurav.recommendations", "המלצות", "Recommendations"),
    ("column", "contact_mekurav.background", "רקע", "Background"),
    ("column", "contact_shliach.notes", "הערות", "Notes"),
    ("column", "areas.area_name", "כותרת", "Title"),
    ("column", "areas.area_notes", "הערות", "Notes"),
    ("column", "areas.area_polygon", "תחום פוליגון", "Polygon boundary"),
    ("column", "buildings.area_id", "אזור", "Area"),
    ("column", "buildings.building_name", "שם בניין", "Building name"),
    ("column", "buildings.building_address", "כתובת בניין", "Building address"),
    ("column", "buildings.building_type", "סוג בניין", "Building type"),
    ("column", "apartments.building_id", "בניין", "Building"),
    # fixes13: the apartment label is its NUMBER (was "כותרת"/"Title"; existing
    # rows are updated by a one-off data fix since re-seeding never overwrites).
    ("column", "apartments.apartment_name", "מספר דירה", "Apartment number"),
    ("column", "apartments.apartment_notes", "הערות", "Notes"),
    ("column", "significant_dates.special_date", "תאריך חשוב", "Significant date"),
    ("column", "significant_dates.hebrew_date", "תאריך עברי", "Hebrew date"),
    ("column", "significant_dates.special_date_type", "סוג תאריך", "Date type"),
    ("column", "significant_dates.special_date_title", "כותרת", "Title"),
    ("column", "users.full_name", "שם מלא", "Full name"),
    # --- Navigation ---
    ("nav", "nav.home", "בית", "Home"),
    ("nav", "nav.contacts", "אנשי קשר", "Contacts"),
    ("nav", "nav.shluchim", "פעילים", "Activists"),
    ("nav", "nav.areas", "אזורים", "Areas"),
    ("nav", "nav.buildings", "בניינים", "Buildings"),
    ("nav", "nav.apartments", "דירות", "Apartments"),
    ("nav", "nav.picklists", "רשימות בחירה", "Picklists"),
    ("nav", "nav.custom_fields", "שדות מותאמים", "Custom fields"),
    ("nav", "nav.localization", "תרגומים", "Translations"),
    # fixes51 §4: admin-only config panel for the Shliach role's Apartments view.
    ("nav", "nav.shliach_config", "הגדרות לתצוגת פעילים", "Configuration for Activist Role"),
    ("nav", "nav.settings", "הגדרות", "Settings"),
    # fixes57 §4: desktop sidebar collapse toggle.
    ("nav", "nav.collapse_sidebar", "צמצם תפריט", "Collapse menu"),
    ("nav", "nav.expand_sidebar", "הצג תפריט", "Expand menu"),
    ("nav", "nav.donations", "תרומות", "Donations"),
    ("nav", "nav.system_admin", "מנהל מערכת", "System admin"),
    # --- System admin (platform superadmin dashboard) ---
    ("admin", "admin.title", "ניהול מערכת", "System administration"),
    ("admin", "admin.subtitle", "כל הארגונים והמשתמשים במערכת.", "All organizations and users in the system."),
    ("admin", "admin.superadmin_only", "עמוד זה מיועד למנהל המערכת בלבד.", "This page is for the system administrator only."),
    ("admin", "admin.no_orgs", "אין ארגונים.", "No organizations."),
    ("admin", "admin.no_users", "אין משתמשים.", "No users."),
    ("admin", "admin.active", "פעיל", "Active"),
    ("admin", "admin.disabled", "מושבת", "Disabled"),
    ("admin", "admin.unverified", "לא מאומת", "Unverified"),
    ("admin", "admin.users", "משתמשים", "users"),
    ("admin", "admin.manage_users", "משתמשים", "Users"),
    ("admin", "admin.hide_users", "הסתר משתמשים", "Hide users"),
    # fixes54 §8: superadmin per-org feature toggles.
    ("admin", "admin.manage_features", "תכונות", "Features"),
    ("admin", "admin.hide_features", "הסתר תכונות", "Hide features"),
    (
        "admin", "admin.feature_cascade_hint",
        "כיבוי תכונה מכבה אוטומטית את כל התכונות שתחתיה.",
        "Turning a feature off automatically turns off everything beneath it.",
    ),
    ("admin", "admin.feature_area_display", "תצוגת אזורים", "Area display"),
    ("admin", "admin.feature_building_display", "תצוגת בניינים", "Building display"),
    ("admin", "admin.feature_apartment_display", "תצוגת דירות", "Apartment display"),
    ("admin", "admin.feature_activist_system", "מערכת פעילים", "Activist system"),
    ("admin", "admin.feature_ai_query", "שאילתת AI", "AI query"),
    (
        "admin", "admin.feature_overridden",
        "כבוי בפועל — תכונת אב כבויה",
        "Effectively off — a parent feature is disabled",
    ),
    ("admin", "admin.impersonate", "התחבר כארגון", "Sign in as org"),
    ("admin", "admin.activate", "הפעל", "Enable"),
    ("admin", "admin.deactivate", "השבת", "Disable"),
    ("admin", "admin.verify", "אמת", "Verify"),
    ("admin", "admin.org_deleted", "הארגון נמחק", "Organization deleted"),
    ("admin", "admin.org_disabled", "הארגון הושבת", "Organization disabled"),
    ("admin", "admin.org_enabled", "הארגון הופעל", "Organization enabled"),
    ("admin", "admin.user_deleted", "המשתמש נמחק", "User deleted"),
    ("admin", "admin.user_verified", "המשתמש אומת", "User verified"),
    ("admin", "admin.user_disabled", "המשתמש הושבת", "User disabled"),
    ("admin", "admin.user_enabled", "המשתמש הופעל", "User enabled"),
    ("admin", "admin.find_user", "חיפוש משתמש לפי אימייל או שם…", "Find a user by email or name…"),
    ("admin", "admin.no_user_matches", "לא נמצאו משתמשים.", "No matching users."),
    ("admin", "admin.new_org", "+ ארגון חדש", "+ New organization"),
    ("admin", "admin.create_org", "צור ארגון", "Create organization"),
    ("admin", "admin.org_created", "הארגון נוצר", "Organization created"),
    ("admin", "admin.admin_name", "שם המנהל", "Admin name"),
    ("admin", "admin.clone", "שכפל", "Clone"),
    ("admin", "admin.clone_org_title", "שכפול ארגון", "Clone organization"),
    ("admin", "admin.clone_org_intro", "יוצר ארגון חדש עם עותק מלא של כל הנתונים — אנשי קשר, ביקורים, דירות, בניינים, רשימות בחירה ועוד. הארגון המקורי לא ישתנה.", "Creates a new organization with a full copy of all its data — contacts, visits, apartments, buildings, picklists, and more. The original organization is never changed."),
    ("admin", "admin.clone_org_confirm", "שכפל ארגון", "Clone organization"),
    ("admin", "admin.org_cloned", "הארגון שוכפל", "Organization cloned"),
    ("admin", "admin.clone_org_limits_title", "הגבלת מספר רשומות (אופציונלי)", "Row limits (optional)"),
    (
        "admin", "admin.clone_org_limits_hint",
        "השאירו ריק כדי לשכפל את כל הרשומות בטבלה. רשומה שמתייחסת לרשומה שלא שוכפלה (כי הוגבלה בטבלה אחרת) תושמט.",
        "Leave a field blank to clone every row in that table. A row referencing something left out by another table's limit is dropped rather than copied broken.",
    ),
    ("admin", "admin.clone_org_limit_visits", "ביקורים", "Visit history"),
    # --- Settings: change password ---
    ("settings", "settings.change_password", "שינוי סיסמה", "Change password"),
    ("settings", "settings.current_password", "סיסמה נוכחית", "Current password"),
    ("settings", "settings.new_password", "סיסמה חדשה", "New password"),
    ("settings", "settings.password_changed", "הסיסמה עודכנה", "Password updated"),
    ("settings", "settings.password_change_failed", "עדכון הסיסמה נכשל", "Password update failed"),
    # --- Visits (top-level entity) ---
    ("visit", "page.visits", "ביקורים", "Visits"),
    ("visit", "page.add_visit", "ביקור חדש", "New visit"),
    ("visit", "page.back_to_visits", "← חזרה לביקורים", "← Back to visits"),
    ("visit", "visit.contact", "איש קשר", "Contact"),
    ("visit", "visit.date", "תאריך", "Date"),
    ("visit", "visit.type", "סוג ביקור", "Visit type"),
    ("visit", "visit.location", "מיקום", "Location"),
    ("visit", "visit.notes", "הערות", "Notes"),
    ("visit", "visit.none", "אין ביקורים עדיין.", "No visits yet."),
    ("visit", "visit.no_contact", "ללא איש קשר", "No contact"),
    ("visit", "visit.add", "הוסף ביקור", "Add visit"),
    ("visit", "visit.search_ph", "חיפוש לפי איש קשר או הערות…", "Search by contact or notes…"),
    ("visit", "visit.delete_confirm", "למחוק ביקור זה?", "Delete this visit?"),
    ("visit", "visit.pick_date", "יש לבחור תאריך", "Please pick a date"),
    # Buildings map.
    ("map", "map.set_key", "להצגת מפה הגדר מפתח Google Maps.", "Set a Google Maps key to show the map."),
    ("buildings", "buildings.view", "הצג בניין »", "View building »"),
    ("buildings", "buildings.none_located", "אין בניינים עם קואורדינטות להצגה על המפה.", "No buildings with coordinates to show on the map."),
    # Header dropdown group labels.
    ("nav", "nav.group.people", "אנשים", "People"),
    ("nav", "nav.group.places", "מקומות", "Places"),
    ("nav", "nav.group.campaigns", "קמפיינים ומשימות", "Campaigns & tasks"),
    ("nav", "nav.group.more", "עוד", "More"),
    # --- Common actions / words ---
    ("action", "action.save", "שמור", "Save"),
    ("action", "action.cancel", "ביטול", "Cancel"),
    ("action", "action.add", "הוסף", "Add"),
    ("action", "action.edit", "ערוך", "Edit"),
    ("action", "action.delete", "מחק", "Delete"),
    ("action", "action.remove", "הסר", "Remove"),
    ("action", "action.back", "חזרה", "Back"),
    ("action", "action.logout", "התנתק", "Log out"),
    ("action", "action.saving", "שומר…", "Saving…"),
    ("action", "action.loading", "טוען…", "Loading…"),
    ("action", "action.retry", "נסה שוב", "Retry"),
    ("action", "action.saved", "נשמר ✓", "Saved ✓"),
    ("action", "common.admin", "מנהל", "Admin"),
    ("action", "common.or", "או", "or"),
    ("action", "lang.toggle", "English", "עברית"),
    # --- Auth (login / signup) ---
    ("auth", "auth.app_title", "מיני CRM", "Mini CRM"),
    ("auth", "auth.login_subtitle", "התחברות למערכת", "Sign in to the system"),
    ("auth", "auth.username", "שם משתמש", "Username"),
    ("auth", "auth.password", "סיסמה", "Password"),
    ("auth", "auth.login", "התחבר", "Sign in"),
    ("auth", "auth.logging_in", "מתחבר…", "Signing in…"),
    ("auth", "auth.no_account", "אין לך חשבון?", "Don't have an account?"),
    ("auth", "auth.open_org_account", "פתיחת חשבון ארגון", "Open an organization account"),
    ("auth", "auth.have_account", "כבר יש לך חשבון?", "Already have an account?"),
    ("auth", "auth.login_link", "התחברות", "Sign in"),
    ("auth", "auth.login_failed", "התחברות נכשלה", "Sign-in failed"),
    ("auth", "auth.verify_email_first", "עליך לאמת את כתובת האימייל לפני ההתחברות.", "You must verify your email address before signing in."),
    ("auth", "auth.your_email", "האימייל שלך", "Your email"),
    ("auth", "auth.resend_verification", "שליחת קישור אימות מחדש", "Resend verification link"),
    ("auth", "auth.google_load_failed", "טעינת ההתחברות עם Google נכשלה", "Failed to load Google sign-in"),
    # fixes14 §feature 1: multi-organization login selection
    ("auth", "auth.select_org_title", "בחירת ארגון", "Choose an organization"),
    ("auth", "auth.select_org_subtitle", "החשבון שלך מקושר למספר ארגונים. יש לבחור לאיזה ארגון להתחבר.", "Your account is linked to several organizations. Choose which one to sign in to."),
    ("auth", "auth.select_org_back", "חזרה להתחברות", "Back to sign-in"),
    ("auth", "signup.title", "פתיחת חשבון ארגון", "Open an organization account"),
    ("auth", "signup.subtitle", "צור ארגון חדש ב-CRM", "Create a new CRM organization"),
    ("auth", "signup.org_name", "שם הארגון", "Organization name"),
    ("auth", "signup.creating", "נרשם…", "Registering…"),
    ("auth", "signup.google_failed", "ההרשמה עם Google נכשלה", "Google sign-up failed"),
    ("auth", "signup.failed", "ההרשמה נכשלה", "Registration failed"),
    # --- Pages / sections ---
    ("page", "page.areas_intro", "אזורים גאוגרפיים עם תחום פוליגון על המפה. השלוחים המכסים כל אזור מוצגים תחתיו.", "Geographic areas with a polygon boundary on the map. The activists covering each area are listed below it."),
    ("page", "page.add_area", "אזור חדש", "New area"),
    ("page", "page.edit_area", "עריכת אזור", "Edit area"),
    ("page", "page.back_to_areas", "← חזרה לאזורים", "← Back to areas"),
    ("page", "page.no_areas", "אין אזורים עדיין.", "No areas yet."),
    ("page", "page.area_has_boundary", "תחום מוגדר", "Boundary set"),
    ("page", "page.area_no_boundary", "ללא תחום", "No boundary"),
    ("page", "page.area_boundary_col", "תחום", "Boundary"),
    # fixes62 §1.2: the Areas table's row-level link was hardcoded Hebrew via
    # its t() fallback because this key was never seeded — English mode fell
    # through to the fallback text regardless of the active language.
    ("page", "page.show_area", "הצג אזור »", "View area »"),
    ("areas", "areas.generate_all_boundaries", "צור תחומים לכל האזורים", "Generate all area boundaries"),
    ("areas", "areas.generate_all_result", "נוצרו תחומים ל-{ok} אזורים ({skipped} דולגו)", "Generated boundaries for {ok} areas ({skipped} skipped)"),
    ("areas", "areas.generate_all_none", "לא ניתן היה ליצור תחומים (אין מספיק בניינים עם קואורדינטות).", "Could not generate any boundaries (not enough buildings with coordinates)."),
    ("areas", "areas.generate_boundary", "צור תחום", "Generate boundary"),
    ("areas", "areas.regenerate_boundary", "צור תחום מחדש", "Regenerate boundary"),
    ("areas", "areas.generate_one_ok", "התחום נוצר בהצלחה", "Boundary generated successfully"),
    ("areas", "areas.generate_one_skipped", "לא ניתן היה ליצור תחום לאזור זה", "Could not generate a boundary for this area"),
    ("page", "page.shluchim", "פעילים", "Activists"),
    ("page", "page.no_shluchim_area", "אין פעילים המכסים אזור זה.", "No activists cover this area."),
    ("page", "page.map_in_english", "השלמת כתובות במפה באנגלית", "Address autocomplete in English"),
    ("page", "page.map_in_english_hint", "כאשר מסומן, הצעות הכתובת מ-Google יוחזרו באנגלית במקום בעברית.", "When checked, Google address suggestions are returned in English instead of Hebrew."),
    ("page", "page.map_default_center", "מרכז ברירת מחדל למפה", "Default map center"),
    ("page", "page.map_center_hint", "נקודת ההתחלה של מפת האזורים (קו רוחב, קו אורך, מרחק תצוגה).", "The areas map's starting point (latitude, longitude, zoom)."),
    ("page", "page.localization_title", "תרגומים", "Translations"),
    ("page", "page.localization_intro", "ערוך את טקסטי הממשק בעברית ובאנגלית.", "Edit the interface texts in Hebrew and English."),
    ("page", "page.localization_reload_hint", "שינויים ייכנסו לתוקף בכל המערכת לאחר רענון הדף.", "Changes take effect across the system after refreshing the page."),
    ("page", "page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).", "You don't have permission for this page (admins only)."),
    # fixes54 §8: superadmin per-org module toggles (Area/Building/Apartment/
    # Activist) — shown when a direct URL visit hits a module the org's
    # superadmin has switched off.
    ("page", "page.module_disabled", "התכונה הזו כבויה עבור הארגון שלך.", "This feature is disabled for your organization."),
    # --- Messages ---
    ("msg", "msg.save_failed", "שמירה נכשלה", "Save failed"),
    ("msg", "msg.saved", "נשמר בהצלחה", "Saved successfully"),
    ("msg", "msg.added", "נוסף בהצלחה", "Added successfully"),
    ("msg", "msg.deleted", "נמחק", "Deleted"),
    ("msg", "msg.hidden", "השדה הוסתר", "Field hidden"),
    ("msg", "msg.shown", "השדה הוצג", "Field shown"),
    ("msg", "msg.load_failed", "טעינה נכשלה", "Load failed"),
    ("msg", "msg.action_failed", "הפעולה נכשלה", "Action failed"),
    ("msg", "msg.delete_area_confirm", "למחוק את האזור?", "Delete this area?"),
    ("msg", "msg.redirecting", "מעביר…", "Redirecting…"),
    ("msg", "msg.invalid_email", "כתובת אימייל לא תקינה", "Invalid email address"),
    # --- Verify email page ---
    ("verify", "verify.title", "אימות אימייל", "Email verification"),
    ("verify", "verify.verifying", "מאמת…", "Verifying…"),
    ("verify", "verify.success", "החשבון אומת בהצלחה! ✓", "Account verified successfully! ✓"),
    ("verify", "verify.redirecting_login", "מעבירים אותך להתחברות…", "Redirecting you to sign in…"),
    ("verify", "verify.login_now", "להתחברות עכשיו", "Sign in now"),
    ("verify", "verify.link_missing", "קישור האימות חסר או שגוי.", "The verification link is missing or invalid."),
    ("verify", "verify.failed", "אימות האימייל נכשל.", "Email verification failed."),
    ("verify", "verify.resend_new", "שליחת קישור אימות חדש", "Send a new verification link"),
    ("verify", "verify.back_to_login", "חזרה להתחברות", "Back to sign in"),
    # --- Signup extras ---
    ("auth", "signup.passwords_no_match", "הסיסמאות אינן תואמות", "Passwords don't match"),
    ("auth", "signup.back_to_login", "חזרה להתחברות", "Back to sign in"),
    ("auth", "signup.verify_password", "אימות סיסמה", "Confirm password"),
    # --- Validation hints ---
    ("field", "validation.phone_hint", "מספר טלפון ישראלי (לדוגמה 052-1234567) או אמריקאי/קנדי (לדוגמה 718-888-9770).", "Israeli (e.g. 052-1234567) or US/Canada (e.g. 718-888-9770) phone number."),
    ("field", "validation.email_hint", "נא להזין כתובת אימייל תקינה, לדוגמה name@example.com", "Please enter a valid email address, e.g. name@example.com"),
    ("field", "validation.password_hint", "הסיסמה חייבת לכלול לפחות 8 תווים, אות גדולה (A-Z), אות קטנה (a-z) ומספר.", "Password must be at least 8 characters with an uppercase letter (A-Z), a lowercase letter (a-z), and a number."),
    ("field", "validation.pw_length", "לפחות 8 תווים", "At least 8 characters"),
    ("field", "validation.pw_upper", "אות גדולה (A-Z)", "Uppercase letter (A-Z)"),
    ("field", "validation.pw_lower", "אות קטנה (a-z)", "Lowercase letter (a-z)"),
    ("field", "validation.pw_digit", "מספר (0-9)", "Number (0-9)"),
    ("field", "field.note_placeholder", "הערה…", "Note…"),
    # --- Contacts list + detail ---
    ("page", "page.add_shliach", "הוסף פעיל", "Add activist"),
    ("page", "page.new_contact", "איש קשר חדש", "New contact"),
    ("page", "page.no_contacts", "אין אנשי קשר עדיין.", "No contacts yet."),
    ("page", "page.contact_not_found", "איש הקשר לא נמצא.", "Contact not found."),
    ("page", "page.back_to_contacts", "← חזרה לאנשי קשר", "← Back to contacts"),
    ("page", "page.back_to_shluchim", "← חזרה לפעילים", "← Back to activists"),
    ("page", "page.contact_details", "פרטי איש קשר", "Contact details"),
    ("page", "page.extra_fields", "שדות נוספים", "Additional fields"),
    ("filter", "filter.all_areas", "כל האזורים", "All areas"),
    ("filter", "filter.all_statuses", "כל הסטטוסים", "All statuses"),
    ("action", "common.name", "שם", "Name"),
    ("action", "action.open_edit", "פתח / עריכה ›", "Open / edit ›"),
    ("column", "contacts.email_for_login", "להתחברות", "for sign-in"),
    ("column", "contact_shliach.report_numbers", "מספרי דוח באחריות הפעיל", "Report numbers covered by the activist"),
    ("column", "contact_shliach.areas", "אזורים באחריות הפעיל", "Areas covered by the activist"),
    ("action", "contacts.shliach_no_login", "פעיל ללא גישת התחברות (ללא אימייל)", "Activist without login access (no email)"),
    ("msg", "msg.delete_contact_confirm", "למחוק את איש הקשר? פעולה זו אינה הפיכה.", "Delete this contact? This action cannot be undone."),
    ("action", "action.create_contact", "צור איש קשר", "Create contact"),
    ("action", "action.done_to_contact", "סיום — מעבר לכרטיס", "Done — go to contact"),
    ("page", "page.contact_created_add_dates", "איש הקשר נוצר. ניתן להוסיף תאריכים חשובים עכשיו:", "Contact created. You can add significant dates now:"),
    # --- Buildings ---
    ("page", "page.add_building", "הוסף בניין", "Add building"),
    ("page", "page.new_building", "בניין חדש", "New building"),
    ("page", "page.edit_building", "עריכת בניין", "Edit building"),
    ("page", "page.need_area_first", "יש להגדיר אזור אחד לפחות לפני הוספת בניין.", "Define at least one area before adding a building."),
    ("page", "page.no_buildings", "אין בניינים להצגה.", "No buildings to show."),
    ("filter", "filter.by_area", "סנן לפי אזור:", "Filter by area:"),
    ("filter", "filter.by_building_type", "סנן לפי סוג בניין:", "Filter by building type:"),
    ("filter", "filter.all", "הכל", "All"),
    ("msg", "msg.delete_building_confirm", "למחוק את הבניין?", "Delete this building?"),
    ("msg", "msg.select_area", "יש לבחור אזור", "Please select an area"),
    # --- Apartment picker / multi-select ---
    ("apt", "apt.add_failed", "הוספת דירה נכשלה", "Failed to add apartment"),
    ("apt", "apt.no_buildings", "אין בניינים עדיין.", "No buildings yet."),
    ("apt", "apt.to_link_apartment", "כדי לשייך דירה.", "to link an apartment."),
    ("apt", "apt.choose_building", "בחר בניין…", "Choose a building…"),
    ("apt", "apt.choose_apartment", "בחר דירה…", "Choose an apartment…"),
    ("apt", "apt.name", "שם דירה", "Apartment name"),
    ("apt", "apt.notes_optional", "הערות (לא חובה)", "Notes (optional)"),
    ("apt", "apt.save_apartment", "שמור דירה", "Save apartment"),
    ("apt", "apt.add_apartment", "הוסף דירה", "Add apartment"),
    ("apt", "apt.no_apartments_page", "אין דירות להצגה.", "No apartments to show."),
    ("apt", "apt.load_failed", "טעינת הדירות נכשלה. נסה שוב.", "Failed to load apartments. Please try again."),
    ("apt", "apt.no_apartments_filtered", "אין דירות התואמות לסינון הנוכחי.", "No apartments match the current filters."),
    ("apt", "apt.filters_set_by_admin", "הסינון הוגדר על ידי מנהל המערכת בהגדרות תצוגת הפעילים.", "This filter was set by your administrator in the activist view settings."),
    ("apt", "apt.no_contact", "ללא איש קשר", "No contact"),
    ("apt", "apt.select_building", "יש לבחור בניין", "Please select a building"),
    ("apt", "apt.new_apartment", "דירה חדשה", "New apartment"),
    ("apt", "apt.associate_contact", "שייך איש קשר קיים (לא חובה)", "Link an existing contact (optional)"),
    ("page", "page.no_shluchim", "אין פעילים עדיין.", "No activists yet."),
    ("page", "page.donations_intro", "היסטורית תרומות. ניתן לשייך תרומה לאיש קשר או להשאיר ללא שיוך.", "Donation history. A donation can be linked to a contact or left unlinked."),
    # --- fixes38 §1.2/§1.3: Summary of Visits report + per-contact section ---
    ("nav", "nav.visit_summary", "סיכום ביקורים", "Summary of Visits"),
    ("visitsummary", "visitsummary.total", 'סה"כ ביקורים: {n}', "Total visits: {n}"),
    ("visitsummary", "visitsummary.scope_all", "הצג את כל הביקורים בארגון", "Show all visits org-wide"),
    ("visitsummary", "visitsummary.none", "אין ביקורים בטווח שנבחר.", "No visits in the selected range."),
    ("visitsummary", "visitsummary.category_empty", "אין רשומות", "No records"),
    # fixes50 §3.1: standing action to view every visitor regardless of date.
    ("visitsummary", "visitsummary.all_dates", "הצג את כל התאריכים", "Show all dates"),
    # --- Visit history ---
    ("visit", "visit.history", "היסטורית ביקורים", "Visit history"),
    # fixes28 §1: the visit row expands to inline editing on click.
    ("visit", "visit.click_to_edit", "לחצו לפתיחה ולעריכה", "Click to open and edit"),
    # fixes50 §2.2: reveal-more control below the default 7-visit list.
    ("visit", "visit.show_more", "הצג עוד ביקורים", "Show more visits"),
    # --- Donations ---
    ("donation", "donation.history", "היסטורית תרומות", "Donation history"),
    ("donation", "donation.add", "הוסף תרומה", "Add donation"),
    ("donation", "donation.none", "אין תרומות עדיין.", "No donations yet."),
    ("donation", "donation.contact", "איש קשר", "Contact"),
    ("donation", "donation.no_contact", "ללא איש קשר", "No contact"),
    ("donation", "donation.date", "תאריך", "Date"),
    ("donation", "donation.amount", "סכום", "Amount"),
    ("donation", "donation.ongoing", "האם הוראת קבע", "Standing order"),
    ("donation", "donation.payments", "מספר תשלומים", "Number of payments"),
    ("donation", "donation.notes", "הערות", "Notes"),
    ("donation", "donation.pick_date", "יש לבחור תאריך", "Please choose a date"),
    ("donation", "donation.delete_confirm", "למחוק תרומה זו?", "Delete this donation?"),
    # Dynamic-picklist field labels on the mekurav form/view.
    ("picklist", "picklist.Jewish_status", "יהדות", "Jewish status"),
    ("picklist", "picklist.affiliation", "השתייכות דתית", "Affiliation"),
    ("picklist", "picklist.language", "שפה", "Language"),
    # fixes51 §3: admin-only field on the shliach (contact_shliach) form.
    (
        "picklist", "picklist.contact_shliach.manager_jewish_status",
        "סטטוס יהדות מנהל", "Manager Jewish status",
    ),
    # --- Significant dates ---
    ("sd", "sd.none", "אין תאריכים חשובים.", "No significant dates."),
    ("sd", "sd.add_date", "הוסף תאריך חשוב", "Add significant date"),
    ("sd", "sd.pick_date", "יש לבחור תאריך", "Please choose a date"),
    ("sd", "sd.reminders_count", "תזכורות", "reminders"),
    ("sd", "sd.send_reminder", "שלח תזכורת", "Send a reminder"),
    ("sd", "sd.email_channel", "אימייל", "Email"),
    ("sd", "sd.add_reminder", "הוסף תזכורת", "Add reminder"),
    ("sd", "sd.offset_at", "בזמן האירוע", "At the time of the event"),
    ("sd", "sd.offset_hour", "שעה לפני", "An hour before"),
    ("sd", "sd.offset_day", "יום לפני", "A day before"),
    ("sd", "sd.offset_week", "שבוע לפני", "A week before"),
    ("msg", "msg.delete_date_confirm", "למחוק תאריך זה?", "Delete this date?"),
    # --- Interactions / maps / dates / address ---
    ("map", "map.open_in_google", "הצג מיקום במפות גוגל ›", "Open location in Google Maps ›"),
    ("addr", "addr.start_typing", "התחל להקליד כתובת…", "Start typing an address…"),
    ("date", "date.pick", "בחר תאריך", "Pick a date"),
    ("action", "action.clear", "נקה", "Clear"),
    ("action", "action.close", "סגור", "Close"),
    # --- New shliach page ---
    ("page", "page.shliach_intro", "פעיל מקבל גישת התחברות למערכת לפי כתובת הדוא״ל, ורואה רק מקורבים בדירות שבאחריותו.", "An activist gets login access by email and sees only mekuravim in the apartments they cover."),
    ("action", "action.create_shliach", "צור פעיל", "Create activist"),
    ("page", "page.fields_title", "ניהול שדות", "Manage fields"),
    ("page", "page.fields_intro", "בחר אילו שדות יופיעו בכרטיס איש הקשר, בטופס וברשימה. שדות שיוסתרו לא יוצגו בשום מקום במערכת.", "Choose which fields appear on the contact card, form and list. Hidden fields are shown nowhere in the system."),
    ("field", "fields.shown", "מוצג", "Shown"),
    ("field", "fields.hidden", "מוסתר", "Hidden"),
    ("field", "fields.manage_custom", "הוספה / מחיקה", "Add / delete"),
    # fixes40 round 2 §3: per-field display order input on dashboard/fields.
    ("field", "fields.order_header", "סדר תצוגה", "Display order"),
    ("field", "fields.order_dup", "כפול", "Duplicate"),
    ("field", "fields.order_dup_hint", "מספר סדר זה כבר בשימוש בסעיף זה", "This order number is already used in this section"),
    # --- User-facing error messages (editable in the localization page) ---
    ("error", "error.no_areas_for_shliach", "נא להוסיף לפחות אזור אחד למערכת", "Please add at least 1 area to the system"),
    # fixes14: shliach login password (set from the contact form)
    ("column", "contact_shliach.password", "סיסמה למערכת (לא חובה)", "System password (optional)"),
    ("column", "contact_shliach.password_hint", "עם סיסמה הפעיל מתחבר עם האימייל והסיסמה; ללא סיסמה — עם Google בלבד. שדה ריק לא משנה סיסמה קיימת.", "With a password the activist signs in with their email and password; without one — Google only. Leaving it blank keeps the current password."),
    # --- Area polygon map ---
    ("apm", "apm.load_failed_hint", "טעינת מפת Google נכשלה — בדוק את מפתח ה-API (הפעלת Maps JavaScript API והרשאת המקור localhost). ניתן להזין GeoJSON ידנית.", "Google Maps failed to load — check the API key (enable Maps JavaScript API and allow the localhost origin). You can enter GeoJSON manually."),
    ("apm", "apm.no_key_hint", "לציור פוליגון אינטראקטיבי הגדר מפתח Google Maps.", "Set a Google Maps key to draw a polygon interactively."),
    ("apm", "apm.loading_map", "טוען מפה…", "Loading map…"),
    ("apm", "apm.draw_click", "לחץ על המפה כדי להוסיף נקודות", "Click the map to add points"),
    ("apm", "apm.draw_close", "כשיש לפחות 3 נקודות, לחץ על הנקודה הראשונה או על «סיום» כדי לסגור את התחום.", "With at least 3 points, click the first point or “Finish” to close the boundary."),
    ("apm", "apm.defined_hint", "התחום מוגדר. ניתן לגרור כל נקודה כדי לעדכן את הצורה, או לצייר מחדש.", "The boundary is set. Drag any point to adjust, or redraw."),
    ("apm", "apm.start_hint", "לחץ «התחל ציור» ואז לחץ על המפה כדי לסמן את גבולות האזור.", "Click “Start drawing”, then click the map to mark the area boundary."),
    ("apm", "apm.boundary_set", "תחום מוגדר", "Boundary set"),
    ("apm", "apm.drawing_mode", "במצב ציור…", "Drawing mode…"),
    ("apm", "apm.no_boundary", "אין תחום", "No boundary"),
    ("apm", "apm.finish", "סיום", "Finish"),
    ("apm", "apm.redraw", "צייר תחום מחדש", "Redraw boundary"),
    ("apm", "apm.start_draw", "התחל ציור", "Start drawing"),
    ("apm", "apm.clear_boundary", "נקה תחום", "Clear boundary"),
    # --- Custom fields page ---
    ("cf", "cf.title", "שדות מותאמים אישית", "Custom fields"),
    ("cf", "cf.intro", "כל שדה הוא תיבת סימון + הערה, ויופיע בטופס הביקור. לדוגמה: מסיבת חנוכה.", "Each field is a checkbox + note logged on each visit. e.g. Hanukkah party."),
    ("cf", "cf.none", "אין שדות מותאמים עדיין.", "No custom fields yet."),
    ("cf", "cf.disabled", "מושבת", "Disabled"),
    ("cf", "cf.activate", "הפעל", "Activate"),
    ("cf", "cf.hard_delete", "מחק לצמיתות", "Delete permanently"),
    ("cf", "cf.hard_delete_confirm", "למחוק לצמיתות את כל הערכים?", "Permanently delete this and all its values?"),
    # fixes48 §1: shown instead of the generic hard-delete confirm above when
    # a usage check finds dependent records — confirming purges that data too.
    ("cf", "cf.dependent_data_confirm", "יש נתונים הקשורים לשדה זה האם למחוק בכל זאת?", "This field has related data. Delete it anyway?"),
    ("cf", "cf.add_failed", "הוספה נכשלה", "Failed to add"),
    ("cf", "cf.add_field", "הוספת שדה", "Add field"),
    ("cf", "cf.key_placeholder", "מפתח (אנגלית) — hanuka_party", "Key (English) — hanuka_party"),
    ("cf", "cf.label_placeholder", "תווית בעברית", "Hebrew label"),
    # --- fixes35: entity/type selectors + select-type options ---
    ("cf", "cf.entity_type", "שייך ל", "Belongs to"),
    ("cf", "cf.field_type", "סוג שדה", "Field type"),
    ("cf", "cf.type.text", "טקסט", "Text"),
    ("cf", "cf.type.number", "מספר", "Number"),
    ("cf", "cf.type.boolean", "תיבת סימון", "Checkbox"),
    ("cf", "cf.type.date", "תאריך", "Date"),
    ("cf", "cf.type.select", "רשימת בחירה", "Select"),
    ("cf", "cf.options", "אפשרויות (רשימת בחירה)", "Options (select list)"),
    ("cf", "cf.option_placeholder", "אפשרות…", "Option…"),
    ("cf", "cf.add_option", "+ אפשרות", "+ Option"),
    ("cf", "cf.options_required", "יש להוסיף לפחות אפשרות אחת", "At least one option is required"),
    ("cf", "cf.manage_visibility", "לניהול הצגה/הסתרה של שדות →", "Manage field visibility →"),
    # --- Picklists page ---
    ("pl", "pl.no_values", "אין ערכים.", "No values."),
    ("pl", "pl.move_up", "הזז למעלה", "Move up"),
    ("pl", "pl.move_down", "הזז למטה", "Move down"),
    ("pl", "pl.deactivate_title", "הסר מהרשימה (השבתה)", "Remove from list (deactivate)"),
    ("pl", "pl.hard_delete_confirm", "למחוק לצמיתות?", "Delete permanently?"),
    ("pl", "pl.hard_delete_in_use", "לא ניתן למחוק לצמיתות — הערך בשימוש על ידי רשומות קיימות. הוא הושבת במקום.", "Can't delete permanently — the value is in use by existing records. It was deactivated instead."),
    ("pl", "pl.add_value", "הוספת ערך", "Add value"),
    ("pl", "pl.value_placeholder", "value (אנגלית)", "value (English)"),
    ("pl", "pl.editor_title", "עריכת תיבת בחירה", "Edit picklists"),
    ("pl", "pl.editor_intro", "ערוך תוויות בעברית ובאנגלית, סדר, צבע, והוסף רשימות חדשות.", "Edit labels in Hebrew and English, order, color, and add new lists."),
    ("pl", "pl.delete_list_confirm", "למחוק רשימה זו וכל הערכים שלה?", "Delete this list and all its values?"),
    ("pl", "pl.system_list", "רשימת מערכת", "System list"),
    ("pl", "pl.delete_list", "מחק רשימה", "Delete list"),
    ("pl", "pl.system_name_placeholder", "מזהה (אנגלית) — diet", "Identifier (English) — diet"),
    # fixes32 §7: dedicated add-picklist forms per dashboard section.
    ("pl", "pl.add_list_contact", "הוספת רשימת בחירה לאיש קשר", "Add picklist to contact"),
    ("pl", "pl.add_list_apartment", "הוספת רשימת בחירה לדירה", "Add picklist to apartment"),
    # --- Global search (header) ---
    ("search", "search.placeholder", "חיפוש כללי: אזור, בניין, דירה, איש קשר…", "Search: area, building, apartment, contact…"),
    ("search", "search.no_results", "לא נמצאו תוצאות", "No results found"),
    ("search", "search.searching", "מחפש…", "Searching…"),
    ("search", "search.group.contacts", "אנשי קשר", "Contacts"),
    ("search", "search.group.areas", "אזורים", "Areas"),
    ("search", "search.group.buildings", "בניינים", "Buildings"),
    ("search", "search.group.apartments", "דירות", "Apartments"),
    # --- AI query (natural language -> data grid) ---
    ("nav", "nav.ai_query", "שאילתת AI", "AI query"),
    ("ai_query", "ai_query.title", "שאילתת AI", "AI query"),
    ("ai_query", "ai_query.intro", "כתבו בקשה בשפה חופשית וקבלו טבלה — למשל \"אנשי קשר בברוקלין עם סטטוס פייבליין X\".", "Type a request in plain language and get a table — e.g. \"contacts in Brooklyn with pipeline status X\"."),
    ("ai_query", "ai_query.placeholder", "מה תרצה לעשות?", "What would you like to do?"),
    ("ai_query", "ai_query.send", "שלח", "Send"),
    ("ai_query", "ai_query.loading", "מריץ שאילתה…", "Running query…"),
    ("ai_query", "ai_query.empty", "עדיין אין תוצאות. כתבו בקשה כדי להתחיל.", "No results yet. Type a request to start."),
    ("ai_query", "ai_query.no_rows", "לא נמצאו תוצאות", "No results found"),
    ("ai_query", "ai_query.error", "השאילתה נכשלה — נסה שוב", "The query failed — try again"),
    ("ai_query", "ai_query.truncated", "מוצגות 200 התוצאות הראשונות בלבד", "Showing the first 200 results only"),
    ("ai_query", "ai_query.results", "תוצאות", "results"),
    # --- fixes7 §1: org user management ---
    ("nav", "nav.users", "משתמשים", "Users"),
    ("users", "users.title", "ניהול משתמשים", "User management"),
    ("users", "users.intro", "הוסף וערוך משתמשים בארגון. מנהל מקבל הרשאות מלאות; משתמש מוגבל רואה אנשי קשר בלבד.", "Add and edit the organization's users. An admin gets full privileges; a restricted user only sees contacts."),
    ("users", "users.add_user", "משתמש חדש", "New user"),
    # fixes43 §5.2: "admin" is more precisely "system admin" — see the
    # LOCALIZATION_RENAMES entry below for existing DB rows.
    ("users", "users.role_admin", "מנהל מערכת", "System admin"),
    ("users", "users.role_staff", "משתמש מוגבל", "Restricted user"),
    ("users", "users.role_shliach", "פעיל", "Activist"),
    ("users", "users.role_label", "תפקיד", "Role"),
    ("users", "users.password_optional", "סיסמה (לא חובה)", "Password (optional)"),
    ("users", "users.google_only_hint", "ללא סיסמה — המשתמש יתחבר עם Google לפי כתובת האימייל המאומתת.", "Without a password the user signs in with Google using their verified email."),
    ("users", "users.manual_user", "משתמש ידני (ללא גישה למערכת)", "Manual user (no system access)"),
    ("users", "users.none", "אין משתמשים.", "No users."),
    ("users", "users.created", "המשתמש נוצר ונשלח אליו מייל קבלת פנים", "User created — a welcome email was sent"),
    ("users", "users.updated", "המשתמש עודכן", "User updated"),
    ("users", "users.deleted", "המשתמש נמחק", "User deleted"),
    # --- fixes47: dashboard/users/{id} detail page ---
    ("users", "users.not_found", "המשתמש לא נמצא.", "User not found."),
    ("users", "users.password_updated", "הסיסמה עודכנה", "Password updated"),
    ("users", "users.delete_confirm", "למחוק את המשתמש?", "Delete this user?"),
    ("users", "users.self_guard", "לא ניתן לשנות או למחוק את עצמך", "You cannot change or delete yourself"),
    ("users", "users.status_disabled", "מושבת", "Disabled"),
    ("users", "users.you", "אני", "me"),
    # --- fixes43 §3.4: bulk-clear area assignments ---
    ("users", "users.clear_assignments", "ניקוי שיבוצים", "Clear assignments"),
    # fixes48 §3: reworded — this action clears report numbers only, not
    # areas (see the LOCALIZATION_RENAMES entry below for existing DB rows).
    ("users", "users.clear_assignments_confirm", "אתה בטוח שברצונך למחוק את כל מספרי הדוח המשויכים לפעילים? פעולה זו בלתי הפיכה", "Are you sure you want to clear all report numbers assigned to activists? This action is irreversible."),
    ("users", "users.no_assignments_to_clear", "אין שיבוצים לניקוי בתצוגה הנוכחית", "No assignments to clear in the current view"),
    ("users", "users.assignments_cleared", "השיבוצים נוקו עבור {n} פעילים", "Assignments cleared for {n} activists"),
    # --- fixes7 §2/§3: buildings, floors ---
    ("buildings", "buildings.floors", "קומות", "Floors"),
    ("buildings", "buildings.num_floors", "מספר קומות", "Number of floors"),
    ("buildings", "buildings.num_floors_hint", "בעת יצירת הבניין ייווצרו קומות 1 עד המספר שנבחר.", "Creating the building auto-creates floors 1 through the chosen number."),
    ("buildings", "buildings.include_lobby", "כלול קומת לובי (L) לפני קומה 1", "Include a lobby floor (L) before floor 1"),
    ("floors", "floors.add", "הוסף קומה", "Add floor"),
    ("floors", "floors.name", "שם קומה", "Floor name"),
    ("floors", "floors.none", "אין קומות בבניין זה.", "No floors in this building."),
    ("floors", "floors.delete_confirm", "למחוק קומה זו?", "Delete this floor?"),
    ("filter", "filter.all_buildings", "כל הבניינים", "All buildings"),
    ("apt", "apt.street_search", "חיפוש לפי שם רחוב…", "Search by street name…"),
    ("apt", "apt.edit_apartment", "עריכת דירה", "Edit apartment"),
    # --- fixes7 §4: apartment fields ---
    ("column", "apartments.floor", "קומה", "Floor"),
    ("column", "apartments.name", "שם דייר", "Resident name"),
    ("column", "apartments.phone", "טלפון", "Phone"),
    ("column", "apartments.email", "אימייל", "Email"),
    ("picklist", "picklist.apartment.Jewish_status", "יהדות", "Jewish status"),
    ("picklist", "picklist.apartment.campaign_status", "סטטוס קמפיין", "Campaign status"),
    ("picklist", "picklist.apartment.mezuzah_status", "מזוזה", "Mezuzah"),
    ("picklist", "picklist.apartment.language", "שפה", "Language"),
    ("table", "building", "בניין", "Building"),
    ("table", "apartment", "דירה", "Apartment"),
    # fixes32 §7: renamed from "כללי"/"General" — the dashboard's two
    # sections are now explicitly Contact vs. Apartment.
    # --- fixes7 §5: bulk apartment generator ---
    ("batch", "batch.open", "יצירה מרובה", "Bulk create"),
    ("batch", "batch.title", "יצירת דירות מרובות", "Bulk apartment generator"),
    ("batch", "batch.intro", "בחר בניין, קומות ותוויות דירה — כל השילובים ייווצרו בבת אחת.", "Pick a building, floors and apartment labels — every combination is created at once."),
    ("batch", "batch.floors", "קומות", "Floors"),
    ("batch", "batch.labels", "מספרי / אותיות דירות", "Apartment numbers / letters"),
    ("batch", "batch.add_label", "הוסף", "Add"),
    ("batch", "batch.label_placeholder", "לדוגמה A או 1", "e.g. A or 1"),
    ("batch", "batch.no_floors", "לבניין זה אין קומות. הוסף קומות בעריכת הבניין.", "This building has no floors. Add floors by editing the building."),
    ("batch", "batch.create", "צור דירות", "Create apartments"),
    ("batch", "batch.select_all", "בחר הכל", "Select all"),
    ("batch", "batch.result", "נוצרו {created} דירות ({skipped} דולגו — קיימות)", "Created {created} apartments ({skipped} skipped — already exist)"),
    ("batch", "batch.pick_floor_label", "יש לבחור לפחות קומה אחת ותווית אחת", "Pick at least one floor and one label"),
    # --- fixes8: apartment sorting + pagination ---
    ("sort", "sort.label", "מיון:", "Sort:"),
    ("sort", "sort.floor", "קומה", "Floor"),
    ("sort", "sort.by_label", "תווית דירה", "Apartment label"),
    ("sort", "sort.resident", "שם דייר", "Resident name"),
    ("sort", "sort.building", "בניין", "Building"),
    (
        "sort", "sort.hierarchy",
        "היררכיה (מס׳ דוח ← בניין ← קומה)", "Hierarchy (Report # → Building → Floor)",
    ),
    ("sort", "sort.asc", "עולה", "Ascending"),
    ("sort", "sort.desc", "יורד", "Descending"),
    ("pager", "pager.prev", "→ הקודם", "← Previous"),
    ("pager", "pager.next", "הבא ←", "Next →"),
    ("pager", "pager.range", "{from}–{to} מתוך {total}", "{from}–{to} of {total}"),
    (
        "pager", "pager.range_buildings",
        "בניינים {from}–{to} מתוך {total}", "Buildings {from}–{to} of {total}",
    ),
    ("pager", "pager.page_size", "בעמוד:", "Per page:"),
    # --- fixes9: admin areas + mekurav fields + system title settings ---
    # fixes59 §4: rebranded "אזור מנהל"/"Admin area" -> "אזור מותאם אישית"/
    # "Custom area" (see LOCALIZATION_RENAMES below for already-seeded orgs).
    ("nav", "nav.admin_areas", "אזור מותאם אישית", "Custom area"),
    ("page", "page.admin_areas_title", "אזורים מותאמים אישית", "Custom areas"),
    ("page", "page.add_admin_area", "אזור מותאם אישית חדש", "New custom area"),
    ("page", "page.edit_admin_area", "עריכת אזור מותאם אישית", "Edit custom area"),
    ("page", "page.no_admin_areas", "אין אזורים מותאמים אישית להצגה.", "No custom areas to show."),
    ("msg", "msg.delete_admin_area_confirm", "למחוק את האזור המותאם אישית?", "Delete this custom area?"),
    ("column", "admin_areas.name", "שם", "Name"),
    ("column", "admin_areas.comments", "הערות", "Comments"),
    ("column", "contact_mekurav.admin_area_id", "אזור מותאם אישית", "Custom area"),
    ("column", "contact_mekurav.tzedaka_potential", "פוטנציאל לצדקה", "Tzedaka potential"),
    ("admin", "admin.system_settings_title", "הגדרות מערכת", "System settings"),
    ("admin", "admin.system_settings_intro", "תבנית כותרת הדפדפן לכל העמודים ושם ברירת מחדל כשאין שם ארגון.", "The browser-title template for all pages, and the default name when no organization name exists."),
    ("admin", "admin.title_template", "תבנית כותרת המערכת", "System title template"),
    ("admin", "admin.title_template_hint", "{public.organizations.name} יוחלף בשם הארגון.", "{public.organizations.name} is replaced with the organization's name."),
    ("admin", "admin.fallback_name", "שם זמני / ברירת מחדל", "Temporary / fallback name"),
    # --- fixes10: two-step org deletion ---
    ("admin", "admin.delete_org_title", "מחיקת ארגון", "Delete organization"),
    ("admin", "admin.delete_org_warning", "האם אתה בטוח שברצונך למחוק את הארגון וכל הנתונים שלו? פעולה זו אינה הפיכה.", "Are you sure you want to delete this organization and all of its data? This action is irreversible."),
    ("admin", "admin.delete_org_type_to_confirm", "לאישור, הקלד את שם הארגון במדויק (או DELETE):", "To confirm, type the organization's exact name (or DELETE):"),
    ("admin", "admin.delete_org_confirm", "מחק לצמיתות", "Delete permanently"),
    # --- fixes11: shliach header suffix + contacts owner filter/sort ---
    ("header", "header.shliach_display_suffix", "תצוגת פעילים", "Activists view"),
    ("filter", "filter.by_assigned", "משויך ל:", "Assigned to:"),
    ("filter", "filter.all_users", "כל המשתמשים", "All users"),
    ("sort", "sort.created", "תאריך יצירה", "Creation date"),
    ("sort", "sort.by_name", "שם", "Name"),
    ("apt", "apt.none_covered", "אין דירות משויכות אליך.", "No apartments are assigned to you."),
    ("column", "contacts.created_at", "נוצר בתאריך", "Created on"),
    ("buildings", "buildings.coords_hint", "פורמט: longitude,latitude — לדוגמה 35.2137,31.7683", "Format: longitude,latitude — e.g. 35.2137,31.7683"),
    # fixes30 §3: inline address editing rejects an empty value.
    ("buildings", "buildings.address_required", "יש להזין כתובת", "Address is required"),
    # --- fixes12: previously-unseeded strings + new routes/modal ---
    ("page", "page.show_apartments", "הצג דירות", "Show apartments"),
    ("page", "page.hide_apartments", "הסתר דירות", "Hide apartments"),
    ("apt", "apt.delete_confirm", "למחוק את הדירה?", "Delete this apartment?"),
    ("confirm", "confirm.title", "אישור פעולה", "Confirm action"),
    ("action", "action.confirm", "אישור", "Confirm"),
    ("page", "page.back_to_building", "← חזרה לבניין", "← Back to building"),
    ("page", "page.edit_building_full", "עריכת בניין ודירות", "Edit building & apartments"),
    ("apt", "apt.new_apartment_title", "דירה חדשה", "New apartment"),
    ("page", "page.back_to_apartments", "← חזרה לדירות", "← Back to apartments"),
    # --- fixes7 §7: areas map + geofence ---
    ("areas", "areas.map_all", "מפת האזורים", "Areas map"),
    ("areas", "areas.view_area", "הצג אזור »", "View area »"),
    ("geo", "geo.outside_area_warning", "אזהרה: הכתובת שנבחרה נמצאת מחוץ לתחום האזור שנבחר!", "Warning: the chosen address is outside the selected area's boundary!"),
    ("geo", "geo.save_anyway", "שמור בכל זאת", "Save anyway"),
    ("geo", "geo.check_hint", "בדוק את הכתובת או בחר אזור אחר.", "Check the address or pick a different area."),
    # --- fixes15: filters / columns / quick actions / superadmin modals ---
    ("filter", "filter.search_contacts", "חיפוש לפי שם, טלפון או אימייל…", "Search by name, phone or email…"),
    ("filter", "filter.n_selected", "{n} נבחרו", "{n} selected"),
    ("filter", "filter.search_name", "חיפוש לפי שם…", "Search by name…"),
    ("filter", "filter.clear", "נקה סינון", "Clear filters"),
    # fixes29 §1: header toggle for the whole filter section.
    ("filter", "filter.show_filters", "הצג סינון", "Show filters"),
    ("filter", "filter.hide_filters", "הסתר סינון", "Hide filters"),
    # fixes29 urgents: one-click reset when active filters empty the list.
    ("filter", "filter.clear_all", "נקה את כל הסינונים", "Clear all filters"),
    # fixes57 §2: the "-" option offered on filters whose value can be blank.
    ("filter", "filter.empty_option", "- (ריק)", "- (empty)"),
    (
        "page",
        "page.no_contacts_filtered",
        "לא נמצאו אנשי קשר התואמים לסינון הפעיל.",
        "No contacts match the active filters.",
    ),
    ("columns", "columns.configure", "התאמת עמודות", "Customize columns"),
    ("columns", "columns.title", "עמודות מוצגות", "Visible columns"),
    ("columns", "columns.hint", "בחר אילו עמודות יוצגו בטבלה. ההעדפה נשמרת בדפדפן זה.", "Choose which columns the table shows. Saved in this browser."),
    ("columns", "columns.reset", "איפוס ברירת מחדל", "Reset to defaults"),
    ("columns", "columns.reorder_hint", "גרור עמודה פעילה כדי לשנות את סדר ההצגה.", "Drag an active column to change the display order."),
    ("columns", "columns.fields_configure", "התאמת שדות", "Customize fields"),
    ("column", "contacts.building", "בניין", "Building"),
    ("action", "action.call", "חיוג", "Call"),
    ("action", "action.whatsapp", "וואטסאפ", "WhatsApp"),
    ("action", "action.send_email", "שליחת מייל", "Send email"),
    # fixes38 §3.1: Manage Fields toggle labels for the quick-action icons.
    ("column", "contacts.action_call", "כפתור חיוג טלפוני", "Phone call button"),
    ("column", "contacts.action_whatsapp", "כפתור וואטסאפ", "WhatsApp button"),
    ("column", "contacts.action_email", "כפתור שליחת מייל", "Email button"),
    ("action", "action.bulk_email", "מייל לכל התוצאות", "Email all results"),
    ("msg", "msg.no_emails_in_list", "אין כתובות אימייל ברשימה המסוננת.", "No email addresses in the filtered list."),
    ("sort", "sort.address", "כתובת", "Address"),
    ("sort", "sort.area", "אזור", "Area"),
    ("page", "page.shliach_details", "פרטי פעיל", "Activist details"),
    ("admin", "admin.delete_user_title", "מחיקת משתמש", "Delete user"),
    ("admin", "admin.confirm_sure", "בטוח ?", "Are you sure?"),
    ("admin", "admin.deps_intro", "למשתמש זה קיימים נתונים מקושרים במערכת:", "This user has connected data in the system:"),
    ("admin", "admin.deps_none", "אין נתונים מקושרים למשתמש זה.", "No connected data for this user."),
    ("admin", "admin.deps_assigned_contacts", "אנשי קשר משויכים: {n}", "Assigned contacts: {n}"),
    ("admin", "admin.deps_shliach_contact", "מקושר לכרטיס פעיל: {name}", "Linked activist card: {name}"),
    ("admin", "admin.deps_report_numbers", "מספרי דוח באחריות: {n}", "Report numbers covered: {n}"),
    ("admin", "admin.deps_areas", "אזורים באחריות: {n}", "Areas covered: {n}"),
    ("admin", "admin.deps_note", "בעת המחיקה השיוכים יוסרו והנתונים יישארו ללא משתמש מקושר.", "On deletion the links are removed; the data remains without a linked user."),
    ("admin", "admin.template.shliach_welcome", "מייל קבלת פנים (פעיל / משתמש חדש)", "Welcome email (new activist / user)"),
    ("editor", "editor.visual", "עיצוב", "Visual"),
    ("editor", "editor.html", "HTML", "HTML"),
    ("editor", "editor.bold", "מודגש", "Bold"),
    ("editor", "editor.italic", "נטוי", "Italic"),
    ("editor", "editor.underline", "קו תחתון", "Underline"),
    ("editor", "editor.link", "קישור", "Link"),
    ("editor", "editor.list", "רשימה", "List"),
    ("editor", "editor.link_prompt", "כתובת הקישור:", "Link URL:"),
    ("editor", "editor.image", "תמונה", "Image"),
    # --- fixes56 §2: announcement image picker ---
    ("image_picker", "image_picker.title", "בחר תמונה", "Choose an image"),
    ("image_picker", "image_picker.upload_new", "העלה תמונה חדשה", "Upload new image"),
    ("image_picker", "image_picker.none", "אין עדיין תמונות שמורות — העלה תמונה חדשה.", "No saved images yet — upload one."),
    ("image_picker", "image_picker.load_failed", "טעינת התמונות נכשלה", "Failed to load images"),
    ("image_picker", "image_picker.upload_failed", "העלאת התמונה נכשלה", "Image upload failed"),
    # --- fixes16: backup & restore ---
    ("backup", "backup.title", "גיבוי ושחזור", "Backup & restore"),
    ("backup", "backup.intro", "צור נקודת שחזור של נתוני הארגון, ושחזר אליה אם משהו השתבש. נשמרות עד 10 נקודות; חשבונות המשתמשים אינם חלק מהגיבוי.", "Create a restore point of your organization's data and restore to it if something goes wrong. Up to 10 points are kept; user accounts are not part of the backup."),
    ("backup", "backup.create", "צור גיבוי", "Create backup"),
    ("backup", "backup.note_ph", "הערה (לא חובה) — לדוגמה: לפני ייבוא", "Note (optional) — e.g. before import"),
    ("backup", "backup.created", "הגיבוי נוצר", "Backup created"),
    ("backup", "backup.create_failed", "יצירת הגיבוי נכשלה", "Backup failed"),
    ("backup", "backup.none", "אין נקודות שחזור עדיין.", "No restore points yet."),
    ("backup", "backup.restore", "שחזר", "Restore"),
    ("backup", "backup.download", "הורדה", "Download"),
    ("backup", "backup.kind_auto", "אוטומטי", "Automatic"),
    ("backup", "backup.contacts_n", "{n} אנשי קשר", "{n} contacts"),
    ("backup", "backup.restore_title", "שחזור נתונים", "Restore data"),
    ("backup", "backup.restore_warning", "כל נתוני הארגון הנוכחיים יוחלפו בנתוני נקודת השחזור הזו. נקודת שחזור אוטומטית של המצב הנוכחי תיווצר לפני השחזור, כך שניתן לבטל.", "All of the organization's current data will be replaced with this restore point. An automatic restore point of the current state is created first, so this can be undone."),
    ("backup", "backup.restored", "השחזור הושלם", "Restore completed"),
    ("backup", "backup.restore_failed", "השחזור נכשל — הנתונים לא שונו", "Restore failed — the data was not changed"),
    # --- fixes17: mitzvot/tzedaka filters + apartments table ---
    ("filter", "filter.all_mitzvot", "מבצעים", "Mivtzoim"),
    ("filter", "filter.tzedaka_ph", "פוטנציאל לצדקה…", "Tzedaka potential…"),
    ("column", "apartments.contact", "איש קשר", "Contact"),
    # --- fixes18: logo + map-hint strings that rendered from hardcoded fallbacks ---
    ("logo", "signup.org_logo", "לוגו הארגון", "Organization logo"),
    ("logo", "logo.alt", "לוגו הארגון", "Organization logo"),
    ("logo", "logo.upload", "העלה לוגו", "Upload logo"),
    ("logo", "logo.upload_failed", "העלאת הלוגו נכשלה", "Logo upload failed"),
    ("logo", "logo.uploading", "מעלה לוגו…", "Uploading logo…"),
    ("settings", "settings.map_pick_hint", "לחץ על המפה כדי לבחור את מרכז ברירת המחדל, או גרור את הסמן לכוונון.", "Click the map to pick the default center, or drag the marker to fine-tune."),
    # --- fixes18: searchable selects ---
    ("select", "select.search_ph", "הקלד לחיפוש…", "Type to search…"),
    ("select", "select.no_matches", "אין תוצאות", "No matches"),
    # --- fixes18: contacts filters ---
    ("filter", "filter.all_tzedaka", "כל פוטנציאל לצדקה", "All tzedaka potentials"),
    ("filter", "filter.all_admin_areas", "כל האזורים המותאמים אישית", "All custom areas"),
    ("filter", "filter.all_jewish", "כל סטטוסי היהדות", "All Jewish statuses"),
    ("filter", "filter.all_mezuzah", "כל סטטוסי המזוזה", "All mezuzah statuses"),
    ("filter", "filter.all_languages", "כל השפות", "All languages"),
    # --- fixes18: area detail — add-activist / add-building dropdowns ---
    ("areas", "areas.add_activist_pick", "בחר פעיל להוספה…", "Pick an activist to add…"),
    ("areas", "areas.add_building_pick", "בחר בניין להוספה…", "Pick a building to add…"),
    ("areas", "areas.no_eligible_buildings", "אין בניינים בתוך תחום האזור.", "No buildings inside the area boundary."),
    ("areas", "areas.no_polygon_for_buildings", "לאזור אין תחום מוגדר — הגדר תחום כדי לבחור בניינים לפי מיקום.", "The area has no boundary — draw one to pick buildings by location."),
    ("areas", "areas.create_new_shliach", "או צור פעיל חדש »", "Or create a new activist »"),
    ("areas", "areas.create_new_building", "או צור בניין חדש »", "Or create a new building »"),
    ("areas", "areas.activist_added", "הפעיל נוסף לאזור", "Activist added to the area"),
    ("areas", "areas.building_added", "הבניין שויך לאזור", "Building assigned to the area"),
    # --- fixes18: shliach contacts-visibility permission ---
    ("page", "page.shliach_view_contacts", "פעילים רשאים לצפות באנשי קשר", "Activists may view contacts"),
    ("page", "page.shliach_view_contacts_hint", "כאשר כבוי (ברירת המחדל), משתמשי פעיל אינם רואים את רשימת אנשי הקשר.", "When off (the default), activist users do not see the contacts list."),
    # --- fixes40 §4: global field-label text styling ---
    ("page", "page.label_styling", "עיצוב טקסט תוויות שדות", "Field label text styling"),
    ("page", "page.label_styling_hint", "משפיע על תוויות השדות בכל המערכת. השאירו ריק לשימוש בעיצוב ברירת המחדל.", "Affects field labels across the system. Leave blank to use the default styling."),
    ("page", "page.label_font_size", "גודל גופן", "Font size"),
    ("page", "page.label_color", "צבע", "Color"),
    ("page", "page.label_font_family", "גופן", "Font"),
    ("page", "page.label_default", "ברירת מחדל", "Default"),
    ("page", "page.label_reset", "איפוס", "Reset"),
    # --- fixes19: report numbers (מספר דוח) ---
    ("column", "report_number.name", "שם", "Name"),
    ("nav", "nav.report_numbers", "מספרי דוח", "Report numbers"),
    ("page", "page.report_numbers", "מספרי דוח", "Report numbers"),
    ("page", "page.report_numbers_intro", "ניהול מספרי הדוח של הארגון — משמשים לשיוך דירות ופעילים.", "Manage the organization's report numbers — used to associate apartments and activists."),
    ("report", "report.add", "מספר דוח חדש", "New report number"),
    ("report", "report.none", "אין מספרי דוח עדיין.", "No report numbers yet."),
    ("report", "report.name_ph", "שם / מספר…", "Name / number…"),
    ("report", "report.delete_confirm", "למחוק את מספר הדוח? השיוכים לדירות ולפעילים יוסרו.", "Delete this report number? Its apartment and activist links will be removed."),
    # --- fixes53 §3: calculated columns + activist link + grid controls ---
    ("report", "report.jews_count", "מספר יהודים", "Number of Jews"),
    ("report", "report.engaged_jews_count", "מספר יהודים מעוניינים", "Number of engaged Jews"),
    ("report", "report.activist_name", "שם הפעיל", "Activist name"),
    ("report", "report.no_activist", "אין פעיל משויך", "No activist assigned"),
    ("report", "report.view_apartments", "הצג דירות", "View apartments"),
    ("action", "action.actions", "פעולות", "Actions"),
    ("column", "apartments.report_number_id", "מספר דוח", "Report number"),
    ("apt", "apt.choose_report_number", "בחר מספר דוח…", "Pick a report number…"),
    ("filter", "filter.all_report_numbers", "כל מספרי הדוח", "All report numbers"),
    # --- fixes19: apartment edit history ---
    ("apt", "apt.history", "היסטוריית שינויים", "Edit history"),
    ("apt", "apt.history_pick", "בחר גרסה קודמת…", "Pick a previous version…"),
    ("apt", "apt.history_none", "אין גרסאות קודמות.", "No previous versions."),
    ("apt", "apt.history_snapshot", "תצוגת גרסה היסטורית (לקריאה בלבד)", "Historical version (read-only)"),
    ("apt", "apt.history_back_current", "חזרה לגרסה הנוכחית", "Back to the current version"),
    ("apt", "apt.history_unknown_editor", "עורך לא ידוע", "Unknown editor"),
    # fixes22 §2: per-field restore from history.
    ("apt", "apt.restore", "שחזר", "Restore"),
    ("apt", "apt.restore_hint", "לחץ \"שחזר\" ליד שדה כדי להחזיר את ערכו לגרסה זו.", "Click \"Restore\" next to a field to roll its value back to this version."),
    ("apt", "apt.field_restored", "השדה שוחזר", "Field restored"),
    # --- fixes19: town houses ---
    ("column", "buildings.is_town_house", "בית פרטי", "Town house"),
    ("buildings", "buildings.town_house_hint", "בבית פרטי לא נוצרות קומות — נוצרת דירה אחת אוטומטית.", "A town house gets no floors — a single unit is created automatically."),
    # --- fixes19 §5: the mekurav layout-area visibility switch ---
    ("column", "contact_mekurav.section", "אזור פרטי מקורב (כל המקטע)", "Mekurav details area (whole section)"),
    # --- fixes23 §1/§2: multi-select search filter + apartment filters ---
    ("filter", "filter.n_of_total", "{n}/{total}", "{n}/{total}"),
    ("filter", "filter.select_all_shown", "בחר את המוצגים", "Select shown"),
    ("filter", "filter.search_buildings", "חיפוש בניין…", "Search building…"),
    ("filter", "filter.search_report_numbers", "חיפוש מספר דוח…", "Search report number…"),
    # --- fixes43 §4.1: searchable area/report-number pickers on the shliach form ---
    ("filter", "filter.search_areas", "חיפוש אזור…", "Search area…"),
    ("contact_shliach", "contact_shliach.no_areas_selected", "לא נבחרו אזורים", "No areas selected"),
    ("contact_shliach", "contact_shliach.no_report_numbers_selected", "לא נבחרו מספרי דוח", "No report numbers selected"),
    # --- fixes43 §4.2/4.3: area/report-number reassignment conflict warnings ---
    ("contact_shliach", "contact_shliach.area_conflict_warning", "האזור הזה משוייך לפעיל אחר, האם ברצונך לשייך כאן פעיל נוסף?", "This area is assigned to another operator. Do you want to assign another operator here?"),
    ("contact_shliach", "contact_shliach.report_number_conflict_warning", "מספר דוח הזה משוייך לפעיל אחר, האם ברצונך לשייך כאן פעיל נוסף?", "This report number is assigned to another operator. Do you want to assign another operator here?"),
    # --- fixes43 §3.1: shliach coverage edit-history ---
    ("contact_shliach", "contact_shliach.history", "היסטוריית שינויים", "Edit history"),
    # --- fixes47: Users-page area/report-number save confirmation toasts ---
    ("contact_shliach", "contact_shliach.areas_saved", "האזורים נשמרו", "Areas saved"),
    ("contact_shliach", "contact_shliach.report_numbers_saved", "מספרי הדוח נשמרו", "Report numbers saved"),
    # --- fixes48 §4: per-field restore (mirrors apt.field_restored) ---
    ("contact_shliach", "contact_shliach.field_restored", "השדה שוחזר", "Field restored"),
    # --- fixes23 §3: apartments bulk editing ---
    ("bulkedit", "bulkedit.open", "עריכה מרובה", "Bulk edit"),
    ("bulkedit", "bulkedit.open_hint", "עריכה מרובה של כל הדירות המסוננות", "Bulk-edit all filtered apartments"),
    ("bulkedit", "bulkedit.title", "עריכה מרובה של דירות", "Bulk edit apartments"),
    ("bulkedit", "bulkedit.intro", "השינויים יחולו על כל {total} הדירות התואמות לסינון הנוכחי.", "Changes apply to all {total} apartments matching the current filters."),
    ("bulkedit", "bulkedit.set_report", "עדכן מספר דוח", "Update report number"),
    ("bulkedit", "bulkedit.choose_report", "בחר מספר דוח…", "Choose report number…"),
    ("bulkedit", "bulkedit.clear_hint", "השאר ריק כדי להסיר את מספר הדוח מהדירות.", "Leave empty to clear the report number from the apartments."),
    ("bulkedit", "bulkedit.set_notes", "עדכן הערות", "Update notes"),
    ("bulkedit", "bulkedit.pick_field", "יש לבחור לפחות שדה אחד לעדכון", "Select at least one field to update"),
    ("bulkedit", "bulkedit.apply", "החל שינויים", "Apply changes"),
    ("bulkedit", "bulkedit.result", "{n} דירות עודכנו", "{n} apartments updated"),
    # --- fixes43 §1: contacts bulk "Assigned To" editing ---
    ("bulkedit", "bulkedit.contacts_title", "עריכה מרובה של אנשי קשר", "Bulk edit contacts"),
    ("bulkedit", "bulkedit.contacts_intro", "השינויים יחולו על כל {total} אנשי הקשר התואמים לסינון הנוכחי.", "Changes apply to all {total} contacts matching the current filters."),
    ("bulkedit", "bulkedit.contacts_result", "{n} אנשי קשר עודכנו", "{n} contacts updated"),
    # --- fixes24: reports menu + create-reports page (PDF) ---
    ("reports", "reports.menu_title", "דוחות", "Reports"),
    ("reports", "reports.create_reports", "יצירת דוחות", "Create Reports"),
    ("reports", "reports.report_numbers", "מספרי דוחות", "Report Numbers"),
    ("reports", "reports.select_reports_placeholder", "בחר מספר דוח אחד או יותר", "Select one or more report numbers"),
    ("reports", "reports.generate_pdf", "הפק דוח PDF", "Generate PDF Report"),
    ("reports", "reports.floor", "קומה", "Floor"),
    ("reports", "reports.apartment_name", "מספר דירה", "Apartment Number"),
    ("reports", "reports.jewish_status", "מצב יהדות", "Jewish Status"),
    ("reports", "reports.mezuzah_status", "מזוזה", "Mezuzah Status"),
    ("reports", "reports.language", "שפה", "Language"),
    ("reports", "reports.apartment_notes", "הערות", "Notes"),
    ("reports", "reports.no_data", "לא נמצאו נתונים עבור הדוחות שנבחרו", "No data found for the selected reports"),
    ("reports", "reports.pdf_title", "דוח ריכוז דירות", "Apartment Summary Report"),
    # fixes69 §Admin4a: the report number's own area(s), under its PDF header.
    ("reports", "reports.pdf_area_label", "אזור {name}", "Area {name}"),
    ("reports", "reports.pdf_footer", "דוח #{id} · עמוד {page} מתוך {total}", "Report #{id} · Page {page} of {total}"),
    # --- fixes38 §4.2/§4.3: report column customization toolbar ---
    ("reports", "reports.column_config_title", "עמודות הדוח", "Report columns"),
    ("reports", "reports.column_subheading", "כותרת משנה", "Subheading"),
    ("reports", "reports.column_width", "רוחב (%)", "Width (%)"),
    ("reports", "reports.column_width_total", "סך הכל: {n}%", "Total: {n}%"),
    ("reports", "reports.no_columns_selected", "לא נבחרו עמודות", "No columns selected"),
    (
        "field",
        "validation.report_width_over_100",
        "סך הרוחב של העמודות אינו יכול להיות יותר ממאה אחוז",
        "The total width should not be over 100%",
    ),
    # --- fixes25: VISITS namespace (visit-level Mivtzoim / interactions / fields) ---
    # fixes39: the per-flag rows (visits.tefillin / visits.tzedakah /
    # visits.shabbat_candles / visits.torah_pamphlet / visits.letter_in_torah /
    # visits.connection_to_rebbe) are gone — those are now ordinary custom
    # fields whose hebrew_label/english_label live directly on the
    # CustomFieldDefinition row (see seed_visit_mivtzoim_custom_fields), not
    # in this localization table.
    ("visits", "visits.mivtzoim", "מבצעים", "Mivtzoim"),
    ("visits", "visits.torah_thought", "דבר תורה", "Torah thought"),
    ("visits", "visits.interactions", "אינטראקציות", "Interactions"),
    ("visits", "visits.no_interactions", "אין אינטראקציות עדיין.", "No interactions yet."),
    ("visits", "visits.add_interaction", "הוסף", "Add"),
    ("visits", "visits.interaction_category_ph", "קטגוריה…", "Category…"),
    ("visits", "visits.interaction_note_ph", "הוסף הערה…", "Add a note…"),
    ("visits", "visits.date_range", "טווח תאריכי ביקור", "Visit date range"),
    ("visits", "visits.date_from", "מתאריך", "From"),
    ("visits", "visits.date_to", "עד תאריך", "To"),
    # fixes50 §1.1: field_registry.py label_key rows for the Fields page.
    ("visits", "visits.location", "מיקום", "Location"),
    ("visits", "visits.visit_type", "סוג ביקור", "Visit type"),
    # --- fixes25 §5: bilingual names for the system picklists (the backend
    # registry labels are Hebrew-only, so English mode showed Hebrew) ---
    ("picklist_def", "picklist_def.contact.contact_type", "סוג איש קשר", "Contact type"),
    ("picklist_def", "picklist_def.contact.pipeline_status", "סטטוס", "Status"),
    ("picklist_def", "picklist_def.contact.color_tag", "צבע", "Color"),
    ("picklist_def", "picklist_def.contact.potential_next_step", "פוטנציאל לצעד", "Potential next step"),
    ("picklist_def", "picklist_def.checklist.torah_thought", "דבר תורה", "Torah thought"),
    ("picklist_def", "picklist_def.interaction.category", "קטגוריה", "Category"),
    ("picklist_def", "picklist_def.visit.type", "סוג ביקור", "Visit type"),
    ("picklist_def", "picklist_def.significant_date.type", "סוג תאריך", "Date type"),
    ("picklist_def", "picklist_def.Jewish_status", "יהדות", "Jewish status"),
    ("picklist_def", "picklist_def.affiliation", "השתייכות דתית", "Religious affiliation"),
    ("picklist_def", "picklist_def.language", "שפה", "Language"),
    ("picklist_def", "picklist_def.apartment.Jewish_status", "יהדות (דירה)", "Jewish status (apartment)"),
    ("picklist_def", "picklist_def.apartment.campaign_status", "סטטוס קמפיין", "Campaign status"),
    ("picklist_def", "picklist_def.apartment.mezuzah_status", "מזוזה", "Mezuzah"),
    ("picklist_def", "picklist_def.apartment.language", "שפה", "Language"),
    # fixes51 §3: dedicated Picklists-dashboard tab entry.
    (
        "picklist_def", "picklist_def.contact_shliach.manager_jewish_status",
        "סטטוס יהדות מנהל", "Manager Jewish status",
    ),
    # fixes68 §B2/B3.
    ("picklist_def", "picklist_def.visit.door_outcome", "תוצאת דלת", "Door outcome"),
    ("common", "common.hebrew_label", "עברית", "Hebrew"),
    ("common", "common.english_label", "English", "English"),
    # fixes48 §3: boolean custom-field column filter (Users page).
    ("common", "common.yes", "כן", "Yes"),
    ("common", "common.no", "לא", "No"),
    ("common", "common.none", "ללא", "None"),
    # --- fixes26: inline editing, visit view mode, shliach login recovery ---
    ("action", "action.view", "הצג", "View"),
    ("inline", "inline.click_to_edit", "לחץ לעריכה", "Click to edit"),
    ("field", "validation.name_required", "יש להזין שם פרטי", "First name is required"),
    ("field", "validation.phone_invalid", "מספר טלפון לא תקין", "Invalid phone number"),
    ("shliach", "contact_shliach.password_set", "קבע סיסמה חדשה", "Set a new password"),
    ("users", "users.login_suspended", "הכניסה למערכת הושעתה", "System access is suspended"),
    # fixes54 §1: is_active toggle on the user detail page.
    ("users", "users.login_status", "סטטוס כניסה", "Login status"),
    ("users", "users.recreate_user", "צור משתמש מחדש", "Re-create user"),
    ("users", "users.user_recreated", "המשתמש נוצר מחדש", "The user was re-created"),
    # --- fixes27: visit-level contact filters + visit-field visibility ---
    ("filter", "filter.all_torah_thoughts", "דבר תורה", "Torah thought"),
    ("filter", "filter.rebbe_ph", "קשר לרבי…", "Connection to the Rebbe…"),
    # --- fixes30 (round 2): building grouping, segment order, apartment reports,
    # shliach Maps navigation ---
    ("apt", "apt.group_by_building", "קיבוץ לפי בניין", "Group by building"),
    ("apt", "apt.group_count", "{n} דירות", "{n} apartments"),
    ("apt", "apt.grouping_sort_hint", "בזמן קיבוץ לפי בניין המיון קבוע לפי בניין", "While grouping, sorting is fixed to building"),
    ("apt", "apt.hierarchy_sort_hint", "מיון היררכיה תמיד עולה", "Hierarchy sort is always ascending"),
    ("apt", "apt.navigate", "ניווט בגוגל מפות", "Navigate in Google Maps"),
    ("contact", "contact.segment_main", "תצוגה עיקרית של איש קשר", "Main contact view"),
    ("contact", "contact.field_locked", "שדה זה נעול לעריכה עצמית", "This field is locked for self-editing"),
    ("contact", "contact.edit_your_data", "עריכת המידע שלך", "Edit your data"),
    # --- fixes53 §7/§9: activist report-completion + system-comment log ---
    ("shliach_msg", "shliach_msg.report_completed_btn", "דיווח על השלמת הדוח", "Report completed"),
    ("shliach_msg", "shliach_msg.system_comment_btn", "הערות על המערכת", "Comments about the system"),
    ("shliach_msg", "shliach_msg.submitted", "הדיווח נשלח, תודה!", "Submitted, thank you!"),
    ("shliach_msg", "shliach_msg.status_completed", "דוח הושלם", "Report completed"),
    ("shliach_msg", "shliach_msg.status_not_completed", "דוח לא הושלם", "Report not completed"),
    ("shliach_msg", "shliach_msg.status_partial", "דוח הושלם חלקית", "Report partially completed"),
    ("shliach_msg", "shliach_msg.comments", "הערות", "Comments"),
    ("shliach_msg", "shliach_msg.comment_ph", "מה תרצה לספר לנו?", "What would you like to tell us?"),
    ("action", "action.submit", "שלח", "Submit"),
    ("nav", "nav.messages_from_activists", "הודעות מהפעילים", "Messages from activists"),
    (
        "messages_from_activists", "messages_from_activists.intro",
        "דיווחי השלמת דוחות והערות על המערכת שנשלחו על ידי פעילים.",
        "Report-completion submissions and system feedback sent by activists.",
    ),
    (
        "messages_from_activists", "messages_from_activists.no_completions",
        "אין דיווחי השלמה עדיין.", "No completion reports yet.",
    ),
    (
        "messages_from_activists", "messages_from_activists.no_comments",
        "אין הערות על המערכת עדיין.", "No system comments yet.",
    ),
    ("contact", "contact.display_order", "סדר תצוגה", "Display order"),
    ("contact", "contact.display_order_hint", "קבע את סדר הקטעים בכרטיס איש הקשר. ההעדפה נשמרת בחשבון שלך.", "Set the order of the contact card's sections. The preference is saved to your account."),
    ("action", "action.move_up", "העלה", "Move up"),
    ("action", "action.move_down", "הורד", "Move down"),
    ("reports", "reports.mode_by_report", "לפי מספרי דוח", "By report numbers"),
    ("reports", "reports.mode_by_apartments", "לפי בחירת דירות", "By selected apartments"),
    ("reports", "reports.select_apartments_placeholder", "בחר דירה אחת או יותר", "Select one or more apartments"),
    ("filter", "filter.search_apartments", "חיפוש דירה…", "Search apartment…"),
    # --- fixes33 §2: area deletion cascade choice ---
    ("areas", "areas.delete_has_buildings_confirm", "לאזור זה יש בניינים. האם למחוק את הבניינים?", "This area has buildings. Do you wish to delete the buildings?"),
    ("areas", "areas.delete_cascade_buildings", "מחק בניינים ודירות", "Delete buildings and apartments"),
    ("areas", "areas.delete_keep_buildings", "השאר בניינים (בטל שיוך לאזור)", "Keep buildings (unassign from area)"),
    ("msg", "msg.delete_failed", "מחיקה נכשלה", "Delete failed"),
    # --- fixes33 §3.2: create report from filtered apartments results ---
    ("apt", "apt.create_report_from_filters", "צור דוח מהתוצאות המסוננות", "Create report from filtered results"),
    ("reports", "reports.mode_by_filters", "לפי סינון נוכחי", "By current filter"),
    ("reports", "reports.filters_mode_hint", "הדוח יופק מהדירות התואמות לסינון שהוגדר בעמוד הדירות.", "The report will be generated from the apartments matching the filter set on the Apartments page."),
    # --- fixes33 §3.1: toggleable custom picklist columns ---
    ("columns", "columns.custom_picklists_hint", "עמודות רשימת בחירה מותאמות אישית — ניתן להסתיר כל אחת בנפרד.", "Custom picklist columns — each can be hidden individually."),
    # --- fixes33 §4: picklists dashboard 3-tab reorg ---
    ("pl", "pl.tab_contacts", "אנשי קשר", "Contacts"),
    ("pl", "pl.tab_visit", "ביקורים", "Visits"),
    ("pl", "pl.tab_apartment", "דירה", "Apartment"),
    ("pl", "pl.add_list_visit", "הוספת רשימת בחירה לביקור", "Add picklist to visit"),
    # fixes51 §3: dedicated shliach tab (manager_jewish_status + any future
    # contact_shliach-scoped admin picklist).
    ("pl", "pl.tab_shliach", "פעילים", "Activists"),
    ("pl", "pl.add_list_shliach", "הוספת רשימת בחירה לפעיל", "Add picklist to activist"),
    ("pl", "pl.add_list_task", "הוספת רשימת בחירה למשימה", "Add picklist to task"),
    # --- fixes51 §4: Shliach Role Configuration Panel ---
    ("shliach_config", "shliach_config.title", "הגדרות לתצוגת פעילים", "Configuration for Activist Role"),
    (
        "shliach_config", "shliach_config.intro",
        "שולט על תצוגת הדירות שרואים משתמשי פעיל — עריכה, סינון ועמודות ברירת מחדל.",
        "Controls the Apartments view activist users see — editing, filtering, and default columns.",
    ),
    ("shliach_config", "shliach_config.disable_edit", "בטל אפשרות עריכה לפעילים", "Disable editing for activists"),
    ("shliach_config", "shliach_config.hide_filters", "הסתר את כל הסינונים מהפעילים", "Hide all filters from activists"),
    # fixes54 §6: "Edit Lock" — which Apartment fields an activist can't
    # inline-edit, separate from the self-profile locks renamed just below.
    ("shliach_config", "shliach_config.apartment_edit_locks", "נעילת שדות לעריכה (דירות)", "Edit lock (apartment fields)"),
    (
        "shliach_config", "shliach_config.apartment_edit_locks_hint",
        "סמן שדות דירה שפעילים לא יוכלו לערוך בעצמם. ללא סימון — כל השדות ניתנים לעריכה "
        "(אלא אם \"בטל אפשרות עריכה\" מסומן למעלה).",
        "Check apartment fields activists may not edit themselves. Unchecked — every field stays "
        "editable (unless \"Disable editing\" above is checked).",
    ),
    (
        "shliach_config", "shliach_config.customize_fields_locked",
        "נעל את אפשרות \"התאמת שדות\" — הסתר אותה לגמרי מהפעילים",
        "Lock \"Customize fields\" — hide it entirely from activists",
    ),
    # fixes54 §6: renamed from "נעילת שדות לעריכה עצמית" — that generic label
    # read as being about the apartment-edit locks above; this section is
    # actually about the activist's own contact profile (name/phone/notes).
    ("shliach_config", "shliach_config.self_edit_locks", "נעילת שדות בפרופיל האישי של הפעיל", "Activist's own-profile field locks"),
    (
        "shliach_config", "shliach_config.self_edit_locks_hint",
        "אימייל, אזורים ומספרי דוח נעולים תמיד בעריכה עצמית. סמן שדות נוספים לנעילה.",
        "Email, areas and report numbers are always locked in self-edit. Check any additional fields to lock.",
    ),
    ("shliach_config", "shliach_config.default_filters", "סינון ברירת מחדל", "Default filter"),
    (
        "shliach_config", "shliach_config.default_filters_hint",
        "הסינון שבו תיפתח תצוגת הדירות עבור פעילים.",
        "The filter the Apartments view opens with for activists.",
    ),
    # fixes59 §2a: live count of apartments matching the default filter above.
    (
        "shliach_config", "shliach_config.matching_apartments",
        "{n} דירות תואמות את הסינון הזה", "{n} apartments match this filter",
    ),
    # fixes59 §2b: shown when saving a default filter that would exclude an
    # area/building an activist is currently individually assigned to.
    (
        "shliach_config", "shliach_config.filter_conflict_warning",
        ".האזור/הבניין שייך לפעיל קיים", "The area/building has an activist assigned to it.",
    ),
    ("shliach_config", "shliach_config.default_columns", "עמודות ברירת מחדל", "Default columns"),
    (
        "shliach_config", "shliach_config.default_columns_hint",
        "כאשר כבוי, פעילים מתחילים מברירת המחדל הכללית של המערכת. פעיל יכול תמיד להתאים אישית "
        "את העמודות שלו דרך \"התאמת שדות\" בעמוד הדירות.",
        "When off, activists start from the system's general default. An activist can always "
        "customize their own columns via \"Customize Fields\" on the Apartments page.",
    ),
    # --- fixes33 §6/§7: report notes setting + PDF header ---
    ("settings", "settings.report_notes", "הערות לדוח", "Report notes"),
    ("settings", "settings.report_notes_hint", "טקסט חופשי שיופיע בראש כל דוח שמופק (הבהרה, כותרת, הערת שוליים...)", "Free text shown at the top of every generated report (disclaimer, header, footer note...)"),
    # --- fixes38d: hardcoded-Hebrew audit — DatePicker month/weekday names,
    # previously rendered from local constant arrays with no t() involved. ---
    ("date", "date.month.jan", "ינואר", "January"),
    ("date", "date.month.feb", "פברואר", "February"),
    ("date", "date.month.mar", "מרץ", "March"),
    ("date", "date.month.apr", "אפריל", "April"),
    ("date", "date.month.may", "מאי", "May"),
    ("date", "date.month.jun", "יוני", "June"),
    ("date", "date.month.jul", "יולי", "July"),
    ("date", "date.month.aug", "אוגוסט", "August"),
    ("date", "date.month.sep", "ספטמבר", "September"),
    ("date", "date.month.oct", "אוקטובר", "October"),
    ("date", "date.month.nov", "נובמבר", "November"),
    ("date", "date.month.dec", "דצמבר", "December"),
    ("date", "date.weekday.sun", "א", "Su"),
    ("date", "date.weekday.mon", "ב", "Mo"),
    ("date", "date.weekday.tue", "ג", "Tu"),
    ("date", "date.weekday.wed", "ד", "We"),
    ("date", "date.weekday.thu", "ה", "Th"),
    ("date", "date.weekday.fri", "ו", "Fr"),
    ("date", "date.weekday.sat", "ש", "Sa"),
    # --- fixes38d: hardcoded-Hebrew audit — Translations admin page's
    # section headings, previously a raw (unlocalized) lookup object. ---
    ("loc", "loc.entity.error", "הודעות שגיאה", "Error messages"),
    ("loc", "loc.entity.msg", "הודעות מערכת", "System messages"),
    ("loc", "loc.entity.table", "טבלאות", "Tables"),
    ("loc", "loc.entity.column", "שדות", "Fields"),
    ("loc", "loc.entity.page", "דפים", "Pages"),
    ("loc", "loc.entity.nav", "ניווט", "Navigation"),
    ("loc", "loc.entity.action", "פעולות", "Actions"),
    ("loc", "loc.entity.auth", "התחברות", "Login"),
    ("loc", "loc.entity.field", "ניהול שדות", "Field management"),
    ("loc", "loc.entity.filter", "סינון", "Filters"),
    ("loc", "loc.entity.apt", "דירות", "Apartments"),
    ("loc", "loc.entity.apm", "מפת אזורים", "Area map"),
    ("loc", "loc.entity.shliach", "פעיל", "Activist"),
    ("loc", "loc.entity.verify", "אימות", "Verification"),
    ("loc", "loc.entity.signup", "הרשמה", "Signup"),
    ("loc", "loc.entity.interaction_category", "קטגוריות אינטראקציה", "Interaction categories"),
    # --- fixes42: visit-summary "Show All Records", merged Users/Shluchim ---
    ("filter", "filter.show_all_records", "הצג את כל הרשומות", "Show All Records"),
    ("filter", "filter.all_roles", "כל התפקידים", "All roles"),
    ("users", "users.show_inactive", "הצג משתמשים לא פעילים", "Show inactive users"),
    ("users", "users.role_updated", "התפקיד עודכן", "Role updated"),
    ("users", "users.login_missing", "אין כניסה למערכת", "No system login"),
    # --- fixes44 §4: picklists page surfaces non-select custom fields (e.g.
    # the Mivtzoim booleans + "קשר לרבי") centrally, alongside real picklists. ---
    ("pl", "pl.custom_fields_section", "שדות (לא רשימת בחירה)", "Fields (non-list)"),
    (
        "pl",
        "pl.custom_fields_hint",
        "שדות אלו (תיבת סימון, טקסט, מספר או תאריך — למשל \"קשר לרבי\") אינם רשימת ערכים אלא שדה בודד; מוצגים כאן לניהול מרוכז. הוספת שדה חדש מתבצעת בדף שדות מותאמים אישית.",
        "These fields (checkbox, text, number, or date — e.g. \"Connection to the Rebbe\") aren't option lists but single fields; shown here for central management. Add a new one from the Custom Fields page.",
    ),
    ("pl", "pl.go_to_custom_fields", "מעבר לדף שדות מותאמים אישית ←", "Go to the Custom Fields page →"),
    # --- fixes52 §2.2/§2.4: apartments custom-field filters + building-group
    # collapse toggle ---
    ("filter", "filter.yes", "כן", "Yes"),
    ("filter", "filter.no", "לא", "No"),
    ("filter", "filter.empty", "ריק", "Empty"),
    (
        "filter", "filter.empty_hint",
        "הצג רק דירות ללא ערך בשדה זה", "Show only apartments with no value in this field",
    ),
    ("action", "action.expand", "הרחב", "Expand"),
    ("action", "action.collapse", "כווץ", "Collapse"),
    # --- fixes54 §4: messages-from-activists search + pagination ---
    (
        "messages_from_activists", "messages_from_activists.search_ph",
        "חיפוש לפי שם פעיל, סטטוס או תוכן…", "Search by activist name, status, or content…",
    ),
    (
        "messages_from_activists", "messages_from_activists.no_results",
        "לא נמצאו תוצאות התואמות לחיפוש.", "No results match the search.",
    ),
    ("pager", "pager.page_of", "עמוד {page} מתוך {total}", "Page {page} of {total}"),
    # --- fixes54 §5: shliach-config activist announcements (WYSIWYG CRUD) ---
    ("shliach_config", "shliach_config.announcements_title", "הודעות לפעילים", "Announcements to activists"),
    (
        "shliach_config", "shliach_config.announcements_hint",
        "הודעות אלו מוצגות לפעילים בעמוד הבית שלהם, כאשר הן פעילות.",
        "These messages are shown to activists on their home page, while active.",
    ),
    ("shliach_config", "shliach_config.announcement_add", "הודעה חדשה", "New announcement"),
    ("shliach_config", "shliach_config.announcement_delete_confirm", "למחוק את ההודעה?", "Delete this announcement?"),
    ("shliach_config", "shliach_config.announcements_none", "אין הודעות עדיין.", "No announcements yet."),
    ("shliach_config", "shliach_config.announcement_visible", "מוצגת", "Visible"),
    ("shliach_config", "shliach_config.announcement_hidden", "מוסתרת", "Hidden"),
    ("shliach_config", "shliach_config.announcement_title_field", "כותרת ההודעה", "Announcement title"),
    ("shliach_config", "shliach_config.announcement_content", "תוכן ההודעה", "Announcement content"),
    ("shliach_config", "shliach_config.announcement_visible_toggle", "מוצגת לפעילים", "Visible to activists"),
    ("shliach_config", "shliach_config.announcement_title_required", "יש להזין כותרת", "A title is required"),
    # --- fixes54 §6.1: dedicated activist landing page ---
    ("activist_home", "activist_home.title", "ברוך הבא", "Welcome"),
    (
        "activist_home", "activist_home.intro",
        "עמוד הבית שלך — הפעולות והעדכונים שלך במקום אחד.",
        "Your home page — your actions and updates in one place.",
    ),
    ("activist_home", "activist_home.edit_profile", "עריכת הפרטים שלי", "Edit my details"),
    ("activist_home", "activist_home.edit_profile_hint", "עדכן את הפרטים האישיים שלך", "Update your personal details"),
    ("activist_home", "activist_home.my_apartments", "הדירות שלי", "My apartments"),
    (
        "activist_home", "activist_home.my_apartments_count",
        "{n} דירות משויכות", "{n} assigned apartments",
    ),
    ("activist_home", "activist_home.announcements", "עדכונים", "Announcements"),
    ("activist_home", "activist_home.no_announcements", "אין עדכונים כרגע.", "No announcements right now."),
    # Admin dashboard home page (chat-originated, no fixesN spec).
    ("dashboard", "dashboard.title", "לוח בקרה", "Dashboard"),
    (
        "dashboard", "dashboard.subtitle",
        "סקירה כללית של הפעילות במערכת", "An overview of recent system activity",
    ),
    ("dashboard", "dashboard.range_label", "ב-{n} הימים האחרונים", "In the last {n} days"),
    ("dashboard", "dashboard.stat.new_contacts", "אנשי קשר חדשים", "New contacts"),
    ("dashboard", "dashboard.stat.new_apartments", "דירות חדשות", "New apartments"),
    ("dashboard", "dashboard.stat.activist_activity", "פעילות פעילים", "Activist activity"),
    (
        "dashboard", "dashboard.stat.jewish_changes",
        "שינויים בסטטוס יהדות", "Jewish-status changes",
    ),
    (
        "dashboard", "dashboard.stat.vs_previous",
        "לעומת התקופה הקודמת", "vs. previous period",
    ),
    (
        "dashboard", "dashboard.chart.growth_title",
        "גידול באנשי קשר ודירות", "Contact & apartment growth",
    ),
    (
        "dashboard", "dashboard.chart.top_activists_title",
        "פעילים מובילים", "Top activists",
    ),
    (
        "dashboard", "dashboard.chart.top_activists_subtitle",
        "עדכוני דירות לפי פעיל", "Apartment updates by activist",
    ),
    (
        "dashboard", "dashboard.chart.jewish_breakdown_title",
        "התפלגות שינויי סטטוס יהדות", "Jewish-status change breakdown",
    ),
    (
        "dashboard", "dashboard.recent_changes_title",
        "שינויים אחרונים בסטטוס יהדות", "Recent Jewish-status changes",
    ),
    (
        "dashboard", "dashboard.recent_changes_empty",
        "אין שינויים בטווח התאריכים הזה.", "No changes in this date range.",
    ),
    (
        "dashboard", "dashboard.no_activity",
        "אין פעילות פעילים בטווח התאריכים הזה.", "No activist activity in this date range.",
    ),
    ("dashboard", "dashboard.changed_by", "שונה ע\"י {name}", "Changed by {name}"),
    ("dashboard", "dashboard.edits_count", "{n} עדכונים", "{n} updates"),
    ("dashboard", "dashboard.view_all", "צפייה בהכל", "View all"),
    (
        "dashboard", "dashboard.coming_soon",
        "בקרוב: קמפיינים ומשימות", "Coming soon: campaigns & tasks",
    ),

    # --- fixes58: Campaign & Task entities ---
    ("nav", "nav.campaigns", "קמפיינים", "Campaigns"),
    ("nav", "nav.tasks", "משימות", "Tasks"),
    ("users", "users.role_campaign_manager", "מנהל קמפיינים", "Campaign manager"),
    ("page", "page.campaigns_title", "קמפיינים", "Campaigns"),
    ("page", "page.add_campaign", "קמפיין חדש", "New campaign"),
    ("page", "page.no_campaigns", "אין קמפיינים להצגה.", "No campaigns to show."),
    ("msg", "msg.delete_campaign_confirm", "למחוק את הקמפיין?", "Delete this campaign?"),
    ("campaign", "campaign.name", "שם", "Name"),
    ("campaign", "campaign.is_active", "פעיל", "Active"),
    ("campaign", "campaign.custom_stats_text", "טקסט סטטיסטיקה", "Stats text"),
    (
        "campaign", "campaign.custom_stats_text_hint",
        "טקסט שיוצג בעמוד הבית של הפעיל. אפשר להשתמש בתגית {{count}} — תוחלף במספר "
        "מספרי הדוח הפעילים תחת המשימות הפעילות של הקמפיין. לדוגמה: "
        "\"{{count}} יהודים קיבלו חנוכייה\".",
        "Text shown on the activist's homepage. Use the {{count}} tag — replaced with "
        "the number of report numbers currently active under this campaign's active "
        "tasks. e.g. \"{{count}} Jews received a Menorah\".",
    ),
    # fixes71 §B: campaigns grid + detail page + per-campaign field visibility.
    ("campaign", "campaign.created_at", "תאריך יצירה", "Created"),
    (
        "campaign", "campaign.activate_confirm",
        "הפעלת הקמפיין הזה תכבה כל קמפיין פעיל אחר. להמשיך?",
        "Activating this campaign will turn off every other active campaign. Continue?",
    ),
    (
        "campaign", "campaign.is_active_hint",
        "קמפיין אחד בלבד יכול להיות פעיל. הפעלתו מכבה אוטומטית כל קמפיין אחר.",
        "Only one campaign can be active at a time. Activating it automatically turns off any other.",
    ),
    ("campaign", "campaign.field_visibility", "שדות דירה גלויים לפעילים", "Apartment fields visible to activists"),
    (
        "campaign", "campaign.field_visibility_hint",
        "סמן שדות דירה שהפעילים יראו במסלול שלהם כשהקמפיין הזה פעיל. בטל סימון כדי להסתיר שדה.",
        "Check apartment fields activists should see on their route while this campaign is active. Uncheck a field to hide it.",
    ),
    ("campaign", "campaign.not_found", "הקמפיין לא נמצא.", "Campaign not found."),
    ("page", "page.tasks_title", "משימות", "Tasks"),
    ("page", "page.add_task", "משימה חדשה", "New task"),
    ("page", "page.no_tasks", "אין משימות להצגה.", "No tasks to show."),
    ("msg", "msg.delete_task_confirm", "למחוק את המשימה?", "Delete this task?"),
    ("task", "task.campaign", "קמפיין", "Campaign"),
    ("task", "task.volunteer", "פעיל", "Activist"),
    ("task", "task.report_numbers", "מספרי דוח", "Report numbers"),
    ("task", "task.status", "סטטוס", "Status"),
    ("task", "task.status_active", "פעיל", "Active"),
    ("task", "task.status_completed", "הושלם", "Completed"),
    ("task", "task.status_paused", "מושהה", "Paused"),
    ("task", "task.custom_date", "תאריך מותאם", "Custom date"),
    ("task", "task.select_campaign", "בחר קמפיין", "Select a campaign"),
    ("task", "task.select_activist", "בחר פעיל", "Select an activist"),
    (
        "validation", "validation.activist_required", "יש לבחור פעיל", "Please select an activist",
    ),
    ("task", "task.volunteer_report_summary", "דיווח הפעיל", "Volunteer report"),
    # fixes60 §1: the report column split (real activist-submitted status +
    # notes) replacing the free-text volunteer_report_summary cell above.
    ("task", "task.report_status", "סטטוס דיווח", "Report status"),
    ("task", "task.report_notes", "הערות הפעיל", "Activist's notes"),
    ("task", "task.no_report_yet", "טרם דווח", "Not reported yet"),
    ("task", "task.created_at", "תאריך יצירה", "Created"),
    ("filter", "filter.all_campaigns", "כל הקמפיינים", "All campaigns"),
    ("filter", "filter.all_task_statuses", "כל הסטטוסים", "All statuses"),
    ("sort", "sort.by_volunteer", "פעיל", "Activist"),
    ("sort", "sort.by_report_number", "מספר דוח", "Report number"),
    (
        "users", "users.add_task_action", "הוסף משימה", "Add task",
    ),
    (
        "picklist_def", "picklist_def.task.custom_date", "תאריך מותאם (משימה)",
        "Custom date (task)",
    ),
    (
        "contact_shliach", "contact_shliach.report_numbers_moved_to_tasks",
        "שיוך מספרי דוח מנוהל כעת דרך עמוד המשימות.",
        "Report-number assignment is now managed from the Tasks page.",
    ),
    # fixes65: public landing page, self-registration, QR claim, task print, paper entry.
    ("action", "action.search", "חיפוש…", "Search…"),
    ("claim", "claim.already_yours", "המשימה הזו כבר שלך.", "This task is already yours."),
    ("claim", "claim.apartments", "דירות במשימה", "Apartments in task"),
    ("claim", "claim.assigned_signin_hint", "זו המשימה שלכם? התחברו עם החשבון שלכם ותגיעו ישר לדירות של המשימה.", "Is this your task? Sign in with your account to go straight to its apartments."),
    ("claim", "claim.assigned_signin_title", "המשימה משויכת לפעיל — התחברו כדי לפתוח אותה", "This task belongs to an activist — sign in to open it"),
    ("claim", "claim.have_account", "כבר יש לך חשבון? התחברות", "Already have an account? Sign in"),
    ("claim", "claim.link_invalid", "הקישור למשימה אינו בתוקף עוד.", "This task link is no longer valid."),
    ("claim", "claim.link_invalid_hint", "ייתכן שהמשימה הסתיימה או נמחקה.", "The task may have been completed or deleted."),
    ("claim", "claim.locked", "המשימה כבר שויכה לפעיל אחר או שהמשרד מטפל בה. לפרטים אפשר לפנות לרכז/ת.", "This task has already been claimed or is being handled by the office. Contact your coordinator for details."),
    ("claim", "claim.locked_title", "המשימה כבר נלקחה", "This task is taken"),
    ("claim", "claim.no_account", "אין לך חשבון? הרשמה", "No account yet? Register"),
    ("claim", "claim.not_activist", "רק פעילים יכולים לקחת משימה דרך הקוד. מנהלים משייכים משימות מעמוד המשימות.", "Only activists can claim a task by QR. Admins assign tasks from the Tasks page."),
    ("claim", "claim.open_my_tasks", "למשימות שלי", "Go to my tasks"),
    ("claim", "claim.register_and_claim", "הרשמה וקבלת המשימה", "Register and take the task"),
    ("claim", "claim.register_title", "נרשמים ומקבלים את המשימה", "Register and take this task"),
    ("claim", "claim.signin_title", "מתחברים ומקבלים את המשימה", "Sign in and take this task"),
    ("claim", "claim.success", "המשימה שלך!", "The task is yours!"),
    ("claim", "claim.success_hint", "הדירות של המשימה מופיעות עכשיו באזור האישי שלך.", "The task's apartments now appear in your personal area."),
    ("claim", "claim.task", "משימה", "Task"),
    ("claim", "claim.wrong_org", "את/ה מחובר/ת לארגון אחר. יש להתנתק ולהתחבר עם החשבון של הארגון הזה.", "You're signed in to a different organization. Sign out and sign in with this organization's account."),
    ("page", "dashboard.dismiss", "סגירה", "Dismiss"),
    ("page", "dashboard.new_signups", "{n} פעילים חדשים נרשמו", "{n} new activists signed up"),
    ("page", "dashboard.new_signups_hint", "לצפייה ברשימת הנרשמים החדשים", "View the new registrations"),
    ("page", "dashboard.new_signups_one", "פעיל חדש אחד נרשם", "1 new activist signed up"),
    ("filter", "filter.all_assignments", "כל המשימות", "All tasks"),
    ("filter", "filter.assigned_tasks", "משויכות", "Assigned"),
    ("filter", "filter.orphan_tasks", "יתומות / לא משויכות", "Orphan / Unassigned"),
    ("msg", "gallery.upload_failed", "העלאת התמונה נכשלה", "Image upload failed"),
    ("paper", "paper.back_to_tasks", "חזרה למשימות", "Back to tasks"),
    ("paper", "paper.changed_count", "{n} דירות עודכנו", "{n} apartments updated"),
    ("paper", "paper.entered_by", "הוזן על ידי", "Entered by"),
    ("paper", "paper.history", "היסטוריית הזנות", "Entry history"),
    ("paper", "paper.no_apartments", "אין דירות במשימה. אפשר עדיין לשמור את שם מבצע העבודה.", "This task has no apartments. You can still record who performed the work."),
    ("paper", "paper.no_login", "ללא התחברות", "no login"),
    ("paper", "paper.notes", "הערות להזנה (לא חובה)", "Entry notes (optional)"),
    ("paper", "paper.orphan_lock_hint", "המשימה לא משויכת: לאחר השמירה היא תסומן כבטיפול המשרד, וסריקת הקוד שעל הדף תציג שהמשימה נלקחה.", "This task is unassigned: after saving it's marked as handled by the office, and scanning its QR will show it as taken."),
    ("paper", "paper.performed_by", "בוצע על ידי", "Performed by"),
    ("paper", "paper.performer_name", "שם חופשי", "Free-text name"),
    ("paper", "paper.performer_name_hint", "השם יישמר בהיסטוריה בלבד — לא ייפתח חשבון משתמש.", "The name is kept in the history only — no user account is created."),
    ("paper", "paper.performer_name_ph", "לדוגמה: משה כהן", "e.g. Moshe Cohen"),
    ("paper", "paper.performer_name_required", "יש להקליד את שם מבצע העבודה.", "Enter the name of who performed the work."),
    ("paper", "paper.performer_required", "יש לבחור מי ביצע את העבודה.", "Select who performed the work."),
    ("paper", "paper.performer_title", "מי ביצע את העבודה?", "Who performed the work?"),
    ("paper", "paper.performer_unknown", "לא ידוע", "Unknown"),
    ("paper", "paper.performer_user", "פעיל רשום", "Registered activist"),
    ("paper", "paper.performer_user_required", "יש לבחור פעיל מהרשימה.", "Select an activist from the list."),
    ("paper", "paper.save", "שמירת נתוני הדף", "Save sheet data"),
    ("paper", "paper.saved", "נתוני הדף נשמרו", "Sheet data saved"),
    ("paper", "paper.title", "הזנת נתונים מדף משימה מודפס", "Enter data from a printed task sheet"),
    ("public", "public.access_panel", "הצטרפות והתחברות", "Join and sign in"),
    ("public", "public.already_registered", "כתובת האימייל כבר רשומה. יש להתחבר במקום להירשם.", "This email is already registered. Sign in instead."),
    ("public", "public.bad_credentials", "האימייל או הסיסמה שגויים.", "Wrong email or password."),
    ("public", "public.email_is_login", "האימייל ישמש אותך להתחברות למערכת.", "You'll use this email to sign in."),
    ("public", "public.email_or_username", "אימייל או שם משתמש", "Email or username"),
    ("public", "public.full_name", "שם מלא", "Full name"),
    ("public", "public.full_name_required", "יש למלא שם מלא.", "Enter your full name."),
    ("public", "public.gallery", "גלריית תמונות", "Photo gallery"),
    ("public", "public.gallery_fullscreen", "הצגה במסך מלא", "View full screen"),
    ("public", "public.gallery_next", "התמונה הבאה", "Next photo"),
    ("public", "public.gallery_photo_alt", "תמונה {n} מתוך {total}", "Photo {n} of {total}"),
    ("public", "public.gallery_prev", "התמונה הקודמת", "Previous photo"),
    ("public", "public.go_to_login", "למסך ההתחברות", "Go to sign in"),
    ("public", "public.join_intro", "ממלאים את הפרטים ומתחילים מיד — בלי המתנה לאישור. המשימות שתקבלו יופיעו באזור האישי שלכם.", "Fill in your details and start right away — no waiting for approval. Tasks you receive will appear in your personal area."),
    ("public", "public.open_system", "כניסה למערכת", "Open the system"),
    ("public", "public.org_not_found", "לא מצאנו דף ארגון בכתובת הזו.", "We couldn't find an organization page at this address."),
    ("public", "public.password_rule", "לפחות 8 תווים, עם אות גדולה, אות קטנה וספרה (באנגלית).", "At least 8 characters, with an uppercase letter, a lowercase letter and a digit."),
    ("public", "public.phone_optional", "טלפון (לא חובה)", "Phone (optional)"),
    ("public", "public.register_submit", "הצטרפות כפעיל", "Join as an activist"),
    ("public", "public.registration_closed", "ההרשמה לארגון זה סגורה כרגע.", "Registration for this organization is currently closed."),
    ("public", "public.signed_in_as", "את/ה מחובר/ת כ־{name}.", "You're signed in as {name}."),
    ("public", "public.tab_join", "הצטרפות כפעיל", "Join as an activist"),
    ("public", "public.tab_signin", "כבר רשום? התחברות", "Already registered? Sign in"),
    ("page", "public_settings.add_photos", "הוספת תמונות", "Add photos"),
    ("page", "public_settings.gallery", "גלריית תמונות", "Photo gallery"),
    ("page", "public_settings.gallery_hint", "התמונה הראשונה היא תמונת הפתיחה. עד 24 תמונות.", "The first photo is the opening image. Up to 24 photos."),
    ("page", "public_settings.hint", "דף נחיתה ממותג עם שם הארגון, כותרת משנה וגלריית תמונות, שממנו פעילים מתחברים ונרשמים.", "A branded landing page with your organization's name, a subtitle and a photo gallery, where activists sign in and register."),
    ("page", "public_settings.self_registration", "פתיחת הרשמה עצמית לפעילים", "Open activist self-registration"),
    ("page", "public_settings.self_registration_hint", "כאשר פעיל, כל אחד יכול להירשם כפעיל מדף הארגון ולקבל גישה מיידית. המנהלים יקבלו הודעה במייל על כל הרשמה.", "When on, anyone can register as an activist from the organization page and get immediate access. Admins are emailed about every registration."),
    ("page", "public_settings.slug", "כתובת הדף", "Page address"),
    ("page", "public_settings.slug_taken", "כתובת זו כבר בשימוש על ידי ארגון אחר. יש לבחור כתובת אחרת.", "This address is already used by another organization. Choose a different one."),
    ("page", "public_settings.slug_available", "הכתובת פנויה ✓", "Address available ✓"),
    ("page", "public_settings.slug_checking", "בודק זמינות…", "Checking availability…"),
    ("page", "public_settings.slug_invalid", "כתובת הדף יכולה להכיל רק אותיות באנגלית, ספרות ומקפים.", "The page address may contain only English letters, digits and dashes."),
    ("page", "public_settings.subtitle", "כותרת משנה", "Subtitle"),
    ("page", "public_settings.title", "דף הארגון הציבורי", "Public organization page"),
    ("task", "task.assign_later", "שיוך מאוחר יותר (מאגר משימות פתוחות)", "Assign later (open task pool)"),
    ("task", "task.open", "פתיחת משימה", "Open task"),
    ("task", "task.title", "משימה", "Task"),
    ("task", "task.not_found", "המשימה לא נמצאה.", "Task not found."),
    ("task", "task.apartment_count", "מספר דירות", "Apartments"),
    ("task", "task.claimed_how", "אופן השיוך", "How it was assigned"),
    ("task", "task.claimed_at", "תאריך שיוך", "Assigned on"),
    ("task", "task.claimed_via_paper", "הוזנה מדף מודפס במשרד", "Entered from a printed sheet by the office"),
    ("task", "task.claimed_via_manual", "שויכה ידנית", "Assigned manually"),
    ("task", "task.updated_at", "עודכן לאחרונה", "Last updated"),
    ("task", "page.task_details", "פרטי משימה", "Task details"),
    ("task", "page.task_activity", "דיווח ושיוך", "Report and assignment"),
    ("task", "page.back_to_tasks", "← חזרה למשימות", "← Back to tasks"),
    ("task", "paper.back_to_task", "חזרה למשימה", "Back to task"),
    ("task", "task.confirm_no_activist", "אתם עומדים ליצור משימה ללא פעיל. האם אתם בטוחים?", "You are about to create a task with no activist. Are you sure?"),
    ("task", "task.no_activist", "ללא פעיל (מאגר משימות פתוחות)", "No activist (open task pool)"),
    ("task", "task.assign_later_hint", "המשימה תמתין במאגר המשימות הפתוחות. הדפיסו אותה — הדף יכלול קוד QR שדרכו פעיל יוכל לקחת אותה.", "The task waits in the open pool. Print it — the sheet includes a QR code an activist can scan to take it."),
    ("task", "task.assignment", "שיוך", "Assignment"),
    ("task", "task.claimed_via_qr", "נלקחה בסריקת קוד QR", "Claimed by QR scan"),
    ("task", "task.office_handled", "בטיפול המשרד", "Handled by the office"),
    ("task", "task.orphan_badge", "לא משויך", "Unassigned"),
    ("task", "task.paper_entry", "הזנת נתונים מדף מודפס", "Enter data from a printed sheet"),
    ("task", "task.print", "הדפסת משימה", "Print task"),
    ("task", "task.print_no_apartments", "אין דירות במשימה — אין מה להדפיס.", "This task has no apartments — nothing to print."),
    ("task", "task.unassign", "החזרה למאגר", "Return to pool"),
    ("task", "task.unassign_confirm", "להחזיר את המשימה למאגר המשימות הפתוחות?", "Return this task to the open task pool?"),
    ("task", "task.unassign_detail", "הדפים שכבר הודפסו ימשיכו לעבוד — הפעיל הבא שיסרוק את הקוד יקבל את המשימה.", "Sheets already printed keep working — the next activist to scan the code gets the task."),
    ("task", "task.unassigned_toast", "המשימה הוחזרה למאגר", "Task returned to the pool"),
    ("task", "task_pdf.apartment_count", "מספר דירות", "Apartments"),
    # fixes69 §Admin3c/3d/3e: the task-sheet field-picker/reorder/width panel.
    ("task", "task_pdf.fields_settings_title", "עיצוב דף ההדפסה", "Print sheet layout"),
    (
        "task", "task_pdf.widths_autoscale_hint",
        "הרוחבים מתחלקים יחסית לרוחב הדף — אין צורך שיסתכמו ל-100.",
        "Widths scale proportionally to the page — they don't need to add up to 100.",
    ),
    ("task", "task_pdf.footer", "משימה #{id} · עמוד {page} מתוך {total}", "Task #{id} · page {page} of {total}"),
    ("task", "task_pdf.performed_by", "בוצע על ידי (שם מלא)", "Performed by (full name)"),
    ("task", "task_pdf.qr_caption", "סרקו את הקוד כדי לקחת את המשימה", "Scan the code to take this task"),
    ("task", "task_pdf.qr_subcaption", "הרשמה מהירה, והמשימה משויכת אליכם אוטומטית", "Quick registration — the task is assigned to you automatically"),
    ("task", "task_pdf.qr_caption_assigned", "סרקו את הקוד כדי להיכנס למערכת", "Scan the code to enter the system"),
    ("task", "task_pdf.qr_subcaption_assigned", "התחברו לחשבון שלכם והמשימה תיפתח לפניכם", "Sign in to your account and your task opens"),
    ("task", "task_pdf.title", "דף משימה", "Task sheet"),
    ("task", "task_pdf.unassigned", "טרם שויך — לסריקת הקוד בתחתית הדף", "Not assigned yet — scan the code at the bottom of the page"),
    ("page", "users.new_signups_filter", "פעילים שנרשמו לאחרונה", "Recently registered activists"),
    ("validation", "validation.campaign_required", "יש לבחור קמפיין", "Select a campaign"),
    # Instinct API drafts (docs/system_api.md): the contacts page's pending section.
    ("page", "contacts.pending_approval", "ממתינים לאישור", "Pending approval"),
    ("page", "contacts.draft_badge", "טיוטה", "Draft"),
    ("page", "contacts.source_instinct", "נוסף דרך Instinct", "Added via Instinct"),
    ("action", "contacts.approve", "אישור", "Approve"),
    ("msg", "msg.contact_approved", "איש הקשר אושר", "Contact approved"),
    ("msg", "msg.contact_approve_failed", "אישור איש הקשר נכשל", "Approving the contact failed"),
    # Global search: users (login accounts) group.
    ("search", "search.group.users", "משתמשים", "Users"),
    # apt.contact was already referenced by ApartmentDetailPage's t() call with
    # no seed row backing it (a pre-existing gap, not introduced here) — added
    # now since the new /dashboard/street page uses the same key.
    ("apt", "apt.contact", "איש קשר", "Contact"),
    # /dashboard/street: mobile "door" reskin of the apartments list, same
    # data/fields as /dashboard/apartments (docs/fixes68_b.md).
    ("street", "street.title", "המסלול שלי", "My route"),
    ("street", "street.visits_title", "ביקורים", "Visits"),
    ("street", "street.visits_soon", "בקרוב", "Coming soon"),
    (
        "street",
        "street.visits_hint",
        "רשימת הביקורים לדירה תופיע כאן כשהמערכת תתמוך בזה.",
        "This apartment's visit history will appear here once supported.",
    ),
    ("street", "street.extra_fields", "שדות נוספים", "Extra fields"),
    ("apt", "apt.no_options", "אין אפשרויות מוגדרות בשדה הזה.", "No options are defined for this field."),
    # /dashboard/street is now the default "Apartments" nav entry; the
    # classic grid gets its own sidebar label at its same URL.
    ("nav", "nav.apartments_grid", "ניהול דירות", "Apartment management"),
    (
        "street",
        "street.footnote",
        "כל שדה מהמערכת הקיימת מופיע כאן — שום דבר לא הלך לאיבוד.",
        "Every field from the current system appears here — nothing was lost.",
    ),
    # docs/fixes70_street_v2.md: /dashboard/street2 reuses street.title and
    # every other street.*/apt.* key above verbatim — no street2-specific
    # copy needed. Its nav entry now reuses nav.apartments too (fixes71
    # follow-up: only one "apartments" menu item, pointing at street2).
    # --- fixes68 §9/§B4: activist door-to-door route flow ---
    ("activist_route", "activist_route.title", "התחל סיבוב", "Start route"),
    ("activist_route", "activist_route.outcome.answered", "נענו", "Answered"),
    ("activist_route", "activist_route.outcome.not_home", "לא בבית", "Not home"),
    ("activist_route", "activist_route.outcome.jewish", "יהודי", "Jewish"),
    ("activist_route", "activist_route.outcome.not_jewish", "לא יהודי", "Not Jewish"),
    (
        "activist_route", "activist_route.outcome.come_back_later",
        "לחזור מאוחר יותר", "Come back later",
    ),
    (
        "activist_route", "activist_route.do_not_knock",
        "לא לדפוק - דייר לא יהודי", "DO NOT KNOCK - non-Jewish resident",
    ),
    (
        "activist_route", "activist_route.mixed_household",
        "משפחה מעורבת (כולל יהודי)", "Mixed household (includes a Jew)",
    ),
    ("activist_route", "activist_route.progress", "{done} / {total} דלתות", "{done} / {total} doors"),
    ("activist_route", "activist_route.synced", "עודכן {time}", "Updated {time}"),
    (
        "activist_route", "activist_route.offline",
        "לא מקוון - מציג נתונים מ-{time}", "Offline - showing data from {time}",
    ),
    (
        "activist_route", "activist_route.outbox_pending",
        "{n} סימונים ממתינים לסנכרון", "{n} marks waiting to sync",
    ),
    ("activist_route", "activist_route.undo", "בטל - עוד לא סונכרן", "Undo - not synced yet"),
    ("activist_route", "activist_route.undo_action", "בטל", "Undo"),
    ("activist_route", "activist_route.divider.building", "בניין {address}", "Building {address}"),
    ("activist_route", "activist_route.divider.floor", "קומה {floor}", "Floor {floor}"),
    ("activist_route", "activist_route.divider.remaining", "{n} דירות נותרו", "{n} doors left"),
    ("activist_route", "activist_route.continue", "המשך", "Continue"),
    (
        "activist_route", "activist_route.complete",
        "סיימת את כל הדלתות - כל הכבוד!", "All doors done - well done!",
    ),
    ("activist_route", "activist_route.marked", "סומן: {outcome}, {time}", "Marked: {outcome}, {time}"),
    ("activist_route", "activist_route.view_cards", "תצוגת כרטיסים", "Card view"),
    ("activist_route", "activist_route.view_grid", "תצוגת רשימה", "Grid view"),
    ("activist_route", "activist_route.back", "חזרה", "Back"),
    ("activist_route", "activist_route.refresh", "רענון", "Refresh"),
    ("activist_route", "activist_route.no_doors", "אין דלתות בסיבוב שלך", "No doors in your route"),
    ("activist_route", "activist_route.load_failed", "טעינת הסיבוב נכשלה", "Failed to load your route"),
    ("activist_route", "activist_route.call", "התקשר", "Call"),
    ("activist_route", "activist_route.celebration_static", "כל הכבוד!", "Well done!"),
    ("activist_route", "activist_route.grid.not_marked", "טרם סומן", "Not marked yet"),
    ("activist_route", "activist_route.grid.do_not_knock", "לא לדפוק", "Don't knock"),
    (
        "activist_home", "activist_home.start_route_hint",
        "סיבוב דלת אחר דלת לדירות המשויכות לך", "Door-by-door route for your assigned apartments",
    ),
]

# (field_key, value, hebrew_label, color_hint, sort_order, is_default)
PICKLISTS: list[tuple[str, str, str, str | None, int, bool]] = [
    ("contact.contact_type", "mekurav", "מקורב", None, 0, True),
    ("contact.contact_type", "shliach", "פעיל", None, 1, False),
    ("significant_date.type", "birthday", "יום הולדת", None, 0, False),
    ("significant_date.type", "yahrzeit", "תאריך פטירה", None, 1, False),
    ("contact.pipeline_status", "new", "חדש", None, 0, True),
    ("contact.pipeline_status", "in_progress", "בתהליך", None, 1, False),
    ("contact.pipeline_status", "sent", "נשלח", None, 2, False),
    ("contact.pipeline_status", "completed", "הושלם", None, 3, False),
    ("contact.potential_next_step", "low", "נמוך", None, 0, False),
    ("contact.potential_next_step", "medium", "בינוני", None, 1, False),
    ("contact.potential_next_step", "high", "גבוה", None, 2, False),
    ("contact.color_tag", "magenta", "מגנטה", "magenta", 0, False),
    ("contact.color_tag", "green", "ירוק בהיר", "green", 1, False),
    ("contact.color_tag", "yellow", "צהוב", "yellow", 2, False),
    ("contact.color_tag", "darkred", "אדום כהה", "darkred", 3, False),
    ("contact.color_tag", "orange", "כתום", "orange", 4, False),
    ("checklist.torah_thought", "not_given", "לא נמסר", None, 0, True),
    ("checklist.torah_thought", "given", "נמסר", None, 1, False),
    ("checklist.torah_thought", "scheduled", "מתוכנן", None, 2, False),
    ("interaction.category", "heart_connection", "חיבור לב", None, 0, False),
    ("interaction.category", "recommendation", "המלצה", None, 1, False),
    ("interaction.category", "background", "רקע", None, 2, False),
    ("visit.type", "home", "ביקור בית", None, 0, False),
    ("visit.type", "phone", "שיחת טלפון", None, 1, False),
    ("visit.type", "event", "אירוע", None, 2, False),
    ("visit.type", "meeting", "פגישה", None, 3, False),
    # fixes4 new system picklists ("/" = the blank/none option). English left blank
    # (filled by admins later, per the fallback rule).
    ("Jewish_status", "na", "/", None, 0, True),
    ("Jewish_status", "jewish", "יהודי", None, 1, False),
    ("Jewish_status", "jewish_interested", "יהודי מעוניין ביהדות", None, 2, False),
    ("Jewish_status", "jewish_gentile", "יהודי וגוי", None, 3, False),
    ("Jewish_status", "jewish_interested_gentile", "יהודי מעוניין וגוי", None, 4, False),
    ("Jewish_status", "jewish_shtumtz", "יהודי שתומצ", None, 5, False),
    ("affiliation", "na", "/", None, 0, True),
    ("affiliation", "chabad", "חבד", None, 1, False),
    ("affiliation", "haredi", "חרדי", None, 2, False),
    ("affiliation", "dati_leumi", "דתי לאומי", None, 3, False),
    ("affiliation", "reform", "רפורמי", None, 4, False),
    ("affiliation", "conservative", "קונסרבטיבי", None, 5, False),
    ("language", "na", "/", None, 0, True),
    ("language", "hebrew", "עברית", None, 1, False),
    ("language", "english", "אנגלית", None, 2, False),
    ("language", "russian", "רוסית", None, 3, False),
    ("language", "yiddish", "יידיש", None, 4, False),
    # fixes7 §4: apartment status picklists. campaign_status is intentionally
    # left without seeded options (admins define their own campaigns).
    ("apartment.Jewish_status", "na", "/", None, 0, True),
    ("apartment.Jewish_status", "jewish", "יהודי", None, 1, False),
    ("apartment.Jewish_status", "jewish_interested", "יהודי מעוניין ביהדות", None, 2, False),
    ("apartment.Jewish_status", "jewish_gentile", "יהודי וגוי", None, 3, False),
    ("apartment.Jewish_status", "jewish_interested_gentile", "יהודי מעוניין וגוי", None, 4, False),
    ("apartment.Jewish_status", "jewish_shtumtz", "יהודי שתומצ", None, 5, False),
    ("apartment.mezuzah_status", "checked", "נבדק", None, 0, False),
    ("apartment.mezuzah_status", "needs_check", "צריך בדיקה", None, 1, False),
    # fixes13: apartment language picklist (bilingual values below).
    ("apartment.language", "hebrew", "עברית", None, 0, False),
    ("apartment.language", "english", "אנגלית", None, 1, False),
    ("apartment.language", "russian", "רוסית", None, 2, False),
    ("apartment.language", "yiddish", "יידיש", None, 3, False),
    ("apartment.language", "missing", "חסר", None, 4, False),
    # fixes51 §3: shares its options with Jewish_status (per spec).
    ("contact_shliach.manager_jewish_status", "na", "/", None, 0, True),
    ("contact_shliach.manager_jewish_status", "jewish", "יהודי", None, 1, False),
    (
        "contact_shliach.manager_jewish_status", "jewish_interested",
        "יהודי מעוניין ביהדות", None, 2, False,
    ),
    (
        "contact_shliach.manager_jewish_status", "jewish_gentile",
        "יהודי וגוי", None, 3, False,
    ),
    (
        "contact_shliach.manager_jewish_status", "jewish_interested_gentile",
        "יהודי מעוניין וגוי", None, 4, False,
    ),
    (
        "contact_shliach.manager_jewish_status", "jewish_shtumtz",
        "יהודי שתומצ", None, 5, False,
    ),
    # fixes68 §B3: "not Jewish" — the don't-knock marker (Feature 5). Sort
    # order 6 continues the apartment.Jewish_status block above.
    ("apartment.Jewish_status", "not_jewish", "לא יהודי", None, 6, False),
    # fixes68 §B2/B3: one-tap door outcomes (Feature 3). "jewish"/"not_jewish"
    # are recorded as door_outcome "answered" — see routers/apartments.py.
    ("visit.door_outcome", "answered", "נענו", None, 0, False),
    ("visit.door_outcome", "not_home", "לא בבית", None, 1, False),
    ("visit.door_outcome", "come_back_later", "לחזור מאוחר יותר", None, 2, False),
]

# English display for picklist OPTION values, keyed by (field_key, value).
# Applied on insert and backfilled onto existing blank english_value rows
# (fixes13 — the values themselves are bilingual, not just the list names).
PICKLIST_ENGLISH_VALUES: dict[tuple[str, str], str] = {
    ("apartment.language", "hebrew"): "Hebrew",
    ("apartment.language", "english"): "English",
    ("apartment.language", "russian"): "Russian",
    ("apartment.language", "yiddish"): "Yiddish",
    ("apartment.language", "missing"): "Missing",
    # The contact-level language list carries the same values.
    ("language", "hebrew"): "Hebrew",
    ("language", "english"): "English",
    ("language", "russian"): "Russian",
    ("language", "yiddish"): "Yiddish",
    # fixes68 §B3.
    ("apartment.Jewish_status", "not_jewish"): "Not Jewish",
    ("visit.door_outcome", "answered"): "Answered",
    ("visit.door_outcome", "not_home"): "Not home",
    ("visit.door_outcome", "come_back_later"): "Come back later",
}

# Picklist definition display names (he from PICKLIST_FIELDS; en where known per spec).
PICKLIST_ENGLISH_DISPLAY: dict[str, str] = {
    "Jewish_status": "Jewish status",
    "affiliation": "affiliation",
    "language": "language",
    "visit.type": "Visit type",
    "apartment.Jewish_status": "Jewish status (apartment)",
    "apartment.campaign_status": "Campaign status",
    "apartment.mezuzah_status": "Mezuzah",
    "apartment.language": "Language",
    "contact_shliach.manager_jewish_status": "Manager Jewish status",
    "visit.door_outcome": "Door outcome",
}


# Platform title configuration (fixes9 §1). The metadata endpoint falls back to
# these values when the rows are missing, so a fresh/un-seeded DB still works.
SYSTEM_SETTING_DEFAULTS: dict[str, str] = {
    # fixes65: the browser tab is just the organization's name.
    "system_title_template": "{public.organizations.name}",
    "system_fallback_org_name": "Jewish Points CRM",
}

# Superseded default values: a stored row still holding one of these was never
# customized by the superadmin, so it's moved to the current default.
_SYSTEM_SETTING_OLD_DEFAULTS: dict[str, set[str]] = {
    "system_title_template": {"{public.organizations.name} CRM"},
}


def seed_system_settings(db: Session) -> None:
    """Insert any missing system_settings rows, and upgrade rows still on a
    superseded default (a customized value is never overwritten)."""
    rows = {r.key: r for r in db.query(models.SystemSetting).all()}
    dirty = False
    for key, value in SYSTEM_SETTING_DEFAULTS.items():
        row = rows.get(key)
        if row is None:
            db.add(models.SystemSetting(key=key, value=value))
            dirty = True
        elif row.value in _SYSTEM_SETTING_OLD_DEFAULTS.get(key, set()):
            row.value = value
            dirty = True
    if dirty:
        db.commit()


# Deliberate renames of previously-seeded labels (fixes13). Re-seeding never
# overwrites, so each entry force-updates a row — but ONLY while its current
# text is one of the known old seeds, so admin-customized labels survive.
LOCALIZATION_RENAMES: dict[str, tuple[set, str, set, str]] = {
    # key: (old hebrew variants, new hebrew, old english variants, new english)
    "apartments.apartment_name": (
        {"כותרת", "תווית"}, "מספר דירה", {"Title", "Label"}, "Apartment number",
    ),
    # fixes18 §general: "מצוות קהילה" is now branded "מבצעים".
    # fixes38d: dropped the "community_checklists"/"filter.mitzvot_only" rename
    # entries alongside their now-removed LOCALIZATION rows (dead since the
    # fixes25 visit-restructure migration dropped both underlying tables);
    # filter.all_mitzvot is still live and keeps its rename entry.
    "filter.all_mitzvot": (
        {"מצוות קהילה"}, "מבצעים", {"Community mitzvot"}, "Mivtzoim",
    ),
    # fixes48 §3: "Clear Assignments" was found to clear areas, not report
    # numbers — the confirm text is corrected to match the fixed behavior.
    "users.clear_assignments_confirm": (
        {"אתה בטוח שברצונך למחוק את כל השיבוצים של הפעילים? פעולה זו בלתי הפיכה"},
        "אתה בטוח שברצונך למחוק את כל מספרי הדוח המשויכים לפעילים? פעולה זו בלתי הפיכה",
        {"Are you sure you want to delete all active placements? This action is irreversible."},
        "Are you sure you want to clear all report numbers assigned to activists? This action is irreversible.",
    ),
    # fixes29 §3: clearer email validation hint (both languages).
    "validation.email_hint": (
        {"כתובת אימייל תקינה, לדוגמה name@example.com"},
        "נא להזין כתובת אימייל תקינה, לדוגמה name@example.com",
        {"A valid email address, e.g. name@example.com"},
        "Please enter a valid email address, e.g. name@example.com",
    ),
    # fixes25: custom fields are logged per visit, not on the contact card.
    "cf.intro": (
        {"כל שדה הוא תיבת סימון + הערה, ויופיע בכרטיס איש הקשר. לדוגמה: מסיבת חנוכה."},
        "כל שדה הוא תיבת סימון + הערה, ויופיע בטופס הביקור. לדוגמה: מסיבת חנוכה.",
        {"Each field is a checkbox + note shown on the contact card. e.g. Hanukkah party."},
        "Each field is a checkbox + note logged on each visit. e.g. Hanukkah party.",
    ),
    # fixes32 §7: the picklists dashboard's two sections are now explicitly
    # Contact vs. Apartment (was the generic "General").
    "pl.group_general": (
        {"כללי"}, "אנשי קשר", {"General"}, "Contacts",
    ),
    # fixes35 §2: the custom-fields page now covers 4 entities x 5 field
    # types, not just a visit checklist — exact spec wording for the nav
    # label + a matching intro rewrite.
    "nav.custom_fields": (
        {"שדות מותאמים"}, "הוספת שדות מותאמים", {"Custom fields"}, "Add custom fields",
    ),
    "cf.intro": (
        {"כל שדה הוא תיבת סימון + הערה, ויופיע בטופס הביקור. לדוגמה: מסיבת חנוכה."},
        "הגדירו שדה מותאם אישית עבור אנשי קשר, פעילים, ביקורים או דירות — מכל סוג: טקסט, מספר, תיבת סימון, תאריך או רשימת בחירה.",
        {"Each field is a checkbox + note logged on each visit. e.g. Hanukkah party."},
        "Define a custom field for contacts, activists, visits or apartments — any type: text, number, checkbox, date or select.",
    ),
    # fixes43 §5.2: "admin" is more precisely "system admin".
    "users.role_admin": (
        {"מנהל"}, "מנהל מערכת", {"Admin"}, "System admin",
    ),
    # fixes54 §6: this label used to read as "Edit Lock" for the apartment
    # fields an activist works with, but actually locked their own contact
    # profile — the new "apartment_edit_locks" section above takes over that
    # meaning, so this one is renamed to say what it really does.
    "shliach_config.self_edit_locks": (
        {"נעילת שדות לעריכה עצמית"}, "נעילת שדות בפרופיל האישי של הפעיל",
        {"Self-edit field locks"}, "Activist's own-profile field locks",
    ),
    # fixes59 §4: "אזור מנהל"/"Admin area" rebranded to "אזור מותאם אישית"/
    # "Custom area" (same underlying admin_areas entity, just relabeled).
    "nav.admin_areas": (
        {"אזור מנהל"}, "אזור מותאם אישית", {"Admin area"}, "Custom area",
    ),
    "page.admin_areas_title": (
        {"אזורי מנהל"}, "אזורים מותאמים אישית", {"Admin areas"}, "Custom areas",
    ),
    "page.add_admin_area": (
        {"אזור מנהל חדש"}, "אזור מותאם אישית חדש", {"New admin area"}, "New custom area",
    ),
    "page.edit_admin_area": (
        {"עריכת אזור מנהל"}, "עריכת אזור מותאם אישית", {"Edit admin area"}, "Edit custom area",
    ),
    "page.no_admin_areas": (
        {"אין אזורי מנהל להצגה."}, "אין אזורים מותאמים אישית להצגה.",
        {"No admin areas to show."}, "No custom areas to show.",
    ),
    "msg.delete_admin_area_confirm": (
        {"למחוק את אזור המנהל?"}, "למחוק את האזור המותאם אישית?",
        {"Delete this admin area?"}, "Delete this custom area?",
    ),
    "contact_mekurav.admin_area_id": (
        {"אזור מנהל"}, "אזור מותאם אישית", {"Admin area"}, "Custom area",
    ),
    "filter.all_admin_areas": (
        {"כל אזורי המנהל"}, "כל האזורים המותאמים אישית",
        {"All admin areas"}, "All custom areas",
    ),
}


def seed_localization(db: Session) -> None:
    """Insert any missing global localization rows; backfill English on existing rows.

    Idempotent: new rows are added; existing rows get `english_label` set if still blank
    (so re-seeding fills in translations added to the seed list over time).
    """
    rows = {r.technical_name: r for r in db.query(models.FieldLocalization).all()}
    seen: set[str] = set()
    dirty = False

    for key, (old_he, new_he, old_en, new_en) in LOCALIZATION_RENAMES.items():
        row = rows.get(key)
        if row is None:
            continue
        if row.hebrew_label in old_he:
            row.hebrew_label = new_he
            dirty = True
        if row.english_label in old_en:
            row.english_label = new_en
            dirty = True
    for entity_type, technical_name, hebrew_label, english_label in LOCALIZATION:
        if technical_name in seen:
            continue  # guard against an accidental duplicate key in the list
        seen.add(technical_name)
        existing = rows.get(technical_name)
        if existing is None:
            new_row = models.FieldLocalization(
                entity_type=entity_type,
                technical_name=technical_name,
                hebrew_label=hebrew_label,
                english_label=english_label or None,
            )
            db.add(new_row)
            rows[technical_name] = new_row
            dirty = True
        elif not existing.english_label and english_label:
            existing.english_label = english_label
            dirty = True
    if dirty:
        db.commit()


def seed_picklists(db: Session, organization_id: int) -> None:
    """Insert any missing picklist options for one organization (idempotent)."""
    existing = {
        (row.field_key, row.value)
        for row in db.query(
            models.PicklistValue.field_key, models.PicklistValue.value
        )
        .filter(models.PicklistValue.organization_id == organization_id)
        .all()
    }
    new_rows = [
        models.PicklistValue(
            organization_id=organization_id,
            field_key=field_key,
            value=value,
            hebrew_label=hebrew_label,
            english_value=PICKLIST_ENGLISH_VALUES.get((field_key, value)),
            color_hint=color_hint,
            sort_order=sort_order,
            is_default=is_default,
        )
        for field_key, value, hebrew_label, color_hint, sort_order, is_default in PICKLISTS
        if (field_key, value) not in existing
    ]
    if new_rows:
        db.add_all(new_rows)
        db.commit()


def backfill_picklist_english_values(db: Session, organization_id: int) -> None:
    """Fill english_value on existing options where the seed knows it and the
    org hasn't set one (idempotent; admin-entered values are never touched)."""
    dirty = False
    for (field_key, value), english in PICKLIST_ENGLISH_VALUES.items():
        rows = (
            db.query(models.PicklistValue)
            .filter(
                models.PicklistValue.organization_id == organization_id,
                models.PicklistValue.field_key == field_key,
                models.PicklistValue.value == value,
                (models.PicklistValue.english_value.is_(None))
                | (models.PicklistValue.english_value == ""),
            )
            .all()
        )
        for row in rows:
            row.english_value = english
            dirty = True
    if dirty:
        db.commit()


def seed_picklist_definitions(db: Session, organization_id: int) -> None:
    """Insert any missing picklist *definitions* for one org (idempotent).

    Promotes the code registry `PICKLIST_FIELDS` into editable per-org rows.
    """
    existing = {
        row.system_name
        for row in db.query(models.PicklistDefinition.system_name)
        .filter(models.PicklistDefinition.organization_id == organization_id)
        .all()
    }
    new_rows = [
        models.PicklistDefinition(
            organization_id=organization_id,
            system_name=system_name,
            hebrew_display_name=hebrew_display,
            english_display_name=PICKLIST_ENGLISH_DISPLAY.get(system_name),
            entity_type=entity_type,
            is_system=True,
            sort_order=index,
            allow_multiple=system_name in MULTI_VALUE_PICKLIST_FIELDS,
        )
        for index, (system_name, (hebrew_display, entity_type)) in enumerate(
            PICKLIST_FIELDS.items()
        )
        if system_name not in existing
    ]
    if new_rows:
        db.add_all(new_rows)
        db.commit()


def seed_default_options_for_empty_lists(db: Session, organization_id: int) -> None:
    """Seed a system list's default options only when the org has *none* for it.

    Fills entirely-empty lists — e.g. a system picklist added to the registry
    after the org was created (visit.type) — without re-adding options an admin
    deleted individually (those lists still have other values, so are skipped).
    """
    from sqlalchemy import func

    counts = {
        field_key: n
        for field_key, n in (
            db.query(models.PicklistValue.field_key, func.count(models.PicklistValue.id))
            .filter(models.PicklistValue.organization_id == organization_id)
            .group_by(models.PicklistValue.field_key)
            .all()
        )
    }
    by_field: dict[str, list] = {}
    for row in PICKLISTS:
        by_field.setdefault(row[0], []).append(row)

    new_rows = [
        models.PicklistValue(
            organization_id=organization_id,
            field_key=field_key,
            value=value,
            hebrew_label=hebrew_label,
            english_value=PICKLIST_ENGLISH_VALUES.get((field_key, value)),
            color_hint=color_hint,
            sort_order=sort_order,
            is_default=is_default,
        )
        for field_key, defaults in by_field.items()
        if counts.get(field_key, 0) == 0
        for _, value, hebrew_label, color_hint, sort_order, is_default in defaults
    ]
    if new_rows:
        db.add_all(new_rows)
        db.commit()


# fixes39: the Mivtzoim booleans + connection-to-the-Rebbe note used to be
# hardcoded VisitHistory columns; they are now ordinary entity_type="visit"
# custom fields, seeded per org exactly like every other default. Each entry
# is (field_key, field_type, hebrew_label, english_label, sort_order) — the
# same key names the columns used to have, and the same he/en labels that
# used to live in LOCALIZATION_SEED under "visits.*".
VISIT_MIVTZOIM_CUSTOM_FIELDS: list[tuple[str, str, str, str, int]] = [
    ("tefillin", "boolean", "תפילין", "Tefillin", 0),
    ("tzedakah", "boolean", "צדקה", "Tzedakah", 1),
    ("shabbat_candles", "boolean", "נרות", "Shabbat candles", 2),
    ("torah_pamphlet", "boolean", "עלון", "Torah pamphlet", 3),
    ("letter_in_torah", "boolean", "אות בספר", "Letter in a Torah", 4),
    ("connection_to_rebbe", "text", "קשר לרבי", "Connection to the Rebbe", 5),
]


def seed_visit_mivtzoim_custom_fields(db: Session, organization_id: int) -> None:
    """Idempotently create/reactivate the 6 default visit custom fields for
    one org (fixes39 §1). Matched by (org, entity_type="visit", field_key) —
    an existing row (e.g. re-run at every boot, like seed_picklist_definitions)
    is updated in place, never duplicated. Deliberately does NOT touch the
    unrelated dormant duplicate rows fixes38 deactivated (tfilin/nerot/alon/
    ot/Kesher_Larabi/dvar_torah) — those keep their own non-standard
    field_keys and stay as historical, inactive artifacts."""
    existing = {
        row.field_key: row
        for row in db.query(models.CustomFieldDefinition).filter(
            models.CustomFieldDefinition.organization_id == organization_id,
            models.CustomFieldDefinition.entity_type == "visit",
            models.CustomFieldDefinition.field_key.in_(
                [key for key, *_ in VISIT_MIVTZOIM_CUSTOM_FIELDS]
            ),
        )
    }
    changed = False
    for field_key, field_type, hebrew_label, english_label, sort_order in (
        VISIT_MIVTZOIM_CUSTOM_FIELDS
    ):
        row = existing.get(field_key)
        if row is None:
            db.add(
                models.CustomFieldDefinition(
                    organization_id=organization_id,
                    entity_type="visit",
                    field_key=field_key,
                    field_type=field_type,
                    hebrew_label=hebrew_label,
                    english_label=english_label,
                    sort_order=sort_order,
                    is_active=True,
                )
            )
            changed = True
        elif (
            row.field_type != field_type
            or row.hebrew_label != hebrew_label
            or row.english_label != english_label
            or row.sort_order != sort_order
            or not row.is_active
        ):
            row.field_type = field_type
            row.hebrew_label = hebrew_label
            row.english_label = english_label
            row.sort_order = sort_order
            row.is_active = True
            changed = True
    if changed:
        db.commit()


APARTMENT_DEFAULT_CUSTOM_FIELDS: list[tuple[str, str, str, str, int]] = [
    # docs/fixes70_street_v2.md: requested as a default for every org, not
    # just the one it was first added to — same shape/pattern as
    # VISIT_MIVTZOIM_CUSTOM_FIELDS above.
    ("to_knock", "boolean", "לדפוק", "To knock", 0),
]


def seed_apartment_custom_fields(db: Session, organization_id: int) -> None:
    """Idempotently create/reactivate the default apartment custom fields for
    one org. Matched by (org, entity_type="apartment", field_key) — an
    existing row is updated in place, never duplicated. Mirrors
    seed_visit_mivtzoim_custom_fields exactly."""
    existing = {
        row.field_key: row
        for row in db.query(models.CustomFieldDefinition).filter(
            models.CustomFieldDefinition.organization_id == organization_id,
            models.CustomFieldDefinition.entity_type == "apartment",
            models.CustomFieldDefinition.field_key.in_(
                [key for key, *_ in APARTMENT_DEFAULT_CUSTOM_FIELDS]
            ),
        )
    }
    changed = False
    for field_key, field_type, hebrew_label, english_label, sort_order in (
        APARTMENT_DEFAULT_CUSTOM_FIELDS
    ):
        row = existing.get(field_key)
        if row is None:
            db.add(
                models.CustomFieldDefinition(
                    organization_id=organization_id,
                    entity_type="apartment",
                    field_key=field_key,
                    field_type=field_type,
                    hebrew_label=hebrew_label,
                    english_label=english_label,
                    sort_order=sort_order,
                    is_active=True,
                )
            )
            changed = True
        elif (
            row.field_type != field_type
            or row.hebrew_label != hebrew_label
            or row.english_label != english_label
            or row.sort_order != sort_order
            or not row.is_active
        ):
            row.field_type = field_type
            row.hebrew_label = hebrew_label
            row.english_label = english_label
            row.sort_order = sort_order
            row.is_active = True
            changed = True
    if changed:
        db.commit()


def provision_org(db: Session, organization_id: int) -> None:
    """Set up a newly activated organization with its default picklists and
    default visit custom fields (fixes39)."""
    seed_picklists(db, organization_id)
    seed_picklist_definitions(db, organization_id)
    seed_visit_mivtzoim_custom_fields(db, organization_id)
    seed_apartment_custom_fields(db, organization_id)


def _seed_sample_data(db: Session, org: models.Organization, admin: models.User) -> None:
    """Example records for the demo org — only when it has no contacts yet."""
    if (
        db.query(models.Contact)
        .filter(models.Contact.organization_id == org.id)
        .count()
        > 0
    ):
        return

    c1 = models.Contact(
        organization_id=org.id,
        name="אלי",
        last_name="ריכמן",
        phone="052-1234567",
        contact_type="mekurav",
        assigned_user_id=admin.guid,
        address="דיזנגוף 100, תל אביב-יפו",
        latitude=32.0809,
        longitude=34.7738,
        priority_score=5,
    )
    c1.mekurav = models.ContactMekurav(
        organization_id=org.id,
        background="נפגשנו בכנס",
    )

    c2 = models.Contact(
        organization_id=org.id,
        name="דוד",
        last_name="כהן",
        phone="054-7654321",
        contact_type="mekurav",
        assigned_user_id=admin.guid,
        priority_score=3,
    )
    c2.mekurav = models.ContactMekurav(organization_id=org.id)

    db.add_all([c1, c2])
    db.flush()
    # fixes32: pipeline_status/color_tag/potential_next_step are picklist-
    # backed (PicklistLink) — the org's picklists are already seeded above.
    picklist_utils.set_value(db, org.id, "contacts", c1.id, "contact.pipeline_status", "in_progress")
    picklist_utils.set_value(db, org.id, "contacts", c1.id, "contact.color_tag", "magenta")
    picklist_utils.set_value(
        db, org.id, "contact_mekurav", c1.mekurav.id, "contact.potential_next_step", "high"
    )
    picklist_utils.set_value(db, org.id, "contacts", c2.id, "contact.pipeline_status", "sent")
    picklist_utils.set_value(db, org.id, "contacts", c2.id, "contact.color_tag", "green")
    picklist_utils.set_value(
        db, org.id, "contact_mekurav", c2.mekurav.id, "contact.potential_next_step", "medium"
    )

    # fixes25: engagement data (Mivtzoim / interactions / custom fields) is
    # logged per visit, not on the contact.
    v1 = models.VisitHistory(
        organization_id=org.id,
        contact_id=c1.id,
        visit_date=datetime.datetime.utcnow(),
        interactions=[
            {
                "category": "heart_connection",
                "note": "עשיתי, לבדוק שמה",
                "created_at": datetime.datetime.utcnow().isoformat(),
                "author_name": admin.full_name,
            }
        ],
    )
    db.add(v1)
    db.flush()
    # fixes32: torah_thought is picklist-backed (PicklistLink).
    picklist_utils.set_value(db, org.id, "visit_history", v1.id, "checklist.torah_thought", "given")
    # fixes39: tefillin/tzedakah are now custom-field values, not columns.
    custom_field_utils.set_value(db, org.id, "visit", v1.id, "tefillin", True)
    custom_field_utils.set_value(db, org.id, "visit", v1.id, "tzedakah", True)

    # Example custom checklist field for the demo org.
    cf = models.CustomFieldDefinition(
        organization_id=org.id,
        field_key="hanuka_party",
        hebrew_label="מסיבת חנוכה",
        sort_order=0,
    )
    db.add(cf)
    db.flush()
    db.add(
        models.CustomFieldValue(
            organization_id=org.id,
            entity_table="visit_history",
            entity_id=v1.id,
            visit_id=v1.id,
            definition_id=cf.id,
            checked=True,
            note="הגיע עם המשפחה",
        )
    )
    db.commit()


_ROLES = [
    ("admin", 1),
    ("staff", 2),
    ("shliach", 3),
    ("superadmin", 4),
    # fixes58 §3.7: scoped to Apartments/Tasks/Campaigns/Volunteers/shliach-config.
    ("campaign_manager", 5),
]


def seed_roles(db: Session) -> None:
    """fixes43 §5.1: the fixed platform role set backing `users.role`'s FK.
    Must run before any user is created/updated. Idempotent."""
    existing = {r.name for r in db.query(models.Role).all()}
    dirty = False
    for name, sort_order in _ROLES:
        if name not in existing:
            db.add(models.Role(name=name, sort_order=sort_order))
            dirty = True
    if dirty:
        db.commit()


_BUILDING_TYPES = [
    ("building", "Building", "בניין"),
    ("town_house", "Town house", "בית פרטי"),
    ("divided_town_house", "Divided town house", "בית מחולק"),
]


def seed_building_types(db: Session) -> None:
    """fixes63: the fixed building-type set backing `buildings.building_type_id`'s
    FK. Must run before any building is created/updated. Idempotent."""
    existing = {r.id for r in db.query(models.BuildingType).all()}
    dirty = False
    for id_, name_en, name_he in _BUILDING_TYPES:
        if id_ not in existing:
            db.add(models.BuildingType(id=id_, name_en=name_en, name_he=name_he))
            dirty = True
    if dirty:
        db.commit()


def seed_superadmin(db: Session) -> None:
    """Seed the platform superadmin into a dedicated System organization.

    Runs in every environment (independent of SEED_DEMO_DATA) but only when both
    SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD are set. Idempotent: keyed on the
    globally-unique email. The superadmin is a pure-platform account (no tenant
    data) — it exists only to reach the /api/admin/* endpoints.
    """
    if not settings.superadmin_email or not settings.superadmin_password:
        logger.warning(
            "Superadmin seed SKIPPED: SUPERADMIN_EMAIL and/or SUPERADMIN_PASSWORD "
            "not set (email_set=%s, password_set=%s)",
            bool(settings.superadmin_email),
            bool(settings.superadmin_password),
        )
        return

    existing = (
        db.query(models.User)
        .filter(models.User.email == settings.superadmin_email)
        .first()
    )
    if existing is not None:
        # Keep the role/credentials in sync in case env values changed.
        if existing.role != "superadmin":
            existing.role = "superadmin"
        if settings.superadmin_username:
            existing.username = settings.superadmin_username
        existing.password_hash = hash_password(settings.superadmin_password)
        existing.is_active = True
        existing.email_verified = True
        db.commit()
        logger.info(
            "Superadmin present (updated role/password): %s username=%s",
            existing.email,
            existing.username,
        )
        return

    system_org = (
        db.query(models.Organization)
        .filter(models.Organization.name == settings.system_org_name)
        .first()
    )
    if system_org is None:
        system_org = models.Organization(name=settings.system_org_name)
        db.add(system_org)
        db.flush()

    db.add(
        models.User(
            organization_id=system_org.id,
            username=settings.superadmin_username,
            full_name=settings.superadmin_name,
            email=settings.superadmin_email,
            password_hash=hash_password(settings.superadmin_password),
            role="superadmin",
            is_active=True,
            email_verified=True,
        )
    )
    db.commit()
    logger.info(
        "Superadmin CREATED: %s (username '%s') in org '%s'",
        settings.superadmin_email,
        settings.superadmin_username,
        system_org.name,
    )


def seed_email_templates(db: Session) -> None:
    """Insert any missing editable email templates (idempotent, never overwrites
    an admin's edits). Defaults live in app.core.email.DEFAULT_EMAIL_TEMPLATES."""
    from app.core.email import DEFAULT_EMAIL_TEMPLATES

    existing = {
        k for (k,) in db.query(models.EmailTemplate.key).all()
    }
    added = False
    for key, tpl in DEFAULT_EMAIL_TEMPLATES.items():
        if key in existing:
            continue
        db.add(
            models.EmailTemplate(
                key=key,
                subject=tpl.get("subject", ""),
                body=tpl.get("body", ""),
                body_hebrew=tpl.get("body_hebrew", ""),
            )
        )
        added = True
    if added:
        db.commit()


def seed_all(db: Session) -> None:
    """Global labels (always) + a demo organization (admin + picklists + sample
    data) when SEED_DEMO_DATA is enabled. In production the demo block is skipped
    so no default admin/admin123 or sample contacts reach the live database.
    """
    seed_roles(db)
    seed_building_types(db)
    seed_localization(db)
    seed_superadmin(db)
    seed_email_templates(db)
    seed_system_settings(db)

    # Backfill system picklist *definitions* for EVERY org (idempotent). An org
    # created before a given system picklist existed would otherwise never see it
    # on the picklists page — only its custom lists would show. Definitions only
    # (never options), so an admin's add/remove of values is untouched. Runs in
    # all environments, including production.
    for (org_id,) in db.query(models.Organization.id).all():
        seed_picklist_definitions(db, org_id)
        seed_default_options_for_empty_lists(db, org_id)
        backfill_picklist_english_values(db, org_id)
        seed_visit_mivtzoim_custom_fields(db, org_id)
        seed_apartment_custom_fields(db, org_id)

    if not settings.seed_demo_data:
        return

    # Resolve the demo admin idempotently. Email is globally unique, so an existing
    # admin is the source of truth — even if the user has since renamed its org (the
    # org name is the app title). This avoids re-creating the org / colliding on the
    # unique email on every startup.
    admin = (
        db.query(models.User)
        .filter(models.User.email == settings.admin_email)
        .first()
    )
    if admin is not None:
        org = admin.organization
    else:
        org = (
            db.query(models.Organization)
            .filter(models.Organization.name == settings.demo_org_name)
            .first()
        )
        if org is None:
            org = models.Organization(name=settings.demo_org_name)
            db.add(org)
            db.flush()

        admin = models.User(
            organization_id=org.id,
            username=settings.admin_username,
            full_name=settings.admin_full_name,
            email=settings.admin_email,
            password_hash=hash_password(settings.admin_password),
            role="admin",
            is_active=True,
            email_verified=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

    # Default map center for the demo org (Sheepshead Bay) — config-editable later.
    if org.default_lat is None:
        org.default_lat = 40.5862
        org.default_lng = -73.9442
        org.default_zoom = 13
        db.commit()

    seed_picklists(db, org.id)
    seed_picklist_definitions(db, org.id)
    seed_visit_mivtzoim_custom_fields(db, org.id)
    seed_apartment_custom_fields(db, org.id)
    _seed_sample_data(db, org, admin)
