# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Provenance note:** this project was forked from `sheepsidebay_crm` (a
> different, unrelated bilingual CRM) purely as a proven code skeleton —
> auth, multi-tenant org model, localization engine, generic custom-field
> engine, RTL-safe PDF export, and mobile-tested table UX all carry over.
> None of that project's domain (contacts/apartments/religious outreach)
> is relevant here and should be stripped. See `docs/elias_crm.pdf` (the
> source spec, Hebrew) and `docs/tag_print_crm_assessment.md` (the
> reuse/gap analysis this file is based on) for full background. This is a
> **separate deployment** (new Vercel/Render/Neon or Supabase instance) —
> it does not share a database with the project it was forked from.

## Project overview

A Hebrew production/order-management CRM for **Tag Print** (טאג פרינט), a
print & branding business (apparel, promotional/kad"am products). The
system runs the full value chain: lead/order intake (direct, Shopify, or
reseller), graphic design + WhatsApp-based client proof approval, the
production floor (two parallel tracks: standard apparel vs. sourced/branded
goods), delivery, bookkeeping, and affiliate/reseller commission tracking.

Like its parent project, it features native RTL layouts, a strict
separation between English storage schemas and Hebrew UI presentation (via
a metadata/localization table — do not hardcode Hebrew strings in
components), and a role-based access model with **field-level** permission
differences (not just page-level) since financial fields (cost, margin,
commission) must stay invisible to roles that shouldn't see them.

Tech stack: Next.js frontend (Tailwind CSS, RTL) and a Python FastAPI
backend using SQLAlchemy with PostgreSQL — kept from the parent project
deliberately (proven, deployed, Alembic migrations already wired) rather
than switching to the spec's suggested Supabase/Node.js stack. Postgres is
Postgres either way; Supabase-specific features (its own Storage buckets,
Row-Level Security) are optional infrastructure choices, not required.

Color scheme (status indicators, matching the spec's convention): **Green**
= completed/paid, **Orange** = in progress / partial / pending approval,
**Red** = urgent / unpaid / design problem. Apply consistently across order
status, payment status, and production task status everywhere in the UI —
this is the primary way a busy studio/production user reads state at a
glance, not a decoration.

Coding standards: Full UTF-8 support for Hebrew text strings, absolute
separation of data storage (strictly English schemas) and UI presentation
layers (Hebrew labels via metadata), secure authentication handling, no
over-engineering. Design mobile-first for the production-floor tablet
surfaces — real users there are standing at a machine, not at a desk.

## Running the app

The app runs locally via Docker or local dev servers. Create a `.env` file
at the root containing local configurations.

```sh
# Start entire local ecosystem
docker-compose up --build
```

Smoke checks after start: `http://localhost:3002/` (CRM Login/Dashboard),
`http://localhost:8002/docs` (Backend Swagger API).

> Note: host ports are `3002`/`8002` (not `3001`/`8001`) specifically so
> this project's local stack can run **alongside** sheepsidebay_crm's
> without a port clash during the transition period. Inside the containers
> the apps still listen on `3000`/`8000`.

## Python Backend Instructions

The backend is built with FastAPI and SQLAlchemy (PostgreSQL).

### Environment Configuration
Ensure your `backend/.env` file contains:
```env
DATABASE_URL=postgresql://user:password@host:5432/tagprint_local_dev
SECRET_KEY=your-super-secure-jwt-secret-key-change-it
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480
```
Plus, once built: `WHATSAPP_CLOUD_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`SHOPIFY_WEBHOOK_SECRET`, and file-storage credentials (S3 or Supabase
Storage — TBD which).

### Execution Commands
Navigate to the `backend/` directory to manage execution:
```sh
pipenv install                             # Install dependencies
pipenv run uvicorn app.main:app --reload   # Run local dev backend server
pytest                                     # Execute Python backend test suites
```

## Architecture

### Core data model

- **Clients** — `client_name`, `client_type` (B2B / B2C / Reseller /
  School), `company_id`, contact fields, `default_discount`,
  `terms_payment` (cash/credit / net-30 / net-60), `assigned_affiliate_id`.
- **Client_Price_History** — one row per (client, product_sku): last
  agreed price. Opening a new order for a returning client auto-pulls the
  last price for a matching SKU.
- **Orders** — the parent record of a production/sale project. `source`
  (Manual / Shopify / Reseller_Portal / Affiliate), `status` — see state
  machine below — `total_amount`, `payment_status`, `payment_due_date`,
  `delivery_method`.
- **Order_Items** — line items: `product_type` (T-Shirt / Hoodie / Mug /
  Sourced_Product), `blank_supplier_id`, `color`, `size_breakdown` (JSON,
  per-size quantities), `print_locations` (chest/back/sleeve),
  `unit_price`, `total_item_price`.
- **Design_Assets** — `raw_client_file_url`, `print_ready_file_url`,
  `mockup_url`, `print_width_cm`/`print_height_cm`, `designer_id`,
  `approval_status` (Pending / Approved / Revision_Requested),
  `client_approval_token` (unauthenticated public link — see below).
- **Production_Tasks** — a work queue: `task_type` (Design / Sourcing /
  Blank_Ordering / DTF_Printing / Heat_Pressing / Screen_Printing /
  Quality_Packaging), `assigned_to_user_id`, `machine_id`, `status`
  (Waiting / In_Progress / Done).
- **Affiliates_Resellers** — `entity_type` (Reseller_Subcontractor /
  Marketing_Affiliate), `custom_pricing_tier`,
  `commission_rate_percentage`, `total_sales`, `total_commission_earned`,
  `total_paid`.

### Order status state machine

`Lead → Quote → Graphics_Pending → Client_Proof → Approved →
In_Production → Quality_Check → Ready_For_Delivery → Delivered`, with
`Cancelled` reachable from any pre-`Delivered` state. Every status change
should be attributable (who/when) — this drives the KPI dashboard's
"overdue" and "in progress" tiles.

### Auth & Roles (field-level RBAC)

Five roles, each with real field-level (not just page-level) restrictions
— reuse the parent project's `roles` DB table shape (a real FK, not a
hardcoded enum) but replace its role set entirely:

1. **Owner/Manager** (מנכ"ל / מנהל ראשי) — full access, financial reports,
   settings, user management, no restrictions.
2. **Sales & Customer Service** (מכירות ושירות לקוחות) — leads, clients,
   orders, quotes, pricing, payment intake, WhatsApp. Sees client-facing
   price; **never** sees supplier cost or gross margin.
3. **Studio & Graphics** (סטודיו וגרפיקה) — the graphics task queue, file
   management, mockup/proof upload. Price/financial/payment-terms fields
   are **fully hidden**; file access only.
4. **Production & Press Operators** (מפעילי ייצור וכבישה) — the production
   floor screen (tablet), print queue, quantities/sizes/design files.
   Sees quantities, product types, colors, print files; financial fields
   and credit-card/payment details are **blocked**.
5. **Reseller / Subcontractor** (משווק / ספק משנה) — the external B2B
   portal. Restricted to **their own** orders and job-entry form only, and
   their own pre-agreed pricing tier — never sees any other client's data
   (this is the multi-tenant isolation boundary equivalent for this role;
   enforce it the same rigor as `organization_id` isolation, just scoped
   one level deeper to `affiliate_id`/`client_id` ownership).

### Graphics workflow & WhatsApp proof approval

1. Sales or the client (via the site/portal) uploads the source file
   (vector/logo/image).
2. The **studio work queue** (filtered to "awaiting print-ready") is where
   a designer downloads the source, produces exact-size print-ready files
   (cm-accurate), and uploads a print-ready file + a visual mockup.
3. On "send for client approval," the system generates a secure per-design
   **`client_approval_token`** link and sends it via **WhatsApp** (Meta
   Cloud API): *"Hi [client name], the design for order [order #] is ready
   to view and approve. Click here: [link]."*
4. The client opens the link on mobile (**no login** — token-authenticated
   public page, same technique as the parent project's email-verification
   links), sees the mockup + print dimensions/locations, and taps a green
   "Approve for production" button or "Request revision" (with a comment
   field).
5. On approval, order status flips to `Approved`, and the print-ready file
   is routed straight into the relevant production task queue — no manual
   re-entry by staff.

### Production floor pipeline

Two parallel tracks, each with its own per-stage checklist (apparel track
shown first, sourced-goods track second):

| Stage | Apparel track | Promo/kad"am track |
|---|---|---|
| 1: Raw materials | Consolidated purchase report by blank supplier (model/color/size); mark ordered → arrived | "Locate product" task with importers/suppliers; approve sample/price; order the blank |
| 2: Screens/prep & printing | DTF roll printing / screen prep per the print-ready file spec; operator marks "screens ready" | UV DTF / pad / sublimation / vinyl-cut prep per material |
| 3: Press & branding | Move garments + screens to the heat-press station; press; monitor heat/pressure | Brand at the appropriate branding station; durability check |
| 4: QC & packaging | Count by size, check print quality, fold, box, shipping label | Count, repack in protective packaging, barcode/order-label |
| 5: Delivery | Status → "ready for pickup" (auto-WhatsApp) or assigned to a delivery run + delivery note | same |

Build this as a tablet-first task-queue UI for production/press operators
(role 4 above) — same mobile-first discipline as the parent project's
shliach-facing pages, but for a standing machine operator, not a phone in
someone's pocket.

### Reseller & affiliate portal

Two distinct external-user flows behind one portal gate:

- **(a) White-label B2B reseller portal** — sees their own pre-agreed
  price list; a self-serve job-entry form (pick items, upload files,
  choose their *own* end customer's delivery address); submitted jobs
  enter the production queue directly, no office re-entry; a debt/
  statement view (outstanding balance, delivery notes, net-30/60 terms).
- **(b) Affiliate marketing module** — each affiliate gets a unique
  tracking link (Shopify/landing page); the system attributes closed
  Shopify orders to the referring link, computes their commission
  percentage, and shows them: gross sales, commission accrued, balance
  due. Owner gets a consolidated per-affiliate profitability report and
  approves payout with one click.

### Integrations & automation

| Channel | Trigger | Action |
|---|---|---|
| Shopify Store | Webhook: `orders/create` | Create/match client, open an order in the CRM, split into production tasks, route uploaded files straight to the graphics queue |
| WhatsApp — proof approval | Designer uploads a mockup | Send an interactive WhatsApp template with the mockup image + a direct link to sign/approve |
| WhatsApp — "order ready" | Status → `Ready_For_Delivery` | Auto-send pickup hours/address (or a tracking number) |
| Missed calls | Unanswered call on the business line (PBX/bot) | Auto-WhatsApp: *"Hi! We saw you tried to reach Tag Print and missed you — how can we help?"* + open a new lead in the CRM |
| Client self-tracking | Unique link on the order record | Public page (same token-link pattern) showing live order stage: design / printing / pressing / ready |

Decide early whether the Shopify/WhatsApp orchestration lives in the
FastAPI backend directly (more control, more build time) or is fronted by
Make/n8n calling a small set of new REST endpoints (faster to stand up,
one more moving part in prod, external dependency on uptime).

### UI/UX conventions (carried over + spec-specific)

- **Sticky elements:** header row + the order-number/client-name column
  stay pinned during horizontal *and* vertical scroll, everywhere.
- **Natural sort:** numeric-aware sort (`1, 2, 3…10, 11`), not lexical
  (`1, 10, 11, 2…`) — the parent project already solved this, reuse it.
- **Smart filter + bulk actions:** filter any column by "has value / empty
  value"; bulk-edit select fields and append text across a filtered
  selection — same pattern as the parent project's apartment/contacts bulk
  edit.
- **Status color coding** — see the top of this file; apply uniformly.
- **PDF export** — clean layout, well-defined separator lines, no text
  collision in column headers, suitable for quotes/production sheets sent
  externally. Reuse `frontend/lib/pdfRtl.ts` verbatim (RTL bidi-engine
  patch for jsPDF) rather than re-deriving it.
- **Owner's KPI dashboard** — real-time: open orders, monthly revenue,
  overdue tasks, net-30/60 payment-terms-elapsed alerts, a digest of
  production-staff comments/feedback. Reuse the parent project's dashboard
  pattern (`AdminDashboardHome`-equivalent: KPI tiles + charts +
  time-range toggle) — new KPIs, same shape.

### Localization & custom fields (carried over verbatim)

Keep the parent project's two biggest accelerators exactly as they work
today:

- **Localization engine:** English storage schema everywhere; Hebrew UI
  strings live in a metadata/localization table, fetched at boot and
  applied via a `t()` helper. Never hardcode Hebrew text in a component —
  every new Hebrew string needs a corresponding localization row (this bit
  the parent project repeatedly; don't repeat it here).
- **Generic custom-field engine:** any `entity_type` × any field type
  (text/select/date/etc.), select fields backed by the picklist system.
  Use this for the long tail of bespoke fields on `Order_Items`,
  `Design_Assets`, and `Production_Tasks` (e.g. specific print machine,
  material batch, finish type) instead of adding narrow one-off columns
  and migrations for each.
