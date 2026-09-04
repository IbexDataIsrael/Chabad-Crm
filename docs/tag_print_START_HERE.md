# Start here — Tag Print CRM (new project, copied from sheepsidebay_crm)

If you're Claude Code reading this in a freshly-copied project: this repo
was **copied wholesale from `sheepsidebay_crm`** (a bilingual Chabad/shliach
outreach CRM) to serve as a **starting skeleton** for a different product —
a production/order-management CRM for a print & branding business
("Tag Print"). Read this file first before touching anything.

## The decision that got us here

The user has a spec (`docs/elias_crm.pdf`, Hebrew) for a Tag Print
production CRM and asked whether to build it inside the existing
sheepsidebay_crm codebase or start fresh. Full reasoning is in
`docs/tag_print_crm_assessment.md` — short version:

- **Don't share the live app/database** with sheepsidebay_crm. The domains
  are unrelated (contacts/apartments/religious-outreach vs.
  clients/orders/production-floor), this repo's history includes real
  "wipe & reseed the DB" moments, and mixing two unrelated businesses'
  blast radius in one Postgres instance / one Vercel+Render deployment is a
  real operational risk, not just a style preference.
- **Do reuse the code as a starting skeleton** — copying this repo was the
  right call. A meaningful chunk of what the new spec needs is already
  built and battle-tested here: auth/JWT/multi-tenant org model, a DB-backed
  `roles` table, a generic per-entity custom-field engine (any
  `entity_type` × any field type — big accelerator for Order_Items/
  Design_Assets' bespoke fields), the Hebrew localization engine
  (English storage schema / Hebrew UI via metadata, per CLAUDE.md), a
  hard-won RTL-safe jsPDF export (`frontend/lib/pdfRtl.ts` — do not
  re-derive this, it took real debugging), hand-built sticky-header/
  natural-sort/bulk-edit table UX, a token-based public-link pattern
  (reusable for the spec's unauthenticated client design-approval page),
  and the Docker-compose/Vercel/Render/Neon deployment pattern.

Read `docs/tag_print_crm_assessment.md` for the full reuse table and the
complete gap list (organized by the spec's own section numbers), plus a
suggested build order at the bottom.

## What this repo still is, right now

Everything from sheepsidebay_crm is still here unmodified: `contacts`,
`interactions`, `apartments`, `buildings`, `areas`, `visits`, `donations`
and all their routers/pages, the entire shliach domain, and `CLAUDE.md`
describing the *wrong* product. **First real task**: strip the
shliach-domain models/routers/pages per the phasing in the assessment doc,
and rewrite `CLAUDE.md` to describe Tag Print instead — don't leave it
describing the old product, it'll actively mislead every future session.

## Housekeeping

- New deployment needed (new Vercel project, new Render service, new Neon
  DB) — do not point this at sheepsidebay_crm's existing prod infra.
- `docs/elias_crm.pdf` and `docs/tag_print_crm_assessment.md` came along in
  the copy — keep them, they're the source spec and the planning doc.
- `docs/tag_print_CLAUDE_draft.md` is a drafted replacement `CLAUDE.md` for
  this product (written before the copy, based on the PDF spec + the
  assessment doc). Review it, then move/rename it to the repo root as
  `CLAUDE.md`, overwriting the old sheepsidebay_crm one.
- This file and the assessment doc are safe to delete once their content
  has been absorbed into a proper new CLAUDE.md / fixes-style spec docs for
  the new product (per this project's own `docs/fixesN.md` convention,
  documented in the original project's memory as "write specs to MD, not
  chat").
