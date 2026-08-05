make plan bfore code!
Please build a prompt-driven natural language interface and integrate it directly into our existing Python CRM site. 

Our directory structure is now combined. You can see our existing web app code in the parallel folders, and our new AI playground sits inside the 'crm ai' folder. 

Core System Architecture & Specs:
1. Environment Track: Run on Python 3.12 via Docker Compose (`docker-compose.yml`).
2. Model Target Profile: Must use `claude-sonnet-5` for all prompt routing pipelines.
3. Credentials & Keys: Read `os.environ.get("ANTHROPIC_API_KEY")` natively from our shared project `.env` file. Do not hardcode the key string in plaintext.

Step 1: Scan and Map Our Real Database
- Automatically scan our existing database models, repository files, or SQL setups in this workspace.
- Generate a `crm_manifest.py` file inside the `ai_sandbox` folder that maps a python dictionary contract matching our REAL database tables and columns.

Step 2: Build the Backend UI Router (`query.py`)
- Update `query.py` to act as an Intent and UI Layout Router.
- It must take a text command from the front-end, cross-reference the schema in `crm_manifest.py`, and return a clean, structured JSON payload.
- The SDK parsing must use `response.content.text` before running `json.loads()`.
- The returned JSON layout must look exactly like this so our frontend can read it:
{
    "ui_action": "RENDER_TABLE",
    "table_title": "Descriptive Report Title",
    "sql_query_to_run": "SELECT ... FROM [Our_Real_Table] WHERE ..."
}

Step 3: Build the Web UI Chat Interface
- Create a modern, clean HTML/CSS/JavaScript Chat Component to integrate into our existing site layout.
- The UI must feature a prominent, stylized text prompt input bar at the bottom labeled: "What would you like to do?"
- When a user types a command (e.g., "Show me won leads in London"), the JavaScript must POST the prompt to our Python backend, capture the incoming JSON response payload, execute the SQL query locally, and dynamically render a beautiful interactive Data Grid inside the main dashboard view area instead of the old-school menus.

Run a complete system validation check using docker compose to ensure the entire backend and UI rendering pipeline executes seamlessly without throwing 404 endpoint routing errors.

---

## Implemented design (amended after security review)

Built and shipped in this codebase, with two deliberate, explicitly-approved
deviations from the spec above:

1. **No `sql_query_to_run`, ever.** The LLM never emits SQL. It returns a
   constrained JSON intent instead:
   `{"ok": true, "table": "<allowlisted key>", "title": "...", "filters": [{"column": "...", "op": "eq|contains|gt|gte|lt|lte", "value": ...}]}`
   (or `{"ok": false, "message": "..."}` when nothing matches). The backend
   (`backend/app/crm_manifest.py`) validates `table`/`column`/`op`/`value`
   against an explicit allowlist — five virtual tables (contacts, visits,
   donations, buildings, apartments) with fixed columns — and only then builds
   a SQLAlchemy query, reusing this app's existing org + role/shliach scoping
   helpers (`_contacts_query`, `_shliach_apartment_ids`) unconditionally,
   regardless of what the model returned.
   **Why:** letting an LLM produce free-form SQL that gets executed bypasses
   every other route's `organization_id`/role scoping in this multi-tenant
   CRM — a real SQL-injection and cross-tenant data-leak risk, not a
   hypothetical one (e.g. a `donations` list is admin-only everywhere else in
   this app; raw SQL from an LLM has no way to know or enforce that).

2. **The frontend never executes anything against the database.**
   `POST /api/ai/query` (`backend/app/routers/ai_query.py`) does the intent
   validation *and* runs the scoped query server-side, returning already-
   fetched rows. The frontend (`frontend/app/dashboard/ai/query/page.tsx`)
   only renders what it's given — same end-user experience (prompt in, table
   out), no client-side DB access of any kind.
   **Why:** the frontend has no business touching the database directly under
   any design; the browser is not a trusted execution context for a query
   against tenant data.

Also: `response.content[0].text` is the correct SDK parse (`.content` is a
list of blocks) — the `response.content.text` shown in the original spec
above is a bug and was not replicated.

This redesign was proposed after finding a live Anthropic API key committed
in this repo's `crm ai/` scratch folder (now deleted) and reviewing the raw-
SQL design for injection/tenant-isolation risk, then confirmed with the
project owner before implementation (see chat history, 2026-08-05).
