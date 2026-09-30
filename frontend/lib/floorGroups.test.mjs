// fixes77: focused tests for groupByFloor. The frontend has no test framework,
// so this uses Node's built-in runner (no dependency): from frontend/ run
//   node --test lib/floorGroups.test.mjs
// (Node >= 23.6 strips the .ts types natively.) Kept as .mjs so the Next/tsc
// build — which only includes *.ts/*.tsx — never picks it up.
import assert from "node:assert/strict";
import { test } from "node:test";

import { groupByFloor } from "./floorGroups.ts";

const apt = (id, floor) => ({ id, floor });
const ids = (groups) => groups.map((g) => [g.floor, g.apartments.map((a) => a.id)]);

test("keeps received (backend-configured) floor order, no re-sort", () => {
  // Backend order: lobby, ground, 0, 2, 10, letter floor.
  const rows = [apt(1, "L"), apt(2, "קרקע"), apt(3, "0"), apt(4, "2"), apt(5, "2"), apt(6, "10"), apt(7, "א")];
  assert.deepEqual(ids(groupByFloor(rows)), [
    ["L", [1]],
    ["קרקע", [2]],
    ["0", [3]],
    ["2", [4, 5]],
    ["10", [6]],
    ["א", [7]],
  ]);
});

test("keeps apartment order within a floor", () => {
  const rows = [apt(9, "1"), apt(3, "1"), apt(5, "1")];
  assert.deepEqual(ids(groupByFloor(rows)), [["1", [9, 3, 5]]]);
});

test("null and empty string share one unknown group, shown once each", () => {
  const rows = [apt(1, "1"), apt(2, null), apt(3, ""), apt(4, null)];
  assert.deepEqual(ids(groupByFloor(rows)), [
    ["1", [1]],
    [null, [2, 3, 4]],
  ]);
});

test("other strings stay distinct and untrimmed ('0' is a real floor)", () => {
  const rows = [apt(1, "0"), apt(2, " 1"), apt(3, "1")];
  assert.deepEqual(ids(groupByFloor(rows)), [
    ["0", [1]],
    [" 1", [2]],
    ["1", [3]],
  ]);
});

test("every apartment appears exactly once; single-apartment floors survive", () => {
  const rows = [apt(1, "1"), apt(2, "2"), apt(3, null), apt(4, "3")];
  const flat = groupByFloor(rows).flatMap((g) => g.apartments.map((a) => a.id));
  assert.deepEqual(flat.sort(), [1, 2, 3, 4]);
  assert.equal(groupByFloor(rows).length, 4);
});

test("single-floor building -> one group; empty building -> none", () => {
  assert.equal(groupByFloor([apt(1, "3"), apt(2, "3")]).length, 1);
  assert.deepEqual(groupByFloor([]), []);
});

test("per-building: same floor names in two buildings stay separate", () => {
  const a = groupByFloor([apt(1, "1"), apt(2, "2")]);
  const b = groupByFloor([apt(3, "1"), apt(4, "2")]);
  assert.deepEqual(ids(a), [["1", [1]], ["2", [2]]]);
  assert.deepEqual(ids(b), [["1", [3]], ["2", [4]]]);
});
