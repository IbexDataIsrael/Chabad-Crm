# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A bilingual (Hebrew/English) Mini CRM MVP designed to manage contacts, track historical interaction logs, and monitor community/religious touchpoints. The system natively features RTL (Right-to-Left) layouts, multi-table database normalization, and a dynamic field translation metadata engine.

Tech stack: Next.js frontend (Tailwind CSS for native RTL layouts) and a lightweight Python FastAPI backend using SQLAlchemy with an SQLite database.

Color scheme requirements (matching spreadsheet markers):
- Core status indicators: Magenta, Bright Green, Yellow, Dark Red, Orange.
- Main UI layout handles high-contrast row shading cleanly.

Coding standards: Full UTF-8 support for Hebrew text strings, absolute separation of data storage (strictly English schemas) and UI presentation layers (Hebrew labels via metadata), secure authentication handling, no over-engineering.

## Running the app

The app runs locally via Docker or local dev servers. Create a `.env` file at the root containing local configurations.

```sh
# Start entire local ecosystem
docker-compose up --build
```

Smoke checks after start: `http://localhost:3001/` (CRM Login/Dashboard), `http://localhost:8001/docs` (Backend Swagger API).

> Note: host ports are `3001` (frontend) and `8001` (backend) to avoid colliding with another local service on `3000`/`8000`. Inside the containers the apps still listen on `3000`/`8000`.

## Python Backend Instructions

The backend is built with FastAPI and SQLAlchemy (using an SQLite engine).

### Environment Configuration
Ensure your `backend/.env` file contains:
```env
DATABASE_URL=sqlite:///./data/crm.sqlite3
SECRET_KEY=your-super-secure-jwt-secret-key-change-it
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=43200
```

### Execution Commands
Navigate to the `backend/` directory to manage execution:
```sh
pipenv install                             # Install dependencies
pipenv run uvicorn app.main:app --reload   # Run local dev backend server
pytest                                     # Execute Python backend test suites
```

## Architecture

### Request & Auth Flow

1. **Authentication & Roles:** User registration (`POST /api/auth/register`) and login (`POST /api/auth/token`) utilize secure bcrypt hashing and return an OAuth2 JWT bearer token carrying the user's `role` (`admin` | `staff`). A `require_admin` dependency gates admin-only actions (403 otherwise).
2. **Protected Routes:** All `/api/contacts/*`, `/api/interactions/*`, `/api/regions/*`, and `/api/picklists/*` routes require a valid JWT header (`Authorization: Bearer <token>`).
3. **Localization Engine:** The frontend fetches UI metadata from `GET /api/metadata/localization` at boot time to dynamically replace backend English column schemas with corresponding Hebrew UI text nodes.
4. **Picklist Engine:** The allowed dropdown/lookup values for constrained fields are stored **per organization** in `picklist_values` and managed via `/api/picklists/*`. The managed field_keys are `contact.area`, `contact.pipeline_status`, `contact.color_tag`, `contact.potential_next_step`, `checklist.torah_thought`, and `interaction.category`. `GET /api/picklists` returns this full registry (with Hebrew labels) so admins can edit every list — even empty ones. Reads are open to any authenticated user in the org; **only admins** (`require_admin`) can add/rename/reorder/recolor/disable options. Constrained-column writes are validated against the active picklist. Stored values stay technical/English; Hebrew labels + `color_hint` drive presentation.

5. **Multi-tenancy:** Each customer is an `organization` (tenant). Public **signup** (`POST /api/auth/signup`) creates an org + a pending admin, activated via an emailed verification link (`GET /api/auth/verify-email`); the org name is the app title. All `/api/contacts/*`, `/api/interactions/*`, `/api/users/*`, and `/api/picklists/*` data is isolated by `organization_id`. The standalone regions table was removed — `אזור` is the `contact.area` picklist.
