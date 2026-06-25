# Bilingual Mini CRM MVP

A bilingual (Hebrew/English) Mini CRM MVP designed to manage community contacts, track historical interaction logs, and coordinate geographic touchpoints. The system supports multi-tenant SaaS isolation, granular role scoping, and a dynamic field translation metadata engine.

---

## 🚀 Quick Start

The easiest way to run the entire stack (Next.js frontend, FastAPI backend, SQLite, and background scheduler) is via Docker Compose.

### Prerequisite: Environment Setup
Ensure you have a `.env` file at the root of the project with configurations matching your local dev environment.

```sh
# Start the development ecosystem
docker-compose up --build
```

- **CRM Dashboard (Frontend):** [http://localhost:3001](http://localhost:3001)
- **Interactive Swagger Docs (Backend):** [http://localhost:8001/docs](http://localhost:8001/docs)

*Note: Host ports are mapped to `3001` (frontend) and `8001` (backend) to avoid conflict with standard standard local services.*

---

## 🛠️ Tech Stack

- **Frontend:** Next.js (TypeScript) with Tailwind CSS for RTL (Right-to-Left) layouts.
- **Backend:** FastAPI (Python) and SQLAlchemy ORM.
- **Database:** SQLite (stored locally under `backend/data/crm.sqlite3` during development).
- **Authentication:** Google OAuth2 (Google Identity Services) integrated side-by-side with secure local credentials (bcrypt + JWT bearer tokens).
- **Automation:** APScheduler for background emailing of significant date reminders.

---

## 📂 Project Structure

```
├── backend/
│   ├── app/
│   │   ├── core/           # Security, email service, Google OAuth, and geocoding utilities
│   │   ├── routers/        # FastAPI endpoint controllers (auth, contacts, areas, etc.)
│   │   ├── database.py     # SQLAlchemy session setup
│   │   ├── main.py         # App entrypoint and lifecycle hooks
│   │   ├── models.py       # SQLAlchemy ORM models (normalized schemas)
│   │   ├── scheduler.py    # Significant date reminder polling task
│   │   ├── schemas.py      # Pydantic schemas (Request/Response models)
│   │   └── seed.py         # Database seeding and default picklist provisions
│   └── tests/              # Pytest test suites (auth, contacts, picklists, etc.)
│
├── frontend/
│   ├── app/                # Next.js App Router (dashboard, auth pages)
│   ├── components/         # Custom React elements (Address Autocomplete, custom calendar, Maps)
│   ├── lib/                # API and Google Maps helper classes
│   └── public/             # Static assets
│
└── docs/                   # System design, plans, database layout, and review notes
```

---

## 🔧 Local Development Setup

If you prefer to run the applications locally without Docker:

### 1. Python Backend
Navigate to the `backend/` directory:
```sh
# Install dependencies
pipenv install

# Start local reload server
pipenv run uvicorn app.main:app --reload

# Run tests
pytest
```

Required environment variables in `backend/.env`:
```env
DATABASE_URL=sqlite:///./data/crm.sqlite3
SECRET_KEY=your-super-secure-jwt-secret-key-change-it
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480
```

### 2. Next.js Frontend
Navigate to the `frontend/` directory:
```sh
# Install dependencies
npm install

# Start development server
npm run dev
```

---

## 📐 Core Architecture & Data Engine

### 1. Multi-Tenancy Scoping
Every customer is registered under an `Organization`. Tenant data isolation is strictly scoped at the database query level:
- Tenant-scoped tables carry an `organization_id` column.
- Authentication tokens carry tenant claims, enforcing isolation for contacts, buildings, apartments, and picklists.

### 2. Localization & Picklist Engine
The CRM maintains a metadata-driven translations model to support bilingual presentation:
- **Field Translations:** Technical schemas remain strictly in English. UI Hebrew labels are stored globally in `field_localization` and resolved on boot by the frontend from `GET /api/metadata/localization`.
- **Picklist Lookups:** Dynamic, per-organization dropdown lookups (like pipeline statuses, categories, and tags) are managed via `picklist_values`. Only administrators (`admin` role) are authorized to modify picklist configurations.

### 3. Geographic Normalization & Shliach Role
Contacts are split into two groups (`contact_type`): **Mekurav** (regular community contacts) and **Shliach** (community coordinators).
- Geographic parameters are normalized structurally: **Areas** (which support GeoJSON boundary drawing) $\rightarrow$ **Buildings** $\rightarrow$ **Apartments**.
- Creating a Shliach auto-provisions a secure login account (`shliach` role).
- Shliach users are subject to row-level security: they are only authorized to read contacts in apartments they cover (via the M2M mapping table `contact_shliach_apartment`).

---

## 📖 Further Documentation

For deep dives into codebase decisions, database layouts, and issues, see:
- [CLAUDE.md](file:///c:/projects/sheepsidebay_crm/CLAUDE.md): Development scripts and command guides.
- [docs/DATABASE.md](file:///c:/projects/sheepsidebay_crm/docs/DATABASE.md): Entity relationship definitions.
- [docs/review.md](file:///c:/projects/sheepsidebay_crm/docs/review.md): Current code review, performance optimizations, and security scoping issues.
- [docs/plan.md](file:///c:/projects/sheepsidebay_crm/docs/plan.md) & [docs/fixes2-plan.md](file:///c:/projects/sheepsidebay_crm/docs/fixes2-plan.md): Architectural roadmap and feature evolution maps.
