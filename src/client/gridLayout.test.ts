import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_COLUMN_WIDTH,
  MAXIMUM_COLUMN_WIDTH,
  MINIMUM_COLUMN_WIDTH,
  defaultColumnWidths,
  fittedWidthFromMeasurements,
  normalizeColumnWidths,
  placeCellPopover,
} from "./gridLayout.js";

test("column widths normalize a complete state and clamp persisted values", () => {
  assert.deepEqual(
    normalizeColumnWidths([45, 241.6, Number.NaN, 900]),
    [MINIMUM_COLUMN_WIDTH, 242, DEFAULT_COLUMN_WIDTH, MAXIMUM_COLUMN_WIDTH, ...defaultColumnWidths().slice(4)],
  );
  assert.equal(normalizeColumnWidths(undefined).length, 10);
});

test("fit-to-content uses the widest measured rendered value", () => {
  assert.equal(fittedWidthFromMeasurements([87.2, 213.1, 154]), 214);
  assert.equal(fittedWidthFromMeasurements([12]), MINIMUM_COLUMN_WIDTH);
  assert.equal(fittedWidthFromMeasurements([900]), MAXIMUM_COLUMN_WIDTH);
});

test("cell popovers attach below when they fit", () => {
  assert.deepEqual(
    placeCellPopover(
      { left: 40.3, right: 240, top: 100, bottom: 132 },
      { width: 300, height: 220 },
      { width: 1000, height: 700 },
    ),
    { left: 40.3, top: 132, placement: "below" },
  );
});

test("cell popovers use measured height to attach above near the bottom", () => {
  assert.deepEqual(
    placeCellPopover(
      { left: 880, right: 980, top: 640, bottom: 672 },
      { width: 300, height: 217 },
      { width: 1000, height: 700 },
    ),
    { left: 692, top: 423, placement: "above" },
  );
});

test("oversized popovers clamp to the viewport edge", () => {
  assert.deepEqual(
    placeCellPopover(
      { left: -20, right: 40, top: 20, bottom: 52 },
      { width: 500, height: 500 },
      { width: 320, height: 240 },
    ),
    { left: 8, top: 8, placement: "below" },
  );
});
