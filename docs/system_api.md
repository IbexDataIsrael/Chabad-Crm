# Instinct Test API - minicrm

One test-grade endpoint so Instinct can add contacts. No complex auth yet.

## 1. Endpoints

**GET /api/instinct/ping** - connectivity check. Returns `{"ok": true}`.

**POST /api/instinct/contacts** - create a Contact in the org, as a **draft** awaiting approval (see §1a).

Request body (JSON):
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+1 718 555 0100",
  "address": "1414 Kingston Ave, Brooklyn",
  "email": "john.doe@example.com"
}
```
`phone`, `address` and `email` optional. `email` must look like `name@domain.tld` (basic format check, 422 otherwise); it is stored trimmed and lowercased. Return the created contact as JSON, including its `id`, `email`, `source` and `status`, with status 201:
```json
{
  "id": 123,
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+1 718 555 0100",
  "address": "1414 Kingston Ave, Brooklyn",
  "email": "john.doe@example.com",
  "source": "instinct",
  "status": "draft",
  "organization_id": 1,
  "created_at": "2026-09-24T10:00:00"
}
```

## 1a. Source and draft approval

Every contact has two server-set fields:

| Field | Values | Default |
|---|---|---|
| `source` | `crm` (created in the app) \| `instinct` (this API) | `crm` |
| `status` | `active` \| `draft` | `active` |

- This API **always** creates `source="instinct"`, `status="draft"`. Any `source`/`status` in the request body is ignored.
- Contacts created in the normal UI are always `source="crm"`, `status="active"`.
- Drafts are **not** in the regular contacts list (or the bulk-email / bulk-update sets). The contacts page shows them in a separate "Pending approval" (ממתינים לאישור) section, each with a Draft badge and an Approve button.
- Approving: `POST /api/contacts/{id}/approve` (regular CRM JWT, admin or staff) sets `status="active"`, which moves the contact into the main list. Idempotent.
- Listing drafts: `GET /api/contacts/list?status=draft` (default `status=active`).

## 2. Auth (test-grade)

One shared token, checked on both endpoints:

```python
import os
from fastapi import Header, HTTPException

def check_key(x_instinct_key: str = Header(...)):
    if x_instinct_key != os.environ.get("INSTINCT_API_KEY"):
        raise HTTPException(status_code=401, detail="bad key")
```

Set `INSTINCT_API_KEY` in the server env. This is test-grade only - production needs per-user tokens.

## 3. Test with curl

```bash
# ping
curl -H "X-Instinct-Key: $INSTINCT_API_KEY" https://YOUR-HOST/api/instinct/ping

# create contact
curl -X POST https://YOUR-HOST/api/instinct/contacts \
  -H "X-Instinct-Key: $INSTINCT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"first_name":"John","last_name":"Doe","address":"1414 Kingston Ave, Brooklyn"}'
```

## 4. How Instinct uses this

1. Call GET /api/instinct/ping first. Proceed only on 200 `{"ok": true}`.
2. To add a contact, POST the JSON body to /api/instinct/contacts.
3. Ambiguous names (e.g. "Levy John Doe" - which is the surname?) get asked back to the user, never guessed.
4. Report the created contact `id` back to the user, and tell them it is waiting for approval in the CRM (`status: "draft"`).

## 5. Where it lives

- New file: `backend/app/routers/instinct.py`
- Register the router in `main` (same pattern as the existing /api routers).
- Target org: env `INSTINCT_ORG_ID` (default 1).
- `contacts.source` / `contacts.status` columns: migration `e6f7a8b9c0d1_contacts_source_status.py`.
- Draft filtering + approve endpoint: `backend/app/routers/contacts.py`; pending section: `frontend/components/PendingApprovalContacts.tsx`.
