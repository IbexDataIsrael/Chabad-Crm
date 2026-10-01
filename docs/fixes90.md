# fixes90 — per-organization email templates (Hebrew / English), org logo, system theme

Requested 2026-10-01 (spec; questions below, nothing implemented yet).

## Request (as given)

- Emails are sent in Hebrew when the system language is Hebrew.
- Use the organization's logo instead of the default logo.
- Instead of taking the email HTML from the superadmin's global templates,
  keep Hebrew and English email templates **in each organization**.
- When a new organization is created, seed its templates from the templates
  defined in the superadmin system.
- Templates are editable in a WYSIWYG editor.
- Create a base RTL email template for Hebrew.
- Restyle the email templates to the system's look.

## How it works today

- `email_templates` is one global table (superadmin page "תבניות מייל"); each
  template has one subject and a Hebrew + an English body, and the sent mail
  contains **both** languages one after the other.
- The shell `backend/HTML/notification.html` uses the old magenta (#d6249f)
  and always the system logo (`/logo.png`).
- Senders: activist/user welcome, password reset, signup verification, signup
  received / org approved, new-org notice to the superadmin, new-activist
  notice to org admins, scheduler reminders, error reports.
- Language: each **user** has a saved language preference (`locale` in user
  preferences). There is **no organization-level language**, and many emails
  go to people with no account yet (new activist welcome, new-org signup).

## Open questions

1. Where does "the system language" for an email come from?
2. Which emails become per-organization, and which stay platform-level?
3. Existing organizations: copy the superadmin templates into them now?
4. Later superadmin edits: reach existing organizations or not?

## Done meanwhile — welcome email title

Requested: change the title to "Welcome to Jewish Points" / "ברוכים הבאים לנקודות יהודיות".

- [x] `shliach_welcome` subject → "ברוכים הבאים לנקודות יהודיות / Welcome to
      Jewish Points" (both languages while the mail is still bilingual; split
      per language once the per-org Hebrew/English templates land).
- [x] The heading inside the mail (`hello_shliach.html` + `<title>`): the Hebrew
      line (RTL) above "Welcome to Jewish Points".
- [x] Stored templates are upgraded by `seed_email_templates` on startup **only
      while they still hold the old default** (subject "Welcome to the system",
      old `<h1>`); an edited subject/body is untouched
      (`LEGACY_EMAIL_BODY_SNIPPETS`). Prod's row is unedited since 2026-07-11,
      so it upgrades on deploy. Local DB upgraded and rendered. Test
      `test_seed_upgrades_welcome_title_but_keeps_edited_one`; 20 passed.

Not committed or pushed.
