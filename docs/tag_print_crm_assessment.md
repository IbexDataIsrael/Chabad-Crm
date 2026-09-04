# Tag Print production CRM — build here, or start fresh?

Assessment of `docs/elias_crm.pdf` ("ניהול ייצור ופורטל CRM — טאג פרינט") against
this codebase (a bilingual Chabad/shliach outreach CRM), written 2026-09-03.

## Recommendation

**Start a fresh repository — do not build this as another "organization" inside
this codebase.** The two products share almost nothing at the *domain* level
(contacts/apartments/religious-outreach vs. clients/orders/production-floor),
and this repo's schema, seed data, CLAUDE.md, and picklist keys are all
specifically shaped around the shliach/Chabad domain. Bolting an unrelated
print-shop business onto the same database and deployable would couple two
products' migration histories, release cycles, and on-call risk together for
no real benefit — multi-tenancy here isolates *data* per org, not *domain
model* per org; every org still shares one `contacts`/`apartments`/`visits`
schema.

That said, **don't re-derive the infrastructure layer from scratch either.**
A meaningful chunk of what this spec needs already exists here, proven across
~50 rounds of real bug fixes (RTL bidi edge cases, mobile-first constraints,
Hebrew localization, PDF export). Fork this repo as a starting *skeleton*,
strip the shliach-specific domain code, and keep the pieces below.

## What to reuse (port into the new project)

| Piece | Source in this repo | Why it's worth keeping |
|---|---|---|
| Backend skeleton: FastAPI + SQLAlchemy + Alembic + Postgres, JWT auth, bcrypt | `backend/app/main.py`, `backend/app/core/security.py`, `backend/app/database.py` | Working, deployed (Render/Neon), no rebuild needed |
| Multi-tenant `organization_id` isolation pattern | `backend/app/models.py` (every table), `backend/app/deps.py` | The spec's roles are all still single-tenant (one company); this pattern still applies for isolating dev/staging/prod or future multi-branch use |
| DB-backed `roles` table (FK, not a hardcoded enum) | `backend/app/models.py:47` (`Role`) | Spec needs 5 roles (מנכ"ל, מכירות, סטודיו, ייצור, משווק) vs. this app's 3 — the *table* is already right shape, just needs new rows + the permission checks rewired (see gaps) |
| Generic per-entity custom fields (any `entity_type` × any field type, picklist-backed) | `backend/app/models.py:896` (`CustomFieldDefinition`), `backend/app/custom_field_utils.py` | Huge accelerator: `Order_Items`, `Design_Assets`, `Production_Tasks` all have bespoke per-business-type fields (print locations, machine type, etc.) — this engine means most of those don't need new migrations, just new field definitions |
| Localization engine: English storage schema, Hebrew UI via metadata table, `t()` fallback | `backend/app/seed.py` (`LOCALIZATION`), `frontend/lib/localization.tsx` | Spec's UI is 100% Hebrew; this is the exact "strict English schema / Hebrew presentation" split CLAUDE.md already mandates here |
| RTL Hebrew PDF export (jsPDF bidi-engine patch) | `frontend/lib/pdfRtl.ts` | Spec explicitly wants clean PDF quote/report export with no text collision — this file is a hard-won fix (logical-mode bidi patch), do not re-derive it |
| Hand-built sticky headers, natural sort, multi-select bulk edit, mobile-safe grids | `frontend/app/dashboard/apartments/page.tsx`, `frontend/components/ui/MultiSelectSearchFilter.tsx` | Spec explicitly asks for sticky columns/headers, natural number sort, bulk edit, smart filters — all already solved here (in hand-rolled tables, not TanStack, but functionally equivalent and mobile-tested) |
| Status color-coding convention (green/orange/red = done/in-progress/blocked) | CLAUDE.md color scheme + `status.*` Tailwind tokens | Near-verbatim match to spec §8's "ירוק/כתום/אדום" status convention |
| Token-based public/unauthenticated link pattern | `backend/app/routers/auth.py` (`verify-email`) | Spec needs an unauthenticated client-facing design-approval link (`client_approval_token`) — same technique (signed/random token, public GET/POST endpoint, no login), new use case |
| Self-service external-role portal pattern (limited nav, own-record-only view) | `frontend/app/dashboard/activist/page.tsx`, shliach role guards throughout `DashboardChrome` | Directly analogous to the spec's reseller/affiliate portal (own-orders-only, custom pricing view) |
| Docker-compose local dev + Vercel/Render/Neon prod pipeline, `.env` conventions | `docker-compose.yml`, `docs/deployment.md` | Reuse the pattern/config shape, point at new services |
| Mobile-first design discipline (44px touch targets, phone-first testing) | Established convention across this codebase | Spec explicitly wants a production-floor tablet UI — same discipline applies |

## What's genuinely new (the real gap)

Organized by the spec's own section numbers.

### §1–2 — Data model
- [ ] Entirely new schema: `Clients`, `Client_Price_History`, `Orders`,
      `Order_Items`, `Design_Assets`, `Production_Tasks`,
      `Affiliates_Resellers` — none of this exists; the custom-field engine
      (see reuse table) covers *some* of each table's long tail of fields,
      but the core tables and their relations are net-new.
- [ ] Order status state machine (`Lead → Quote → Graphics_Pending →
      Client_Proof → Approved → In_Production → Quality_Check →
      Ready_For_Delivery → Delivered / Cancelled`) — no equivalent state
      machine exists today (closest analog is apartment/report versioning,
      not a multi-step approval pipeline).

### §3 — Graphics workflow & proof approval
- [ ] Cloud file storage for design assets (AI/PSD/PDF/TIFF/PNG, print-ready
      files at 300 DPI) — today the app only integrates Cloudinary, and only
      for small org-logo images. Needs S3 or Supabase Storage, upload
      signing, and a designer-facing "queue filtered by pending" workspace.
- [ ] Print-size positioning UI (mockup generation / dimension entry in cm).
- [ ] Unauthenticated client-facing approval page (view mockup, approve /
      request revision with comments) — new page type, though the
      token-link *mechanism* is reusable (see reuse table).

### §4 — Production floor pipeline
- [ ] Two parallel production tracks (apparel vs. sourced/branded goods) with
      per-stage checklists (raw materials → screens/DTF prep → heat press →
      QC/packaging → delivery) — net-new; a tablet-oriented "current task
      queue" UI for machine operators doesn't exist today (closest analog:
      the apartment bulk-edit modal, not a task-queue UI).
