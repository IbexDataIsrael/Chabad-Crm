"""fixes94: every error message the API can show a user, in the localization
table (category "error"), so it can be read and edited on the translations
page and shown in the user's language.

Two kinds of entries:

- PLAIN_ERRORS — fixed messages raised as plain text (HTTPException detail,
  validation errors). Their key is derived from the English text itself,
  `error_key(text)` → "error.<slug>"; the frontend derives the same key from
  the message it receives (lib/errorText.ts `errorKey`, same algorithm).
- CODED_ERRORS — messages that include values. They're raised with
  `app.core.errors.api_error(status, code, template, **params)`, which sends
  {code, message, params}; the frontend shows t(code) with the {params}
  filled in.

tests/test_error_localization.py fails when a backend message has no row
here, so a new message can't slip past the table.
"""
import re

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def error_key(message: str) -> str:
    """"Email already registered" → "error.email_already_registered".
    MUST match frontend/lib/errorText.ts errorKey()."""
    slug = _SLUG_RE.sub("_", message.lower()).strip("_")[:80].rstrip("_")
    return f"error.{slug}"


# (English message exactly as raised, Hebrew)
PLAIN_ERRORS: list[tuple[str, str]] = [
    ("A shliach cannot create shliach contacts", "פעיל אינו יכול ליצור אנשי קשר מסוג פעיל"),
    ("A valid email is required", "יש להזין כתובת אימייל תקינה"),
    ("AI query is disabled for this organization", "שאילתת AI כבויה בארגון זה"),
    ("AI query is not configured (ANTHROPIC_API_KEY is missing)", "שאילתת AI אינה מוגדרת (חסר מפתח API)"),
    ("Activist not found", "הפעיל לא נמצא"),
    ("Admin area not found", "האזור המותאם לא נמצא"),
    ("Admin or campaign manager privileges required", "נדרשות הרשאות מנהל או מנהל קמפיינים"),
    ("Admin or staff privileges required", "נדרשות הרשאות מנהל או משתמש מוגבל"),
    ("Admin privileges required", "נדרשות הרשאות מנהל"),
    ("Admin privileges required for these fields", "נדרשות הרשאות מנהל לעדכון השדות האלה"),
    ("Admin, staff, or campaign manager privileges required", "נדרשות הרשאות מנהל, משתמש מוגבל או מנהל קמפיינים"),
    ("An assigned task can't be available — return it to the pool instead", "משימה משויכת לא יכולה להיות פנויה — יש להחזיר אותה למאגר"),
    ("Announcement not found", "ההודעה לא נמצאה"),
    ("Apartment does not belong to this task", "הדירה אינה שייכת למשימה הזו"),
    ("Apartment not found", "הדירה לא נמצאה"),
    ("Area not found", "האזור לא נמצא"),
    ("Assign an activist to mark the task as taken", "יש לשייך פעיל כדי לסמן את המשימה כנלקחה"),
    ("Backup not found", "הגיבוי לא נמצא"),
    ("Building not found", "הבניין לא נמצא"),
    ("Campaign managers cannot access this resource", "למנהלי קמפיינים אין גישה לכאן"),
    ("Campaign not found", "הקמפיין לא נמצא"),
    ("Cannot delete the system organization", "לא ניתן למחוק את ארגון המערכת"),
    ("Cannot disable the system organization", "לא ניתן להשבית את ארגון המערכת"),
    ("Cannot impersonate the system organization", "לא ניתן להתחבר כארגון המערכת"),
    ("Cannot modify a superadmin account", "לא ניתן לשנות חשבון מנהל מערכת"),
    ("Cloudinary is not configured", "שירות התמונות (Cloudinary) אינו מוגדר"),
    ("Completion not found", "רישום ההשלמה לא נמצא"),
    ("Contact not found", "איש הקשר לא נמצא"),
    ("Could not validate credentials", "פג תוקף ההתחברות — יש להתחבר מחדש"),
    ("Current password is incorrect", "הסיסמה הנוכחית שגויה"),
    ("Custom field not found", "השדה המותאם לא נמצא"),
    ("Donation not found", "התרומה לא נמצאה"),
    ("Email already registered", "כתובת האימייל כבר רשומה"),
    ("Email is required", "יש להזין כתובת אימייל"),
    ("Email template not found", "תבנית האימייל לא נמצאה"),
    ("Empty prompt", "השאלה ריקה"),
    ("Enter the name of who performed the work", "יש להזין את שם מי שביצע את העבודה"),
    ("File must be an image", "הקובץ חייב להיות תמונה"),
    ("Floor name is required", "יש להזין שם קומה"),
    ("Floor not found", "הקומה לא נמצאה"),
    ("Google account has no email", "לחשבון Google אין כתובת אימייל"),
    ("Image too large (max 5MB)", "התמונה גדולה מדי (עד 5MB)"),
    ("Invalid Google token", "ההתחברות עם Google נכשלה"),
    ("Invalid or expired verification token", "קישור האימות אינו תקף או שפג תוקפו"),
    ("Invalid preference key", "מפתח העדפה לא תקין"),
    ("Invalid verification token", "קישור האימות אינו תקף"),
    ("Localization string not found", "מחרוזת התרגום לא נמצאה"),
    ("No active admin to impersonate in this organization", "אין בארגון מנהל פעיל להתחבר בשמו"),
    ("No linked activist profile", "אין פרופיל פעיל מקושר"),
    ("No linked shliach contact", "אין איש קשר מסוג פעיל מקושר"),
    ("No report numbers selected", "לא נבחרו מספרי דוח"),
    ("No shliach contact with this email", "אין פעיל עם כתובת האימייל הזו"),
    ("Not one of your tasks", "זו לא אחת המשימות שלך"),
    ("Not your apartment", "הדירה אינה משויכת אליך"),
    ("Only an activist can submit this", "רק פעיל יכול לשלוח את זה"),
    ("Only an activist's own app syncs", "רק האפליקציה של הפעיל עצמו מסתנכרנת"),
    ("Organization is required", "יש לבחור ארגון"),
    ("Organization not found", "הארגון לא נמצא"),
    ("Page not found", "הדף לא נמצא"),
    (
        "Password must be at least 8 characters with an uppercase letter, a lowercase letter, and a number.",
        "הסיסמה חייבת לכלול לפחות 8 תווים, אות גדולה, אות קטנה וספרה.",
    ),
    ("Picklist definition not found", "רשימת הבחירה לא נמצאה"),
    ("Picklist value not found", "ערך רשימת הבחירה לא נמצא"),
    ("Preference value too large", "ערך ההעדפה גדול מדי"),
    ("Registration is closed for this organization", "ההרשמה לארגון זה סגורה"),
    ("Report number not found", "מספר הדוח לא נמצא"),
    ("Select at least one field to update", "יש לבחור לפחות שדה אחד לעדכון"),
    ("Select at least one floor and one label", "יש לבחור לפחות קומה אחת ותווית אחת"),
    ("Select who performed the work", "יש לבחור מי ביצע את העבודה"),
    ("Shliach contact not found", "הפעיל לא נמצא"),
    ("Shliach users cannot edit the apartment number", "פעילים אינם יכולים לערוך את מספר הדירה"),
    ("Significant date not found", "התאריך המיוחד לא נמצא"),
    ("Significant dates apply to mekurav contacts", "תאריכים מיוחדים שייכים לאנשי קשר מסוג מקורב"),
    ("Some report numbers already belong to a task in this campaign", "חלק ממספרי הדוח כבר שייכים למשימה בקמפיין הזה"),
    ("Superadmin privileges required", "נדרשות הרשאות מנהל מערכת"),
    ("System picklists cannot be deleted", "לא ניתן למחוק רשימות מערכת"),
    ("Task not found", "המשימה לא נמצאה"),
    ("Message not found", "ההודעה לא נמצאה"),
    ("A text task needs text and no report numbers", "משימת טקסט צריכה טקסט וללא מספרי דוח"),
    ("The activist system is disabled for this organization", "מערכת הפעילים כבויה בארגון זה"),
    ("This email is already registered — please sign in instead", "כתובת האימייל כבר רשומה — יש להתחבר במקום להירשם"),
    ("This page address is already taken", "כתובת הדף כבר תפוסה"),
    ("This task has no apartments to print", "אין במשימה הזו דירות להדפסה"),
    ("This task link is no longer valid", "הקישור למשימה אינו בתוקף עוד"),
    ("User not found", "המשתמש לא נמצא"),
    ("Username already taken", "שם המשתמש כבר תפוס"),
    ("Username is required", "יש להזין שם משתמש"),
    ("Username must be at most 50 characters", "שם המשתמש יכול להכיל עד 50 תווים"),
    ("Visit not found", "הביקור לא נמצא"),
    ("You can only edit apartments assigned to you", "אפשר לערוך רק דירות שמשויכות אליך"),
    ("You cannot delete yourself", "לא ניתן למחוק את עצמך"),
    ("You cannot demote or deactivate yourself", "לא ניתן להוריד את ההרשאות של עצמך או להשבית את עצמך"),
    ("admin_area_id does not exist", "האזור המותאם שנבחר לא קיים"),
    ("apartment_id does not exist", "הדירה שנבחרה לא קיימת"),
    ("area_id does not exist", "האזור שנבחר לא קיים"),
    ("assigned_user_id does not exist", "המשתמש המשויך לא קיים"),
    ("building_id does not exist", "הבניין שנבחר לא קיים"),
    ("campaign_id does not exist", "הקמפיין שנבחר לא קיים"),
    ("comment cannot be blank", "ההערה לא יכולה להיות ריקה"),
    ("contact_id does not exist", "איש הקשר שנבחר לא קיים"),
    ("contact_id is not a shliach contact", "איש הקשר שנבחר אינו פעיל"),
    ("custom_date_value_id does not exist", "התאריך המותאם שנבחר לא קיים"),
    ("page_size must be 20, 50 or 100", "גודל עמוד חייב להיות 20, 50 או 100"),
    ("report_number_id does not exist", "מספר הדוח שנבחר לא קיים"),
    ("shliach users cannot reassign contacts", "פעילים אינם יכולים להעביר אנשי קשר"),
    ("version not found in this apartment's history", "הגרסה לא נמצאה בהיסטוריית הדירה"),
    ("version not found in this shliach's history", "הגרסה לא נמצאה בהיסטוריית הפעיל"),
    ("volunteer_user_id does not exist", "הפעיל שנבחר לא קיים"),
    # Formerly Hebrew-only in the code (fixes94 made the code English).
    ("This phone number already exists in the organization", "מספר טלפון זה כבר קיים בארגון"),
    ("This email is already used by another user in the organization", "כתובת אימייל זו כבר בשימוש אצל משתמש אחר בארגון"),
    (
        "This email belongs to an existing user in the organization who is not an activist",
        "כתובת אימייל זו שייכת למשתמש קיים בארגון שאינו פעיל",
    ),
    ("This email already belongs to another activist in the organization", "כתובת אימייל זו כבר משויכת לפעיל אחר בארגון"),
    # Structured details that carry a message (picklists "in use" payload).
    ("Picklist value is in use", "ערך הרשימה נמצא בשימוש"),
    # Validation (422) messages raised from request schemas.
    ("Address is required", "יש להזין כתובת"),
    ("Full name is required", "יש להזין שם מלא"),
    ("Invalid email address", "כתובת אימייל לא תקינה"),
    ("Invalid phone number — expected an Israeli or US/Canada number", "מספר טלפון לא תקין — יש להזין מספר ישראלי או אמריקאי/קנדי"),
    ("Name is required", "יש להזין שם"),
    ("Slug may contain only lowercase English letters, digits and dashes", "כתובת הדף יכולה להכיל רק אותיות אנגליות קטנות, ספרות ומקפים"),
    ("Field required", "שדה חובה"),
    # Generic HTTP / framework messages.
    ("Not Found", "לא נמצא"),
    ("Not authenticated", "יש להתחבר"),
    ("Unauthorized", "אין הרשאה — יש להתחבר מחדש"),
    ("Forbidden", "אין הרשאה"),
    ("Internal Server Error", "שגיאת שרת"),
    ("Server is busy, please try again", "השרת עמוס, נסו שוב בעוד רגע"),
    ("Bad Request", "בקשה לא תקינה"),
    ("Unprocessable Entity", "הנתונים שנשלחו אינם תקינים"),
    ("Method Not Allowed", "הפעולה אינה מותרת"),
    ("Conflict", "התנגשות בנתונים"),
    ("Bad Gateway", "שירות חיצוני אינו זמין"),
]

