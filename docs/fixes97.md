# fixes97 — branded email templates (Hebrew RTL + English LTR)

## Request (2026-10-11)

> superadmin holds the email templates. please make an html template with the
> look and feel of the project in english and a rtl one in hebrew. update ALL
> the email templates that are on display in superadmin. use my logo for general
> email and make sure to use organizations logo for activist emails.

## Design

- Two layouts: `backend/HTML/email_layout_en.html` (LTR) and
  `backend/HTML/email_layout_he.html` (RTL, `dir="rtl"`, right-aligned). Project
  look: brand blue `#1695c0` (globals.css `--primary`), page bg `#f5f6f9`, white
  12px-radius card with a blue top bar, Heebo font, slate text, bulletproof
  table-cell buttons, "Built by" footer with the platform logo.
- `backend/app/core/email_templates.py` fills the layouts (`[[title]]`,
  `[[content]]`, `[[card_footer]]`) per template → each superadmin template row
  holds a full Hebrew document (`body_hebrew`) and a full English one (`body`),
  editable in the existing WYSIWYG/HTML editor.
- Sending: when both bodies are full documents, their `<body>` contents are
  stacked into one email — Hebrew card first, English card below (same
  "Hebrew followed by English" contract as before). Substituted values are now
  HTML-escaped inside HTML templates.
- Logos: `{{logo_url}}` (header) = **organization logo** for activist mail
  (`shliach_welcome`, `password_reset`), falling back to the platform logo when
  the org has none; platform logo (`/logo.png`, IBEX) for general mail
  (`tenant_verification`, `aignummail1`, `aignummail2`). `{{system_logo_url}}`
  (footer) is always the platform logo.
- Old DB rows: `seed_email_templates` replaces a body only when it still matches
  a fingerprint of a previously shipped default (whitespace/CRLF-insensitive);
  edited bodies are left alone. Old "מיני CRM" subjects → "נקודות יהודיות".

## Checklist

- [x] English LTR layout + Hebrew RTL layout — `backend/HTML/email_layout_{en,he}.html`
- [x] All 5 superadmin templates rebuilt on them: shliach_welcome,
      tenant_verification, password_reset, aignummail1, aignummail2
- [x] Platform logo for general mail; org logo for activist mail (4
      `send_shliach_welcome` call sites + password reset pass the org's `logo_url`)
- [x] Code-built new-org-pending notice (not a template) restyled to the same
      look; `notification.html`, `hello_shliach.html`, `hello_tenant.html` removed
- [x] Superadmin page: labels + placeholder hints for all 5 templates;
      `admin.template.*` LOCALIZATION rows
- [x] Tests: `backend/tests/test_email_layouts.py`; full suite 663 passed
- [x] Local DB: all 5 rows upgraded on backend restart (verified by query)
- [x] Visual check: rendered real sent HTML (welcome w/ org logo, tenant
      verification) in Chromium, desktop + 390px mobile
- [ ] Not done: prod (Neon) rows upgrade on the next deploy's startup seed — only
      rows still holding an old default; any template the superadmin edited on
      prod keeps the edit and must be re-pasted manually.
- [x] Committed c3a2ab3 (not pushed).
