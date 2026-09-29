import assert from "node:assert/strict";
import test from "node:test";
import { defaultColumnWidths } from "./gridLayout.js";
import { parseColumnWidths, parseSavedViews, updateSavedViewState } from "./savedViews.js";

const legacyView = {
  id: "legacy",
  name: "Legacy tab",
  globalQuery: "valve",
  group: { conjunction: "and", rules: [] },
  columnFilters: { 2: "1234" },
};

test("legacy saved views migrate to a complete default column-width state", () => {
  assert.deepEqual(parseSavedViews(JSON.stringify([legacyView])), [
    { ...legacyView, columnWidths: defaultColumnWidths() },
  ]);
});

test("saved width state is normalized without sharing mutable arrays", () => {
  const parsed = parseSavedViews(JSON.stringify([
    { ...legacyView, id: "one", columnWidths: [120, 240] },
    { ...legacyView, id: "two", columnWidths: [310, 420] },
  ]));
  assert.deepEqual(parsed[0]?.columnWidths.slice(0, 3), [120, 240, 200]);
  assert.deepEqual(parsed[1]?.columnWidths.slice(0, 3), [310, 420, 200]);
  assert.notEqual(parsed[0]?.columnWidths, parsed[1]?.columnWidths);
});

test("autosaving width changes updates only the active saved tab", () => {
  const views = parseSavedViews(JSON.stringify([
    { ...legacyView, id: "active", columnWidths: [120] },
    { ...legacyView, id: "other", columnWidths: [310] },
  ]));
  const updated = updateSavedViewState(views, "active", {
    globalQuery: "new query",
    group: { conjunction: "and", rules: [] },
    columnFilters: { 1: "filter" },
    columnWidths: [480],
  });
  assert.equal(updated[0]?.columnWidths[0], 480);
  assert.equal(updated[1]?.columnWidths[0], 310);
  assert.equal(updated[1], views[1]);
});

test("malformed saved-view storage fails safely", () => {
  assert.deepEqual(parseSavedViews("not json"), []);
  assert.deepEqual(parseSavedViews(JSON.stringify([{ name: "incomplete" }])), []);
});

test("the All RFQs view restores a normalized persisted column layout", () => {
  assert.deepEqual(parseColumnWidths(JSON.stringify([135, 287])).slice(0, 3), [135, 287, 200]);
  assert.deepEqual(parseColumnWidths("not json"), defaultColumnWidths());
});
