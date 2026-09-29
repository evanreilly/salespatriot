import assert from "node:assert/strict";
import test from "node:test";
import type { Rfq } from "../shared/rfq.js";
import { layoutBuyerTreemap } from "./BuyerTreemap.js";
import { buildBuyerInsights, seededRelationship, spendTier } from "./buyerInsights.js";

const rows = [
  { buyerName: "Avery", closeDate: "2026-10-02", estimatedValue: 60_000 },
  { buyerName: "Avery", closeDate: "2026-10-04", estimatedValue: 10_000 },
  { buyerName: "Blake", closeDate: "2026-09-01", estimatedValue: 2_000_000 },
  { buyerName: "Casey", closeDate: "2026-10-05", estimatedValue: 1_200_000 },
] as Rfq[];

test("buyer insights include only open solicitation value", () => {
  const insights = buildBuyerInsights(rows, "2026-09-28");
  assert.deepEqual(insights.map(({ name, openRfqCount, totalValue, spendTier }) => ({ name, openRfqCount, totalValue, spendTier })), [
    { name: "Casey", openRfqCount: 1, totalValue: 1_200_000, spendTier: 4 },
    { name: "Avery", openRfqCount: 2, totalValue: 70_000, spendTier: 2 },
  ]);
});

test("relationship demo data is deterministic and spend tiers are bounded", () => {
  assert.equal(seededRelationship("Avery"), seededRelationship("Avery"));
  assert.deepEqual([0, 49_999, 50_000, 250_000, 1_000_000].map(spendTier), [0, 1, 2, 3, 4]);
});

test("buyer treemap preserves all valued buyers and the full area", () => {
  const rectangles = layoutBuyerTreemap(buildBuyerInsights(rows, "2026-09-28"));
  assert.deepEqual(rectangles.map((rectangle) => rectangle.name).sort(), ["Avery", "Casey"]);
  const area = rectangles.reduce((total, rectangle) => total + rectangle.width * rectangle.height, 0);
  assert.ok(Math.abs(area - 10_000) < 0.001);
});