- [ ] Machine/resource tracking (`machine_id` on tasks).

### §5 — Reseller & affiliate portal
- [ ] White-label B2B reseller portal: per-reseller custom pricing, self-serve
      order entry with file upload, credit-terms/payment-due dashboard.
- [ ] Affiliate marketing module: unique tracking links, conversion
      attribution, commission calculation + payout approval dashboard for
      the owner. No commission-math engine exists anywhere in this codebase
      today.

### §6 — Integrations & automation
- [ ] **Shopify** webhook (`orders/create`) → auto-create client + order +
      route uploaded files to the graphics queue. No e-commerce integration
      exists today.
- [ ] **WhatsApp Business Cloud API**: interactive proof-approval messages,
      "order ready for pickup" auto-notification, missed-call → auto-WhatsApp
      + auto-lead-creation bot. Today's only outbound channel is SMTP email
      (see `backend/app/core/email` equivalent) — WhatsApp integration is
      100% new, and is the single largest genuinely new subsystem in this
      spec.
- [ ] An automation/orchestration layer (spec suggests Make/n8n or a
      Node/Express webhook service) — decide whether to hand-roll this in
      the FastAPI backend (more control, more build time) or bolt on an
      external no-code layer (Make/n8n) calling back into a small set of new
      REST endpoints (faster, less maintenance, another moving part in
      prod).
- [ ] Client self-service order-tracking page (real-time stage view) — same
      shape as the WhatsApp-approval page, new build.

### §7 — RBAC
- [ ] 5 granular roles (מנכ"ל/מנהל ראשי, מכירות ושירות לקוחות, סטודיו
      וגרפיקה, מפעילי ייצור וכבישה, משווק/ספק משנה) with true **field-level**
      permission differences (e.g. sales sees client price but not supplier
      cost; production sees quantities/colors but not financial fields).
      Today's RBAC is coarser — `admin` / `staff` / `shliach` (+
      `superadmin`), enforced mostly via scattered `isAdmin`/`isShliach`
      checks in routers and components, not a data-driven field-permission
      matrix. The `roles` table and the existing per-field visibility
      toggles (`fields` management page) are a starting point, but the
      matrix itself needs real new engineering — this is more than adding
      rows to the `roles` table.

### §8 — UI/UX
- [x] Sticky headers/columns, natural sort, bulk edit, colored status badges,
      clean RTL PDF export — **already solved**, see reuse table.
- [ ] Central KPI dashboard (open orders, monthly revenue, overdue tasks,
      payment-terms-elapsed alerts, production-staff feedback digest) — this
      codebase just shipped an analogous admin dashboard
      (`frontend/components/AdminDashboardHome.tsx`, commit `e20106f`) with
      real KPI tiles and charts; **the pattern is reusable, the KPIs
      themselves are new** (orders/revenue/production, not
      contacts/apartments).

## Suggested phasing (if you proceed)

1. Fork this repo as the new project's skeleton; strip `contacts`,
   `interactions`, `apartments`, `buildings`, `areas`, `visits`, `donations`,
   and their routers/pages. Keep auth, org model, roles table, localization
   engine, custom-field engine, PDF RTL lib, and the reusable UI primitives
   (`components/ui/*`, `MultiSelectSearchFilter`, sticky-table patterns).
2. Build the core data model (§2) + basic order CRUD + RBAC field matrix
   (§7) first — everything else hangs off "an order exists and the right
   role can see the right fields on it."
3. Graphics workflow + client approval link (§3) — the first genuinely
   external-facing surface, and the thing that unblocks production.
4. Production floor pipeline (§4) — needs real device testing (tablet), same
   mobile-first discipline as this codebase's shliach-facing pages.
5. WhatsApp + Shopify integrations (§6) — biggest net-new technical risk
   (external API credentials, webhook reliability, message-template
   approval with Meta); budget the most schedule slack here.
6. Reseller/affiliate portal + commission engine (§5) — lowest urgency,
   cleanly separable, build last.
