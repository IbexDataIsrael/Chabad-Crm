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
