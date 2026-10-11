"""Default bodies for the superadmin-editable email templates.

Every template is built from one of two branded layouts in backend/HTML:
`email_layout_en.html` (LTR) and `email_layout_he.html` (RTL). The layout's
`[[title]]`, `[[content]]` and `[[card_footer]]` are filled here, once, when the
defaults are built; the `{{placeholders}}` stay in the HTML and are substituted
at send time. The superadmin sees/edits the resulting full documents.

Logos: `{{logo_url}}` is the header logo — the organization's own logo for
mail an activist/org user receives (shliach_welcome, password_reset), the
platform logo for everything else. `{{system_logo_url}}` (footer) is always the
platform logo.
"""
import hashlib
import re
from pathlib import Path

HTML_DIR = Path(__file__).resolve().parents[2] / "HTML"

BRAND = "#1695c0"  # globals.css --primary (195 79% 42%)
FONT = "'Heebo',Arial,Helvetica,sans-serif"


def _layout(lang: str) -> str:
    return (HTML_DIR / f"email_layout_{lang}.html").read_text(encoding="utf-8")


def build(lang: str, title: str, content: str, card_footer: str) -> str:
    """One full email document from the `lang` ('en' | 'he') layout."""
    return (
        _layout(lang)
        .replace("[[title]]", title)
        .replace("[[content]]", content)
        .replace("[[card_footer]]", card_footer)
    )


# --- content building blocks (inline styles only — email clients) ----------
def _align(lang: str) -> str:
    return "right" if lang == "he" else "left"


def h1(lang: str, text: str) -> str:
    return (
        f'                <h1 style="margin:0 0 16px;font-family:{FONT};font-size:24px;'
        f'line-height:1.3;font-weight:700;color:#0f172a;text-align:{_align(lang)};">'
        f"{text}</h1>\n"
    )


def p(lang: str, text: str) -> str:
    return (
        f'                <p style="margin:0 0 14px;font-size:15px;line-height:1.7;'
        f'color:#334155;text-align:{_align(lang)};">{text}</p>\n'
    )


def note(lang: str, text: str) -> str:
    return (
        f'                <p style="margin:16px 0 0;font-size:13px;line-height:1.6;'
        f'color:#64748b;text-align:{_align(lang)};">{text}</p>\n'
    )


def badge(text: str, bg: str, fg: str) -> str:
    return (
        f'                <p style="margin:0 0 16px;"><span style="display:inline-block;'
        f"padding:4px 12px;border-radius:999px;background:{bg};color:{fg};"
        f'font-size:12px;font-weight:700;">{text}</span></p>\n'
    )


def button(href: str, label: str) -> str:
    """Bulletproof (table-cell) CTA button in the brand color."""
    return (
        '                <table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'align="center" style="margin:26px auto;">\n'
        f'                  <tr><td align="center" bgcolor="{BRAND}" style="border-radius:8px;">'
        f'<a href="{href}" style="display:inline-block;padding:13px 32px;font-family:{FONT};'
        "font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;"
        f'">{label}</a></td></tr>\n'
        "                </table>\n"
    )


def link_fallback(lang: str, intro: str, href: str) -> str:
    """'Button doesn't work? Copy this link' — the raw URL, always LTR."""
    return (
        f'                <p style="margin:16px 0 0;font-size:12px;line-height:1.6;'
        f'color:#94a3b8;text-align:{_align(lang)};">{intro}<br />'
        f'<a href="{href}" dir="ltr" style="color:{BRAND};word-break:break-all;">{href}</a></p>\n'
    )


def details(lang: str, rows: list[tuple[str, str]]) -> str:
    """A light key/value box (e.g. the signup details)."""
    align = _align(lang)
    out = (
        '                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0" dir="{"rtl" if lang == "he" else "ltr"}" style="margin:6px 0 4px;'
        'border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;font-size:14px;">\n'
    )
    for i, (label, value) in enumerate(rows):
        border = "" if i == len(rows) - 1 else "border-bottom:1px solid #e2e8f0;"
        out += (
            f'                  <tr><td style="padding:10px 14px;{border}color:#64748b;'
            f'width:38%;text-align:{align};">{label}</td>'
            f'<td style="padding:10px 14px;{border}color:#0f172a;font-weight:500;'
            f'text-align:{align};">{value}</td></tr>\n'
        )
    return out + "                </table>\n"


def ltr(text: str) -> str:
    """Isolate an LTR value (email, URL, name) inside Hebrew text."""
    return f'<span dir="ltr" style="unicode-bidi:isolate;">{text}</span>'


SYSTEM_FOOTER = {"he": "נקודות יהודיות", "en": "Jewish Points"}
PENDING = ("#fef9c3", "#854d0e")  # status yellow, readable
APPROVED = ("#dcfce7", "#166534")  # status green, readable


