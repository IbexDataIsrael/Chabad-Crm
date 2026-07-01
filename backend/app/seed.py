"""Idempotent database seeding (multi-tenant).

- `seed_localization`  — global Hebrew UI labels (no org).
- `provision_org`      — seed a single org's picklists (+ default region). Used on
                          email verification (Phase 8) and for the demo org.
- `seed_all`           — global labels + a demo organization with admin + sample data.
"""
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.core.security import hash_password
from app.picklist_utils import PICKLIST_FIELDS

# (entity_type, technical_name, hebrew_label, english_label) — global UI strings.
# entity_type groups them ('table'/'column'/'interaction_category'/'nav'/'action'/
# 'auth'/'page'/'msg'/'field'). technical_name is the key used by the frontend `t()`.
LOCALIZATION: list[tuple[str, str, str, str]] = [
    ("table", "users", "משתמשים", "Users"),
    ("table", "contacts", "אנשי קשר", "Contacts"),
    ("table", "community_checklists", "מצוות קהילה", "Community mitzvot"),
    ("table", "interactions", "אינטראקציות", "Interactions"),
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
    ("column", "contact_mekurav.rebbe_connection", "קשר לרבי", "Connection to the Rebbe"),
    ("column", "contact_mekurav.recommendations", "המלצות", "Recommendations"),
    ("column", "contact_mekurav.background", "רקע", "Background"),
    ("column", "contact_shliach.notes", "הערות", "Notes"),
    ("column", "areas.area_name", "כותרת", "Title"),
    ("column", "areas.area_notes", "הערות", "Notes"),
    ("column", "areas.area_polygon", "תחום פוליגון", "Polygon boundary"),
    ("column", "buildings.area_id", "אזור", "Area"),
    ("column", "buildings.building_name", "שם בניין", "Building name"),
    ("column", "buildings.building_address", "כתובת בניין", "Building address"),
    ("column", "buildings.longitude", "קו אורך", "Longitude"),
    ("column", "buildings.latitude", "קו רוחב", "Latitude"),
    ("column", "apartments.building_id", "בניין", "Building"),
    ("column", "apartments.apartment_name", "כותרת", "Title"),
    ("column", "apartments.apartment_notes", "הערות", "Notes"),
    ("column", "significant_dates.special_date", "תאריך חשוב", "Significant date"),
    ("column", "significant_dates.hebrew_date", "תאריך עברי", "Hebrew date"),
    ("column", "significant_dates.special_date_type", "סוג תאריך", "Date type"),
    ("column", "significant_dates.special_date_title", "כותרת", "Title"),
    ("column", "significant_dates.is_set_reminder", "האם לשלוח תזכורת", "Send a reminder"),
    ("column", "users.username", "שם משתמש", "Username"),
    ("column", "users.full_name", "שם מלא", "Full name"),
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
    ("nav", "nav.settings", "הגדרות", "Settings"),
    ("nav", "nav.donations", "תרומות", "Donations"),
    ("nav", "nav.visits", "ביקורים", "Visits"),
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
    # Header dropdown group labels.
    ("nav", "nav.group.people", "אנשים", "People"),
    ("nav", "nav.group.places", "מקומות", "Places"),
    ("nav", "nav.group.more", "עוד", "More"),
    # --- Common actions / words ---
    ("action", "action.save", "שמור", "Save"),
    ("action", "action.save_changes", "שמור שינויים", "Save changes"),
    ("action", "action.cancel", "ביטול", "Cancel"),
    ("action", "action.add", "הוסף", "Add"),
    ("action", "action.edit", "ערוך", "Edit"),
    ("action", "action.delete", "מחק", "Delete"),
    ("action", "action.remove", "הסר", "Remove"),
    ("action", "action.back", "חזרה", "Back"),
    ("action", "action.logout", "התנתק", "Log out"),
    ("action", "action.saving", "שומר…", "Saving…"),
    ("action", "action.loading", "טוען…", "Loading…"),
    ("action", "action.saved", "נשמר ✓", "Saved ✓"),
    ("action", "common.admin", "מנהל", "Admin"),
    ("action", "common.or", "או", "or"),
    ("action", "common.yes", "כן", "Yes"),
    ("action", "common.no", "לא", "No"),
    ("action", "common.none_dash", "—", "—"),
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
    ("auth", "auth.google_failed", "התחברות עם Google נכשלה", "Google sign-in failed"),
    ("auth", "auth.google_load_failed", "טעינת ההתחברות עם Google נכשלה", "Failed to load Google sign-in"),
    ("auth", "signup.title", "פתיחת חשבון ארגון", "Open an organization account"),
    ("auth", "signup.subtitle", "צור ארגון חדש ב-CRM", "Create a new CRM organization"),
    ("auth", "signup.org_name", "שם הארגון", "Organization name"),
    ("auth", "signup.create", "צור חשבון", "Create account"),
    ("auth", "signup.creating", "נרשם…", "Registering…"),
    ("auth", "signup.google_hint", "הרשמה מהירה עם Google — די למלא שם ארגון בלבד.", "Quick sign-up with Google — just fill in an organization name."),
    ("auth", "signup.google_failed", "ההרשמה עם Google נכשלה", "Google sign-up failed"),
    ("auth", "signup.org_required_for_google", "יש למלא שם ארגון לפני ההרשמה עם Google", "Please enter an organization name before signing up with Google"),
    ("auth", "signup.check_email_title", "בדוק את האימייל שלך", "Check your email"),
    ("auth", "signup.resend_link", "שליחת הקישור מחדש", "Resend the link"),
    ("auth", "signup.failed", "ההרשמה נכשלה", "Registration failed"),
    # --- Pages / sections ---
    ("page", "page.areas_intro", "אזורים גאוגרפיים עם תחום פוליגון על המפה. השלוחים המכסים כל אזור מוצגים תחתיו.", "Geographic areas with a polygon boundary on the map. The activists covering each area are listed below it."),
    ("page", "page.add_area", "אזור חדש", "New area"),
    ("page", "page.edit_area", "עריכת אזור", "Edit area"),
    ("page", "page.back_to_areas", "← חזרה לאזורים", "← Back to areas"),
    ("page", "page.no_areas", "אין אזורים עדיין.", "No areas yet."),
    ("page", "page.area_has_boundary", "תחום מוגדר", "Boundary set"),
    ("page", "page.area_no_boundary", "ללא תחום", "No boundary"),
    ("page", "page.show_details", "הצג פרטים ומפה", "Show details & map"),
    ("page", "page.hide_details", "הסתר פרטים", "Hide details"),
    ("page", "page.shluchim", "פעילים", "Activists"),
    ("page", "page.hide_shluchim", "הסתר פעילים", "Hide activists"),
    ("page", "page.no_shluchim_area", "אין פעילים המכסים אזור זה.", "No activists cover this area."),
    ("page", "page.org_settings", "הגדרות ארגון", "Organization settings"),
    ("page", "page.map_in_english", "השלמת כתובות במפה באנגלית", "Address autocomplete in English"),
    ("page", "page.map_in_english_hint", "כאשר מסומן, הצעות הכתובת מ-Google יוחזרו באנגלית במקום בעברית.", "When checked, Google address suggestions are returned in English instead of Hebrew."),
    ("page", "page.map_default_center", "מרכז ברירת מחדל למפה", "Default map center"),
    ("page", "page.map_center_hint", "נקודת ההתחלה של מפת האזורים (קו רוחב, קו אורך, מרחק תצוגה).", "The areas map's starting point (latitude, longitude, zoom)."),
    ("page", "page.localization_title", "תרגומים", "Translations"),
    ("page", "page.localization_intro", "ערוך את טקסטי הממשק בעברית ובאנגלית.", "Edit the interface texts in Hebrew and English."),
    ("page", "page.localization_reload_hint", "שינויים ייכנסו לתוקף בכל המערכת לאחר רענון הדף.", "Changes take effect across the system after refreshing the page."),
    ("page", "page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).", "You don't have permission for this page (admins only)."),
    # --- Messages ---
    ("msg", "msg.save_failed", "שמירה נכשלה", "Save failed"),
    ("msg", "msg.saved", "נשמר בהצלחה", "Saved successfully"),
    ("msg", "msg.added", "נוסף בהצלחה", "Added successfully"),
    ("msg", "msg.deleted", "נמחק", "Deleted"),
    ("msg", "msg.hidden", "השדה הוסתר", "Field hidden"),
    ("msg", "msg.shown", "השדה הוצג", "Field shown"),
    ("msg", "msg.load_failed", "טעינה נכשלה", "Load failed"),
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
    ("auth", "signup.sent_to", "שלחנו קישור אימות אל", "We sent a verification link to"),
    ("auth", "signup.click_to_activate", "יש ללחוץ על הקישור כדי להפעיל את חשבון הארגון.", "Click the link to activate your organization account."),
    ("auth", "signup.back_to_login", "חזרה להתחברות", "Back to sign in"),
    ("auth", "signup.verify_password", "אימות סיסמה", "Confirm password"),
    # --- Validation hints ---
    ("field", "validation.phone_hint", "מספר טלפון ישראלי (לדוגמה 052-1234567) או אמריקאי/קנדי (לדוגמה 718-888-9770).", "Israeli (e.g. 052-1234567) or US/Canada (e.g. 718-888-9770) phone number."),
    ("field", "validation.email_hint", "כתובת אימייל תקינה, לדוגמה name@example.com", "A valid email address, e.g. name@example.com"),
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
    ("page", "page.contact_details", "פרטי איש קשר", "Contact details"),
    ("page", "page.extra_fields", "שדות נוספים", "Additional fields"),
    ("filter", "filter.all_areas", "כל האזורים", "All areas"),
    ("filter", "filter.all_statuses", "כל הסטטוסים", "All statuses"),
    ("action", "common.name", "שם", "Name"),
    ("action", "action.open_edit", "פתח / עריכה ›", "Open / edit ›"),
    ("column", "contacts.email_for_login", "להתחברות", "for sign-in"),
    ("column", "contact_shliach.apartments", "דירות באחריות הפעיל", "Apartments covered by the activist"),
    ("column", "contact_shliach.areas", "אזורים באחריות הפעיל", "Areas covered by the activist"),
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
    ("apt", "apt.no_apartments", "אין דירות עדיין.", "No apartments yet."),
    ("apt", "apt.add_building_apartment", "הוסף בניין ודירה", "Add a building and apartment"),
    ("apt", "apt.to_link_shliach", "כדי לשייך לפעיל.", "to assign to an activist."),
    ("apt", "apt.search_placeholder", "חפש דירה לפי שם דירה או בניין…", "Search by apartment or building name…"),
    ("apt", "apt.no_apartments_page", "אין דירות להצגה.", "No apartments to show."),
    ("apt", "apt.no_contact", "ללא איש קשר", "No contact"),
    ("apt", "apt.select_building", "יש לבחור בניין", "Please select a building"),
    ("apt", "apt.new_apartment", "דירה חדשה", "New apartment"),
    ("apt", "apt.associate_contact", "שייך איש קשר קיים (לא חובה)", "Link an existing contact (optional)"),
    ("page", "page.no_shluchim", "אין פעילים עדיין.", "No activists yet."),
    ("page", "page.donations_intro", "היסטורית תרומות. ניתן לשייך תרומה לאיש קשר או להשאיר ללא שיוך.", "Donation history. A donation can be linked to a contact or left unlinked."),
    # --- Visit history ---
    ("visit", "visit.history", "היסטורית ביקורים", "Visit history"),
    ("visit", "visit.add", "הוסף ביקור", "Add visit"),
    ("visit", "visit.none", "אין ביקורים עדיין.", "No visits yet."),
    ("visit", "visit.date", "תאריך", "Date"),
    ("visit", "visit.notes", "הערות", "Notes"),
    ("visit", "visit.pick_date", "יש לבחור תאריך", "Please choose a date"),
    ("visit", "visit.delete_confirm", "למחוק ביקור זה?", "Delete this visit?"),
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
    ("int", "int.category_placeholder", "קטגוריה…", "Category…"),
    ("int", "int.add_note_placeholder", "הוסף הערה…", "Add a note…"),
    ("int", "int.none", "אין אינטראקציות עדיין.", "No interactions yet."),
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
    ("shliach", "shliach.add_area_first", "נא להוסיף אזור קודם", "Please add an area first"),
    ("shliach", "shliach.select_area_first", "יש לבחור אזור תחילה", "Select an area first"),
    ("shliach", "shliach.no_buildings_in_area", "אין בניינים באזורים שנבחרו.", "No buildings in the selected areas."),
    # --- User-facing error messages (editable in the localization page) ---
    ("error", "error.no_areas_for_shliach", "נא להוסיף לפחות אזור אחד למערכת", "Please add at least 1 area to the system"),
    ("column", "contact_shliach.relate_building", "שייך בניין (יוסיף את כל דירותיו)", "Relate a building (adds all its apartments)"),
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
    ("cf", "cf.intro", "כל שדה הוא תיבת סימון + הערה, ויופיע בכרטיס איש הקשר. לדוגמה: מסיבת חנוכה.", "Each field is a checkbox + note shown on the contact card. e.g. Hanukkah party."),
    ("cf", "cf.none", "אין שדות מותאמים עדיין.", "No custom fields yet."),
    ("cf", "cf.disabled", "מושבת", "Disabled"),
    ("cf", "cf.activate", "הפעל", "Activate"),
    ("cf", "cf.hard_delete", "מחק לצמיתות", "Delete permanently"),
    ("cf", "cf.hard_delete_confirm", "למחוק לצמיתות את כל הערכים?", "Permanently delete this and all its values?"),
    ("cf", "cf.add_failed", "הוספה נכשלה", "Failed to add"),
    ("cf", "cf.add_field", "הוספת שדה", "Add field"),
    ("cf", "cf.key_placeholder", "מפתח (אנגלית) — hanuka_party", "Key (English) — hanuka_party"),
    ("cf", "cf.label_placeholder", "תווית בעברית", "Hebrew label"),
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
    ("pl", "pl.add_list", "הוספת רשימת בחירה", "Add picklist"),
    ("pl", "pl.system_name_placeholder", "מזהה (אנגלית) — diet", "Identifier (English) — diet"),
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
]

