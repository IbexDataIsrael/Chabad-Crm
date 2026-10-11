// fixes98: tests for the street2 celebration list. From frontend/ run
//   node --test lib/celebrationItems.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fillPlaceholders,
  mergeCelebrationItems,
  messagesForLanguage,
  shuffled,
} from "./celebrationItems.ts";

const q = (id) => ({ id, he: `ציטוט ${id}`, en: `quote ${id}`, ref: "" });
const kinds = (items) => items.map((i) => (i.kind === "quote" ? `q${i.quote.id}` : i.text));

test("alternates regular text and messages, regular first", () => {
  assert.deepEqual(kinds(mergeCelebrationItems([q(1), q(2), q(3)], ["a", "b"])), [
    "q1", "a", "q2", "b", "q3",
  ]);
});

test("the longer side continues alone; either may be empty", () => {
  assert.deepEqual(kinds(mergeCelebrationItems([q(1)], ["a", "b", "c"])), ["q1", "a", "b", "c"]);
  assert.deepEqual(kinds(mergeCelebrationItems([], ["a"])), ["a"]);
  assert.deepEqual(kinds(mergeCelebrationItems([q(1)], [])), ["q1"]);
  assert.deepEqual(mergeCelebrationItems([], []), []);
});

test("fills the computed fields, leaves unknown names", () => {
  const stats = { organization_name: "בית חב\"ד", number_of_apartments: 25, number_of_jews: 9 };
  assert.equal(
    fillPlaceholders("הידעת שבמערכת {organization_name} רשומים {number_of_apartments} ומתוכם {number_of_jews} {other}", stats),
    "הידעת שבמערכת בית חב\"ד רשומים 25 ומתוכם 9 {other}",
  );
  assert.equal(fillPlaceholders("{organization_name}", null), "{organization_name}");
});

test("messages in the viewer's language, else all", () => {
  const msgs = [{ text: "שלום", language: "he" }, { text: "hi", language: "en" }];
  assert.deepEqual(messagesForLanguage(msgs, "en").map((m) => m.text), ["hi"]);
  assert.deepEqual(messagesForLanguage([msgs[0]], "en").map((m) => m.text), ["שלום"]);
});

test("shuffled keeps every item", () => {
  const out = shuffled([1, 2, 3, 4], () => 0);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4]);
});