# --- the five templates -----------------------------------------------------
def _shliach_welcome(lang: str) -> str:
    if lang == "he":
        content = (
            h1("he", "ברוכים הבאים לנקודות יהודיות")
            + p("he", "שלום {{first_name}} {{last_name}},")
            + p("he", "נפתח עבורך חשבון במערכת של <strong>{{org_name}}</strong>. "
                      "לחיצה על הכפתור תוביל אותך ישירות למערכת.")
            + button("{{url_to_system}}", "כניסה למערכת")
            + note("he", "להתחברות יש להשתמש בכתובת המייל "
                         f'<strong style="color:#0f172a;">{ltr("{{shliach_email}}")}</strong>')
        )
        return build("he", "ברוכים הבאים לנקודות יהודיות", content, "{{org_name}}")
    content = (
        h1("en", "Welcome to Jewish Points")
        + p("en", "Hello {{first_name}} {{last_name}},")
        + p("en", "An account has been opened for you in the <strong>{{org_name}}</strong> "
                  "system. Use the button below to go straight in.")
        + button("{{url_to_system}}", "Open the system")
        + note("en", 'Sign in with your email <strong style="color:#0f172a;">'
                     "{{shliach_email}}</strong>")
    )
    return build("en", "Welcome to Jewish Points", content, "{{org_name}}")


def _tenant_verification(lang: str) -> str:
    if lang == "he":
        content = (
            h1("he", "אישור הארגון החדש שלך")
            + p("he", "שלום {{first_name}} {{last_name}}, תודה על ההרשמה. "
                      "נא לעבור על הפרטים ולאשר את כתובת המייל כדי להפעיל את החשבון.")
            + details("he", [
                ("ארגון", "{{organization_name}}"),
                ("שם", "{{first_name}} {{last_name}}"),
                ("אימייל", ltr("{{email}}")),
                ("טלפון", ltr("{{phone}}")),
                ("שם משתמש", ltr("{{username}}")),
            ])
            + button("{{verify_url}}", "אישור המייל והפעלת החשבון")
            + note("he", "הקישור בתוקף ל-{{expire_hours}} שעות. "
                         "אם לא נרשמת, אפשר להתעלם מהודעה זו.")
            + link_fallback("he", "הכפתור לא עובד? אפשר להעתיק את הקישור:", "{{verify_url}}")
        )
        return build("he", "אישור החשבון", content, SYSTEM_FOOTER["he"])
    content = (
        h1("en", "Confirm your new organization")
        + p("en", "Hello {{first_name}} {{last_name}}, thanks for registering. Please review "
                  "the details below and confirm your email to activate the account.")
        + details("en", [
            ("Organization", "{{organization_name}}"),
            ("Name", "{{first_name}} {{last_name}}"),
            ("Email", "{{email}}"),
            ("Phone", "{{phone}}"),
            ("Username", "{{username}}"),
        ])
        + button("{{verify_url}}", "Confirm email &amp; activate")
        + note("en", "This link is valid for {{expire_hours}} hours. "
                     "If you didn't request this, you can ignore this email.")
        + link_fallback("en", "Button not working? Copy this link:", "{{verify_url}}")
    )
    return build("en", "Confirm your account", content, SYSTEM_FOOTER["en"])


def _password_reset(lang: str) -> str:
    if lang == "he":
        content = (
            h1("he", "איפוס סיסמה")
            + p("he", "שלום {{user_name}},")
            + p("he", "התקבלה בקשה לאיפוס הסיסמה שלך בארגון <strong>{{org_name}}</strong>.")
            + button("{{reset_url}}", "בחירת סיסמה חדשה")
            + note("he", "הקישור בתוקף {{expire_minutes}} דקות. "
                         "אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהודעה זו.")
            + link_fallback("he", "הכפתור לא עובד? אפשר להעתיק את הקישור:", "{{reset_url}}")
        )
        return build("he", "איפוס סיסמה", content, "{{org_name}}")
    content = (
        h1("en", "Password reset")
        + p("en", "Hello {{user_name}},")
        + p("en", "We received a request to reset your password for "
                  "<strong>{{org_name}}</strong>.")
        + button("{{reset_url}}", "Choose a new password")
        + note("en", "This link is valid for {{expire_minutes}} minutes. "
                     "If you didn't ask for this, you can ignore this email.")
        + link_fallback("en", "Button not working? Copy this link:", "{{reset_url}}")
    )
    return build("en", "Password reset", content, "{{org_name}}")


