import assert from "node:assert/strict";
import test from "node:test";
import type { SavedFilterView } from "./filters.js";
import { createSharedViewUrl, parseSharedViewUrl, withoutSharedViewHash } from "./viewSharing.js";

const view: SavedFilterView = {
  id: "local-only-id",
  name: "Aircraft parts — next week",
  globalQuery: "bearing",
  group: {
    conjunction: "and",
    rules: [{ id: "rule-1", field: "closeDate", operator: "within_next_days", value: "7" }],
  },
  columnFilters: { 2: "1560" },
  columnWidths: [132, 420, 175],
};

test("shared view URLs round-trip filters and normalized column settings", () => {
  const url = createSharedViewUrl(view, "http://localhost:5173/rfqs?from=2026-09-01");
  const parsed = parseSharedViewUrl(url, "http://localhost:5173/");
  assert.equal(parsed?.name, view.name);
  assert.equal(parsed?.globalQuery, "bearing");
  assert.deepEqual(parsed?.group, view.group);
  assert.deepEqual(parsed?.columnFilters, view.columnFilters);
  assert.deepEqual(parsed?.columnWidths.slice(0, 3), [132, 420, 175]);
  assert.equal("id" in (parsed ?? {}), false);
});

test("shared view parsing rejects malformed links and can clean an imported hash", () => {
  assert.equal(parseSharedViewUrl("https://example.test/#rfq-view=garbage", "https://example.test/"), null);
  const url = createSharedViewUrl(view, "https://example.test/app?x=1#keep=yes");
  assert.equal(withoutSharedViewHash(url), "/app?x=1#keep=yes");
});

test("shared view parsing rejects invalid filter rules and column filter indexes", () => {
  const badRule = createSharedViewUrl({
    ...view,
    group: { conjunction: "and", rules: [{ ...view.group.rules[0], operator: "execute_code" as never }] },
  }, "https://example.test/");
  const badColumn = createSharedViewUrl({
    ...view,
    columnFilters: { 99: "hidden" },
  }, "https://example.test/");

  assert.equal(parseSharedViewUrl(badRule, "https://example.test/"), null);
  assert.equal(parseSharedViewUrl(badColumn, "https://example.test/"), null);
});

test("shared view URLs replace a previous shared payload without disturbing other hash state", () => {
  const first = createSharedViewUrl(view, "https://example.test/app#keep=yes");
  const second = createSharedViewUrl({ ...view, name: "Replacement" }, first);
  assert.equal(parseSharedViewUrl(second, "https://example.test/")?.name, "Replacement");
  assert.match(second, /keep=yes/);
  assert.equal((second.match(/rfq-view=/g) ?? []).length, 1);
});
