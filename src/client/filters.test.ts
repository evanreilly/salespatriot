import assert from "node:assert/strict";
import test from "node:test";
import type { Rfq } from "../shared/rfq.js";
import { applyRfqFilters, type FilterGroup } from "./filters.js";

const rows = [
  { title: "AIRCRAFT VALVE", buyerName: "Avery", quantity: 4, estimatedValue: 1000 },
  { title: "TRUCK FILTER", buyerName: "Blake", quantity: 20, estimatedValue: 500 },
] as Rfq[];

test("whole-table search scans all displayed fields", () => {
  assert.equal(applyRfqFilters(rows, "blake", { conjunction: "and", rules: [] }).length, 1);
});

test("advanced rules support AND and OR Boolean logic", () => {
  const rules: FilterGroup = {
    conjunction: "and",
    rules: [
      { id: "1", field: "title", operator: "contains", value: "aircraft" },
      { id: "2", field: "quantity", operator: "less_than", value: "10" },
    ],
  };
  assert.deepEqual(applyRfqFilters(rows, "", rules).map((row) => row.title), ["AIRCRAFT VALVE"]);
  const orRules: FilterGroup = {
    conjunction: "or",
    rules: [rules.rules[0], { ...rules.rules[1], operator: "greater_than" }],
  };
  assert.equal(applyRfqFilters(rows, "", orRules).length, 2);
});
