Don't push. Stop for my review.

Build the contact-draft action API from the inspection report. Backend only: no popup changes, LLM calls, deployment or live CRM requests. Preserve existing work. No commit.

The API must be independent of any chat UI:
1. Receive structured contact fields. Derive user and organization from authentication, never from caller-supplied org fields. Reuse existing permission and validation rules.
2. If required information is missing, return a structured needs_information response identifying the missing fields. Do not create a contact.
3. Otherwise return a proposal containing the exact draft details for confirmation. Proposal creation must not create a contact. Bind it to this user and org. Label expiry/storage choices in your report.
4. A separate confirmation operation must recheck permissions, validate the bound proposal and create the contact as a draft through shared CRM business logic. Read back the saved record and return its ID and draft status.
5. Enforce idempotency transactionally: concurrent confirmations and retries after an uncertain response must never create duplicate contacts. Return the original saved result on a valid replay. Reject changed payloads or another user's/org's proposal.
6. Test missing fields, no write before confirmation, validation failures, expired proposals, permission changes, cross-user/org access, concurrent confirmation and retry safety. Use isolated test databases only. No production data or real external calls.

Run the relevant tests and existing regression suite. Report actual results, changed files, API request/response examples and remaining limitations. Don't claim production readiness or hide failed tests.

Stop for review. No commit, no push.

---

# Closeout (2026-10-25)

Status: **done locally. Not committed, not pushed.** Backend only: no popup, LLM, deployment or live CRM requests.

## Changed files
- `backend/app/routers/assistant.py` (new): `POST /api/assistant/proposals`, `POST /api/assistant/proposals/{id}/confirm`
- `backend/app/core/contact_drafts.py` (new): shared `create_draft_contact` (phone unique per org, geocode fallback, Contact + ContactMekurav, flush only)
- `backend/app/routers/instinct/contacts.py`: Instinct create now calls the shared service (same behaviour)
- `backend/app/models.py` + migration `113b2c4d6e8f_fixes113_assistant_proposals.py`: new `assistant_proposals` table. `contacts` is not changed.
- `backend/app/main.py`: registers the router
- `backend/app/error_localization.py`: 4 new error messages (he/en)
- `backend/app/core/user_delete.py`: deleting a user deletes their proposals. Org delete picks the table up automatically (schema-derived).
- `backend/tests/test_fixes113.py` (25 tests, SQLite), `backend/tests/test_fixes113_postgres.py` (5 tests; real Postgres, skipped unless `FIXES113_PG_URL` is set)
- `docs/SYSTEM_SPEC.md`: feature entry

## Checklist
1. [x] Structured fields in. User and org come from the JWT only. Extra keys (`organization_id`, `user_id`, `assigned_user_id`) → 422. Role rules reuse `forbid_campaign_manager`; the owner is always the confirming user, as `create_contact` forces for shliach. Validation reuses Instinct's `clean_phone`/`clean_email`, `_check_phone_unique` and the column limits.
2. [x] Missing first_name/last_name → 200 `needs_information` + `missing_fields` (+ any `invalid_fields`). Nothing is stored.
3. [x] Proposal → 201, with the exact draft details and `payload_hash`. No contact is written. Bound to user + org + payload. **Storage: DB table `assistant_proposals`. Expiry: 15 min (`PROPOSAL_TTL`)** for pending proposals; an executed proposal can be replayed with no time limit.
4. [x] Confirm rechecks the user (active, org active, role), the hash/payload, expiry and validation (phone taken since). It creates the draft via the shared service, then reads back from the DB → `contact_id` + `status:"draft"`.
5. [x] Idempotency: a conditional UPDATE `pending→executed` runs in the same transaction as the insert. A loser returns `replayed:true` with the winner's contact. `result_contact_id` is UNIQUE. A rollback leaves the proposal pending, so a retry is safe. A changed hash/payload → 409. Another user's or org's proposal → 404, before or after execution.
6. [x] Tests: see below. A mutation check (claim without the `pending` predicate) makes the Postgres concurrency test fail: 6 contacts created with no phone, or 5×422 with a phone. The check was reverted.

## Test results
- `test_fixes113.py` + `test_fixes113_postgres.py`: **30 passed** (Postgres = throwaway DB `crm_fixes113_test` on crm_local_postgres)
- Full backend suite (in backend container): **832 passed, 1 skipped** (the existing `test_fixes103` email-service reachability skip), 9m59s

## Side effect to know
The running dev backend (`--reload`) auto-ran `alembic upgrade head` on reload, so **local `crm_local_dev` now has the empty `assistant_proposals` table** (revision 113b2c4d6e8f). Undo with `alembic downgrade 109a7c3e2d41`. Throwaway DB `crm_fixes113_test` was created for the tests and can be dropped.

## Limitations / not done
- No cancel endpoint, and no purge of expired proposals; old rows stay.
- No duplicate-name warning: it was left out because it would leak other contacts' names to a shliach.
- Phone-taken validation does show a shliach that a phone exists in the org. `create_contact` has the same behaviour today.
- Error responses are codes (`invalid_phone`, `phone_taken`, `invalid_email`, `too_long`) with no localized text. The UI will have to map them.
- The geocode call (when an address is given and a key is set) runs inside the confirm transaction, after the claim, for up to 5s.
- Decisions from fixes112 are still open (which roles may use actions, where the LLM call lives, the /chat contract). Not production-ready; not tested against prod.