# Picklist definition display names (he from PICKLIST_FIELDS; en where known per spec).
PICKLIST_ENGLISH_DISPLAY: dict[str, str] = {
    "Jewish_status": "Jewish status",
    "affiliation": "affiliation",
    "language": "language",
    "visit.type": "Visit type",
}


def seed_localization(db: Session) -> None:
    """Insert any missing global localization rows; backfill English on existing rows.

    Idempotent: new rows are added; existing rows get `english_label` set if still blank
    (so re-seeding fills in translations added to the seed list over time).
    """
    rows = {r.technical_name: r for r in db.query(models.FieldLocalization).all()}
    seen: set[str] = set()
    dirty = False
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
            is_system=True,
            sort_order=index,
        )
        for index, (system_name, hebrew_display) in enumerate(PICKLIST_FIELDS.items())
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


def provision_org(db: Session, organization_id: int) -> None:
    """Set up a newly activated organization with its default picklists."""
    seed_picklists(db, organization_id)
    seed_picklist_definitions(db, organization_id)


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
        assigned_user_id=admin.id,
        address="דיזנגוף 100, תל אביב-יפו",
        latitude=32.0809,
        longitude=34.7738,
        pipeline_status="in_progress",
        priority_score=5,
        color_tag="magenta",
    )
    c1.checklist = models.CommunityChecklist(
        tefillin=True, tzedakah=True, torah_thought="given"
    )
    c1.mekurav = models.ContactMekurav(
        organization_id=org.id,
        potential_next_step="high",
        background="נפגשנו בכנס",
    )

    c2 = models.Contact(
        organization_id=org.id,
        name="דוד",
        last_name="כהן",
        phone="054-7654321",
        contact_type="mekurav",
        assigned_user_id=admin.id,
        pipeline_status="sent",
        priority_score=3,
        color_tag="green",
    )
    c2.checklist = models.CommunityChecklist(torah_thought="not_given")
    c2.mekurav = models.ContactMekurav(
        organization_id=org.id, potential_next_step="medium"
    )

    db.add_all([c1, c2])
    db.flush()

    db.add(
        models.Interaction(
            organization_id=org.id,
            contact_id=c1.id,
            created_by=admin.id,
            category="heart_connection",
            note="עשיתי, לבדוק שמה",
        )
    )

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
            contact_id=c1.id, definition_id=cf.id, checked=True, note="הגיע עם המשפחה"
        )
    )
    db.commit()


def seed_all(db: Session) -> None:
    """Global labels (always) + a demo organization (admin + picklists + sample
    data) when SEED_DEMO_DATA is enabled. In production the demo block is skipped
    so no default admin/admin123 or sample contacts reach the live database.
    """
    seed_localization(db)

    # Backfill system picklist *definitions* for EVERY org (idempotent). An org
    # created before a given system picklist existed would otherwise never see it
    # on the picklists page — only its custom lists would show. Definitions only
    # (never options), so an admin's add/remove of values is untouched. Runs in
    # all environments, including production.
    for (org_id,) in db.query(models.Organization.id).all():
        seed_picklist_definitions(db, org_id)
        seed_default_options_for_empty_lists(db, org_id)

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
    _seed_sample_data(db, org, admin)
