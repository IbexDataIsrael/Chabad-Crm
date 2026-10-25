Don't push. Stop for my review.

Inspection and design only: no code changes, commits, service calls, Docker changes or deployment. Preserve all existing work.

Goal: connect the helper popup to AI-assisted CRM actions and data questions, always using the logged-in user's organization and permissions. The CRM owns validation, business rules, execution and saved-record verification.

1. Inspect the local popup, its mock adapter and current Git status.
2. Trace existing contact creation and draft creation: required fields, validation, permissions, organization scoping and read-back. Identify reusable code.
3. If needed, read C:\projects\crm-assitant\app\main.py without changing it. Report the current /chat contract and what is missing for understanding actions and collecting required details. Don't assume the keyword router already does this.
4. Propose the smallest end-to-end contact-draft flow. Bind confirmation to the exact fields, user and organization. Use server-enforced idempotency so retries after an uncertain save cannot create duplicates; search-before-create is not sufficient.
5. Inspect apartment Jewish-status support separately. Don't confuse active/draft record status with Jewish status. Identify missing capability and effects on "don't knock". Don't implement it yet.
6. Include CRM data questions: counts, lists and summaries. Inspect the existing /api/ai/query flow and reuse its validated intent/query approach where suitable. No arbitrary AI-generated SQL.
7. Enforce user, organization and permissions in the backend for every read and action. Don't use the shared-key endpoint's default organization for real users. Cover proposals, cached results and private document retrieval too.
8. Plan negative tests proving org A cannot read or change org B's data, including retries and cached proposals.
9. Identify the test organization/database needed before any real save. Separate what can be built and mocked locally from what still needs a decision.

Return a short report: existing pieces, missing pieces, and the first implementation step. No implementation, no commit, no push.

---

## Inspection report (2026-10-25) — design only, nothing implemented

Git: `main` @ 82e5611. Only `frontend/tsconfig.tsbuildinfo` is modified, and this file is untracked. No code, Docker or service changes were made. crm-assitant was read only.

### Existing pieces

| Piece | Where | Reusable? |
|---|---|---|
| Popup UI + single adapter | `frontend/components/ai-helper/{AiHelperWidget,AiHelperPanel,chatAdapter}` | Yes. In prod it returns `not_connected`; dev serves mocks. Statuses: answer / insufficient_sources / clarify / not_connected. **No confirm, saved or proposal state yet.** Wiring it means adding `apiFetch` (JWT) inside `sendChatMessage`. |
| Regular contact create | `routers/contacts.py:1200` `create_contact` | Use it as the validation reference: the JWT user's org, `forbid_campaign_manager`, shliach may create mekurav only with forced ownership, `_validate_fks/_validate_picklists`, `_check_phone_unique` (per org), `_geocode_fallback`. It creates **active** contacts, not drafts. |
| Draft contact create | `routers/instinct/contacts.py` `POST /api/instinct/contacts` | Closest match: status='draft', source, ContactMekurav row, `clean_phone` (Israeli mobile), `clean_email`. **But** it uses a shared key (`X-Instinct-Key`) and `org_id()` = env `INSTINCT_ORG_ID`, **default 1** (org 1 holds the real imported data). It has no user, no `assigned_user_id`, no idempotency and no role check. Real users must not go through it. |
| Draft approval | `POST /api/contacts/{id}/approve` (staff/admin) | Yes, as is. Drafts are hidden from contact lists (`_contacts_query` `record_status="active"`). |
| Duplicate lookup | `GET /api/instinct/contacts/search` (drafts included) | The logic can be reused as a *warning*. It is not deduplication. |
| Server idempotency precedent | `door-outcome` + `visit_history.client_uuid` | Pattern only. Its unique index is **global** while the lookup is per org. The new key must be unique per (org, user). |
| NL data questions | `routers/ai_query.py` + `crm_manifest.run_query` | Yes. The LLM returns constrained JSON; tables, columns and operators are allowlisted. Each `base_query` reuses the REST endpoint's org + shliach scoping. Also has a role check and the org toggle `ai_query_enabled`. No SQL. Gaps are listed below. |
| External brain `/chat` | `crm-assitant/app/main.py` (read only) | Request is `{message}` only. Response is `{reply, route, route_source, passages, generation}`. **There is no top-level `status`**, though the popup expects one; it is only nested as `generation.status`. Routing is the `planner.py` keyword stub: a leading find/add/update verb, not ending in `?`. Actions are DEMO placeholders in `crm.py` and extract no fields. No auth, no user or org, no conversation state. Knowledge is one shared pgvector collection with 2 docs and no org dimension. |

