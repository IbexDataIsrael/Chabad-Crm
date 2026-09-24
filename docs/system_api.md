# Instinct Test API - minicrm

One test-grade endpoint so Instinct can add contacts. No complex auth yet.

## 1. Endpoints

**GET /api/instinct/ping** - connectivity check. Returns `{"ok": true}`.

**POST /api/instinct/contacts** - create a Contact in the org.

Request body (JSON):
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+1 718 555 0100",
  "address": "1414 Kingston Ave, Brooklyn"
}
```
`phone` and `address` optional. Return the created contact as JSON, including its `id`, with status 201.

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
4. Report the created contact `id` back to the user.

## 5. Where it lives

- New file: `backend/app/routers/instinct.py`
- Register the router in `main` (same pattern as the existing /api routers).
- No changes to existing code. Use the existing Contact SQLAlchemy model and the org scoping the other routers use.