# code → (English template, Hebrew template); {name} placeholders = params.
CODED_ERRORS: dict[str, tuple[str, str]] = {
    "error.unknown_custom_field": ("unknown custom field '{field}'", "שדה מותאם לא מוכר: '{field}'"),
    "error.select_field_use_picklist": (
        "'{field}' is a select field — set it via picklist_values, not custom_field_values",
        "'{field}' הוא שדה בחירה — יש לעדכן אותו דרך רשימות הבחירה",
    ),
    "error.not_a_number": ("'{value}' is not a valid number", "'{value}' אינו מספר תקין"),
    "error.not_a_date": ("'{value}' is not a valid ISO date", "'{value}' אינו תאריך תקין"),
    "error.value_not_allowed": ("'{value}' is not an allowed value for {field}", "'{value}' אינו ערך מותר בשדה {field}"),
    "error.unknown_picklist": ("unknown picklist '{field}'", "רשימת בחירה לא מוכרת: '{field}'"),
    "error.ai_service_error": ("AI service returned an error: {detail}", "שירות ה-AI החזיר שגיאה: {detail}"),
    "error.ai_unexpected_shape": ("Unexpected AI response shape: {detail}", "תשובה לא צפויה משירות ה-AI: {detail}"),
    "error.ai_invalid_json": (
        "Unexpected AI response (not valid JSON): {detail}",
        "תשובת שירות ה-AI אינה JSON תקין: {detail}",
    ),
    "error.field_not_restorable": ("field '{field}' cannot be restored", "לא ניתן לשחזר את השדה '{field}'"),
    "error.floor_not_in_building": (
        "floor {floor_id} does not belong to this building",
        "קומה {floor_id} אינה שייכת לבניין הזה",
    ),
    "error.unknown_field_key": ("unknown field_key '{field}'", "מפתח שדה לא מוכר: '{field}'"),
    "error.admin_only_fields": ("Only admins may set {fields}", "רק מנהל יכול לעדכן את: {fields}"),
    "error.not_a_custom_field": ("'{key}' is not a custom field", "'{key}' אינו שדה מותאם"),
    "error.unknown_entity_type": ("unknown entity_type '{value}'", "סוג ישות לא מוכר: '{value}'"),
    "error.unknown_field_type": ("unknown field_type '{value}'", "סוג שדה לא מוכר: '{value}'"),
    "error.field_key_exists": (
        "field_key '{field}' already exists for {entity}",
        "המפתח '{field}' כבר קיים עבור {entity}",
    ),
    "error.picklist_exists": ("picklist '{name}' already exists", "רשימת הבחירה '{name}' כבר קיימת"),
    "error.technical_name_exists": ("technical_name '{name}' already exists", "המפתח '{name}' כבר קיים"),
    "error.gallery_max": ("A gallery holds at most {max} images", "הגלריה יכולה להכיל לכל היותר {max} תמונות"),
    "error.picklist_value_exists": (
        "value '{value}' already exists for {field}",
        "הערך '{value}' כבר קיים בשדה {field}",
    ),
    "error.picklist_id_mismatch": ("id {id} does not belong to {field}", "המזהה {id} אינו שייך ל-{field}"),
    "error.too_many_report_numbers": (
        "At most {max} report numbers at once",
        "לכל היותר {max} מספרי דוח בבת אחת",
    ),
    "error.cannot_read_range": (
        "Can't read '{part}' — use numbers and ranges like 10-40",
        "לא ניתן לקרוא את '{part}' — יש להשתמש במספרים ובטווחים כמו 10-40",
    ),
    "error.range_too_big": ("A range can cover at most {max} numbers", "טווח יכול לכלול לכל היותר {max} מספרים"),
    "error.definition_not_found": ("definition_id {id} does not exist", "ההגדרה {id} לא קיימת"),
    "error.email_taken_by_activist": (
        "This email already belongs to another activist in the organization: {name} (#{id})",
        "כתובת אימייל זו כבר משויכת לפעיל אחר בארגון: {name} (#{id})",
    ),
    "error.clone_failed": ("Clone failed: {reason}", "השכפול נכשל: {reason}"),
}


def localization_rows() -> list[tuple[str, str, str, str]]:
    """(entity_type, technical_name, hebrew, english) rows for seed.LOCALIZATION."""
    rows = [("error", error_key(en), he, en) for en, he in PLAIN_ERRORS]
    rows += [("error", code, he, en) for code, (en, he) in CODED_ERRORS.items()]
    return rows
