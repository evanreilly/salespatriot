import assert from "node:assert/strict";
import test from "node:test";
import type { Rfq } from "../shared/rfq.js";
import { applyCachedRfqFilters, applyRfqFilters, type FilterGroup } from "./filters.js";

const rows = [
  {
    title: "AIRCRAFT VALVE",
    buyerName: "Avery",
    quantity: 4,
    estimatedValue: 1000,
    approvedPartNumbers: ["AD-BJ20-E1-BJ79", "SECOND-PART"],
  },
  {
    title: "TRUCK FILTER",
    buyerName: "Blake",
    quantity: 20,
    estimatedValue: 500,
    approvedPartNumbers: ["TRK-100"],
  },
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

test("approved part-number rules search every approved part on an RFQ", () => {
  const containsPart: FilterGroup = {
    conjunction: "and",
    rules: [{ id: "part", field: "approvedPartNumber", operator: "contains", value: "bj20-e1" }],
  };
  assert.deepEqual(applyRfqFilters(rows, "", containsPart).map((row) => row.title), ["AIRCRAFT VALVE"]);

  const exactPart: FilterGroup = {
    conjunction: "and",
    rules: [{ id: "part", field: "approvedPartNumber", operator: "equals", value: "second-part" }],
  };
  assert.deepEqual(applyRfqFilters(rows, "", exactPart).map((row) => row.title), ["AIRCRAFT VALVE"]);
});

test("whole-table search includes approved part numbers", () => {
  assert.deepEqual(applyRfqFilters(rows, "ad-bj20", { conjunction: "and", rules: [] }).map((row) => row.title), ["AIRCRAFT VALVE"]);
});

test("cached views reuse the base array for an unfiltered tab", () => {
  const group: FilterGroup = { conjunction: "and", rules: [] };
  assert.equal(applyCachedRfqFilters(rows, "", group, {}), rows);
  assert.equal(
    applyCachedRfqFilters(rows, "blake", group, {}),
    applyCachedRfqFilters(rows, "blake", group, {}),
  );
});

test("cached views apply displayed column values", () => {
  const group: FilterGroup = { conjunction: "and", rules: [] };
  assert.deepEqual(
    applyCachedRfqFilters(rows, "", group, { 1: "truck", 6: "blake" }).map((row) => row.title),
    ["TRUCK FILTER"],
  );
});
