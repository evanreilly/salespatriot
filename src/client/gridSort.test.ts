import assert from "node:assert/strict";
import test from "node:test";
import { sortGridIndexes } from "./gridSort.js";

const values = [
  ["RFQ-10", "Valve", 2],
  ["RFQ-2", "Filter", 10],
  ["RFQ-1", "Filter", 3],
];

test("grid sorting uses numeric text order", () => {
  assert.deepEqual(
    [...sortGridIndexes(values, Uint32Array.from([0, 1, 2]), [{ column: 0, direction: "ascending" }])],
    [2, 1, 0],
  );
});

test("grid sorting applies multiple rules stably", () => {
  assert.deepEqual(
    [...sortGridIndexes(values, Uint32Array.from([0, 1, 2]), [
      { column: 1, direction: "ascending" },
      { column: 2, direction: "descending" },
    ])],
    [1, 2, 0],
  );
});
