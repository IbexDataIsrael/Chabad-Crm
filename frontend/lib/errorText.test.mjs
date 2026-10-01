// fixes94: errorText — key parity with the backend + translation behavior.
// From frontend/ run:  node --test lib/errorText.test.mjs
// (Same .mjs convention as floorGroups.test.mjs — never picked up by tsc.)
import assert from "node:assert/strict";
import { test } from "node:test";

import { errorKey, localizeError, registerErrorTranslator } from "./errorText.ts";

test("errorKey matches backend error_key() on the shared examples", () => {
  // Same three examples as backend/tests/test_error_localization.py.
  assert.equal(errorKey("Email already registered"), "error.email_already_registered");
  assert.equal(
    errorKey("An assigned task can't be available — return it to the pool instead"),
    "error.an_assigned_task_can_t_be_available_return_it_to_the_pool_instead",
  );
  assert.equal(errorKey("page_size must be 20, 50 or 100"), "error.page_size_must_be_20_50_or_100");
});

test("plain message → translated by key; unknown → server text", () => {
  const table = { "error.email_already_registered": "כתובת האימייל כבר רשומה" };
  registerErrorTranslator((k, fb) => table[k] ?? fb);
  assert.equal(localizeError("Email already registered"), "כתובת האימייל כבר רשומה");
  assert.equal(localizeError("Something new"), "Something new");
  registerErrorTranslator(null);
});

test("coded error → t(code) with params filled in", () => {
  const table = { "error.email_taken_by_activist": "כתובת אימייל זו כבר משויכת לפעיל אחר בארגון: {name} (#{id})" };
  registerErrorTranslator((k, fb) => table[k] ?? fb);
  const body = { code: "error.email_taken_by_activist", params: { name: "יוסי כהן", id: "612" } };
  assert.equal(
    localizeError("This email already belongs…", body),
    "כתובת אימייל זו כבר משויכת לפעיל אחר בארגון: יוסי כהן (#612)",
  );
  // Before the table loads, the server's text stays.
  registerErrorTranslator(null);
  assert.equal(localizeError("Server text", body), "Server text");
});