def _aignummail1(lang: str) -> str:
    if lang == "he":
        content = (
            badge("ממתין לאישור", *PENDING)
            + h1("he", "בקשתך התקבלה")
            + p("he", "שלום {{user_name}},")
            + p("he", "בקשתך לפתיחת הארגון <strong>{{org_name}}</strong> נשלחה והיא נבחנת כעת.")
            + p("he", "אנו נחזור אליך בהקדם האפשרי.")
        )
        return build("he", "בקשתך התקבלה", content, SYSTEM_FOOTER["he"])
    content = (
        badge("Pending approval", *PENDING)
        + h1("en", "Request received")
        + p("en", "Hello {{user_name}},")
        + p("en", "Your request to open the organization <strong>{{org_name}}</strong> "
                  "has been received and is under review.")
        + p("en", "We will get back to you as soon as possible.")
    )
    return build("en", "Request received", content, SYSTEM_FOOTER["en"])


def _aignummail2(lang: str) -> str:
    if lang == "he":
        content = (
            badge("אושר", *APPROVED)
            + h1("he", "הארגון אושר!")
            + p("he", "שלום {{user_name}},")
            + p("he", "הארגון <strong>{{org_name}}</strong> אושר וניתן להתחיל לעבוד במערכת.")
            + button("{{login_link}}", "כניסה למערכת")
            + link_fallback("he", "הכפתור לא עובד? אפשר להעתיק את הקישור:", "{{login_link}}")
        )
        return build("he", "הארגון אושר", content, SYSTEM_FOOTER["he"])
    content = (
        badge("Approved", *APPROVED)
        + h1("en", "Your organization is approved!")
        + p("en", "Hello {{user_name}},")
        + p("en", "The organization <strong>{{org_name}}</strong> has been approved — "
                  "you can now log in and get started.")
        + button("{{login_link}}", "Log in")
        + link_fallback("en", "Button not working? Copy this link:", "{{login_link}}")
    )
    return build("en", "Organization approved", content, SYSTEM_FOOTER["en"])


_BUILDERS = {
    "shliach_welcome": _shliach_welcome,
    "tenant_verification": _tenant_verification,
    "password_reset": _password_reset,
    "aignummail1": _aignummail1,
    "aignummail2": _aignummail2,
}

SUBJECTS = {
    "shliach_welcome": "ברוכים הבאים לנקודות יהודיות / Welcome to Jewish Points",
    "tenant_verification": "אימות חשבון / Confirm your account — נקודות יהודיות",
    "password_reset": "איפוס סיסמה / Password reset",
    "aignummail1": "בקשתך התקבלה / Request received — נקודות יהודיות",
    "aignummail2": "הארגון אושר / Organization approved — נקודות יהודיות",
}

DEFAULT_EMAIL_TEMPLATES: dict[str, dict[str, str]] = {
    key: {"subject": SUBJECTS[key], "body_hebrew": fn("he"), "body": fn("en")}
    for key, fn in _BUILDERS.items()
}


def notification_html(subject: str, content_html: str) -> str:
    """Branded shell for code-built (non-editable) mail, e.g. the superadmin's
    new-org-pending notice. Bilingual content, so the neutral LTR layout."""
    content = (
        f'                <h1 style="margin:0 0 20px;font-family:{FONT};font-size:22px;'
        f'line-height:1.35;font-weight:700;color:#0f172a;">{subject}</h1>\n'
        f"{content_html}\n"
    )
    return build("en", subject, content, f"{SYSTEM_FOOTER['he']} · {SYSTEM_FOOTER['en']}")


# --- upgrading rows that still hold an old shipped default ------------------
def fingerprint(text: str) -> str:
    """Whitespace/CRLF-insensitive hash of a template body."""
    norm = re.sub(r"\s+", " ", (text or "").replace("\r", "")).strip()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]


# Fingerprints of every body this repo ever shipped as a default (git history
# of hello_shliach.html / hello_tenant.html + the plain-text bodies, and the
# fixes90 in-DB title swap). seed_email_templates replaces a stored body with
# the new default only when it matches one of these — an edited body is kept.
LEGACY_BODY_FINGERPRINTS: dict[str, dict[str, set[str]]] = {
    "shliach_welcome": {
        "body": {"3ddd9cfa4e751536", "63df605e45f08919", "52d50aa2562fe5b4"},
        "body_hebrew": {fingerprint("")},
    },
    "tenant_verification": {
        "body": {"cba942ba8d41be72"},
        "body_hebrew": {fingerprint("")},
    },
    "password_reset": {
        "body": {"711cb7542d382b85"},
        "body_hebrew": {"4e966531762fe90b"},
    },
    "aignummail1": {
        "body": {"367d0a7b5a9877f2"},
        "body_hebrew": {"40444bfdf8bebf04"},
    },
    "aignummail2": {
        "body": {"5a616dfb854cd977"},
        "body_hebrew": {"a7ddede4db8603a2"},
    },
}