### Missing pieces

1. **An authenticated assistant endpoint in the CRM backend** (JWT, with the user's own org and role). The popup never calls crm-assitant directly or with a shared key.
2. **Intent extraction for actions**: the LLM returns constrained JSON `{action, fields}` (same pattern as `crm_manifest`). The server never trusts it and validates everything again. The keyword stub cannot extract fields or spot missing ones.
3. **A clarify loop**: return the missing or invalid required fields as `clarify`. Keep conversation state on the server, keyed by conversation id and scoped to org + user.
4. **Proposal, confirmation and idempotency**: a table and endpoints (see below).
5. **A shared draft-create service** that both Instinct and the assistant call. Today the logic is inline in the Instinct route.
6. **New popup states**: `confirm` (the fields plus Confirm/Cancel), `saved` (shown only from read-back), `failed`/`uncertain` (retry the same proposal).
7. **ai_query gaps for counts and summaries**: there is no aggregation. `row_count` is capped at `ROW_CAP=200`, so any "how many" answer above 200 is wrong; it only sets `truncated`. Add a validated `count` / `group_count` (on an allowlisted column) on top of the same `base_query`. For summaries, the LLM writes prose only from the returned rows and states row_count/truncated.
8. **Per-org knowledge retrieval**: crm-assitant chunks have no `organization_id`. That is fine while every doc is a public product guide. Any private org document needs an org column, filtered on the server using the org the CRM sends.

### Smallest end-to-end contact-draft flow

1. `POST /api/assistant/chat {message, conversation_id?}`: JWT, role dependency, `forbid_campaign_manager`, org toggle. Knowledge questions go to crm-assitant (server to server), data questions to `crm_manifest`, actions to intent extraction.
2. For `create_contact_draft`:
   - Normalize with `clean_phone`/`clean_email` and require first and last name.
   - Apply the same role rules as `create_contact` and run `_check_phone_unique(org)`.
   - Run the draft-inclusive search and return any `possible_duplicates` as a warning only.
   - If fields are missing or invalid, return `{status:"clarify", missing_fields}`.
   - If the fields are complete, insert an `assistant_proposals` row: id (uuid), organization_id, user_id, action, payload (canonical normalized JSON), `payload_hash` = sha256(action + payload + org + user), status=pending, expires_at (~15 min), result_entity_id. Return `{status:"confirm", proposal_id, payload_hash, fields}`.
3. `POST /api/assistant/proposals/{id}/confirm {payload_hash}`:
   - Look the proposal up by `id AND organization_id = user.org AND user_id = user.id`. If no row matches → **404**, so its existence never leaks.
   - Hash mismatch → 409. Expired or cancelled → 410. Changing any field means creating a new proposal.
   - If it is already `executed`, return the stored result plus a fresh read-back (`replayed: true`). This makes a retry after an uncertain save safe.
   - Otherwise do everything in **one transaction**:
     - Claim the proposal: `UPDATE … SET status='executing' WHERE id=? AND status='pending'`, and rowcount must be 1.
     - Validate again, since the phone may have been taken in the meantime.
     - Create the draft through the shared service with `assigned_user_id=user.guid` and `source='assistant'`.
     - Set `contacts.assistant_proposal_id`, which is **UNIQUE**: a DB-enforced backstop against a double insert.
     - Mark the proposal executed and commit. Any failure rolls everything back.
4. Read-back: query the contact again by id, scoped to the org. The popup shows "saved as draft" only from this read-back, and flags any field that differs from what was confirmed.

### Apartment Jewish status (separate, not implemented)

- **Record status** is `apartments.status` / `contacts.status` (active/draft). **Jewish status** is the `apartment.Jewish_status` picklist stored through `PicklistLink`. The two are unrelated.
- Write paths today:
  - `PUT /api/apartments/{id}`: versioned, calls `_sync_to_knock`.
  - `door-outcome`: only jewish/not_jewish, scoped to the shliach, idempotent.
  - Instinct `PATCH /apartments` **cannot** set Jewish status.
- "Don't knock" is the `to_knock` custom field. `_sync_to_knock` sets it to false for `{not_jewish, gentile, na, dont_knock}` and to true when the status is unset or any other value.
- To decide before the assistant can set it:
  - The seeded values are `na` ("/", the **default/blank** option), jewish, jewish_interested, jewish_gentile, jewish_interested_gentile, jewish_shtumtz and not_jewish. `gentile` and `dont_knock` are not seeded. That makes "unknown" ambiguous: **unset means knock, but `na` means don't knock.** The assistant must never map "unknown" to `na`.
  - `jewish_gentile` (a mixed household) means knock. Is that intended?
  - Apartments are versioned, so the id changes on every edit. A proposal must bind to `root_id` plus the expected current version id. If the version has moved since the proposal, the user confirms again.
  - Identifying an apartment from text (building + number) can be ambiguous. Ask for clarification and offer candidates, taken only from the shliach-scoped query.
  - In an org with no `to_knock` definition, `_sync_to_knock` silently does nothing.

### Enforcement (every read and action)

- Identity comes only from the JWT; the org is always `current_user.organization_id`. Never `INSTINCT_ORG_ID`, and never an org or user id taken from the LLM or the request body.
- Reads go only through the `crm_manifest` base queries or existing scoped helpers (`_get_contact_or_404`, `_shliach_apartment_ids`).
- Every proposal lookup filters by org + user. A cross-org lookup returns 404.
- None exist today, but any future cache key must include org + user + role. Conversation state uses the same scope.
- Knowledge: once private docs exist, the server applies the org filter. The CRM passes the org to crm-assitant over an authenticated server-to-server channel.
- The LLM system prompt is built only from the caller's org metadata, as `build_system_prompt` already does.

### Negative tests (pytest, orgs A and B, all roles)

1. Confirming user A's proposal as user B (same org), or as an org-B admin → 404, nothing created.
2. A tampered `payload_hash` or changed body → 409, no contact.
3. Double or concurrent confirm, or a commit whose response was lost → exactly one contact; the second call returns `replayed: true` with the same id.
4. An expired or cancelled proposal → refused.
5. Data questions from org A never return org B rows, in lists, `count` or `group_count`.
6. A shliach's draft is forced to a mekurav they own. A shliach sees only their own apartments. campaign_manager → 403.
7. An injected intent that names organization B, or an unknown table or column → ignored or 422.
8. Org A's conversation or clarify state cannot be resumed from an org-B session.
9. A phone used in org B is still allowed in org A. A phone used in org A is refused at proposal time and checked again at confirm.
10. Instinct endpoints behave as before (regression).

The unique-constraint and concurrency tests must also run against local Postgres, because SQLite does not enforce them the same way.

### Test org / database before any real save

- Only on local Postgres (`docker-compose.local-db.yml`), in a **new dedicated org** (e.g. "Assistant QA") with its own admin, staff and shliach users and seeded picklists, including `to_knock`. **Not org 1**: it holds real imported data and is the Instinct default.
- No assistant writes in prod (VPS) until that is decided.

### Build locally now vs. needs a decision

- **Can build now:**
  - The proposals table and migration.
  - The shared draft service.
  - The assistant router with a **stub** intent extractor (fixtures, no LLM).
  - Confirm with idempotency, and the read-back.
  - Popup confirm/saved states in the adapter.
  - `count` / `group_count` in `crm_manifest`.
  - All the negative tests.
- **Needs a decision:**
  - (a) Which roles may use actions (is shliach allowed?).
  - (b) Where the LLM call lives (CRM backend or crm-assitant), and the server-to-server auth between them.
  - (c) The `/chat` response contract: top-level `status`, `clarify`, `missing_fields`, `proposal`.
  - (d) What "unknown", `na` and mixed household mean for Jewish status.
  - (e) How long a proposal stays valid.
  - (f) Whether org docs become private (needs an org column).
  - (g) LLM cost and provider for prod.

### First implementation step

Backend only, no LLM:
- The `assistant_proposals` table.
- `POST /api/assistant/proposals`, which takes fields that are already structured.
- `POST /api/assistant/proposals/{id}/confirm`, using an extracted shared `create_contact_draft` service.
- Tests 1–4 and 9 passing on SQLite **and** local Postgres.

Intent extraction and the popup wiring then sit on top of a save path that is already proven safe.