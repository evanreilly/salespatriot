import type { Rfq } from "../shared/rfq";

export type BuyerInsight = {
  name: string;
  openRfqCount: number;
  totalValue: number;
  relationship: boolean;
  spendTier: 0 | 1 | 2 | 3 | 4;
  colorIndex: number;
};

export function buildBuyerInsights(rfqs: Rfq[], today = localDateKey()) {
  const grouped = new Map<string, { openRfqCount: number; totalValue: number }>();
  for (const rfq of rfqs) {
    const name = rfq.buyerName?.trim();
    if (!name || (rfq.closeDate && rfq.closeDate < today)) continue;
    const current = grouped.get(name) ?? { openRfqCount: 0, totalValue: 0 };
    current.openRfqCount += 1;
    current.totalValue += Math.max(0, rfq.estimatedValue ?? 0);
    grouped.set(name, current);
  }

  return [...grouped.entries()]
    .map(([name, totals]): BuyerInsight => ({
      name,
      ...totals,
      relationship: seededRelationship(name),
      spendTier: spendTier(totals.totalValue),
      colorIndex: stableHash(name) % 8,
    }))
    .sort((left, right) => right.totalValue - left.totalValue || right.openRfqCount - left.openRfqCount || left.name.localeCompare(right.name));
}

export function buyerInsightMap(insights: BuyerInsight[]) {
  return new Map(insights.map((insight) => [insight.name, insight]));
}

export function spendTier(value: number): BuyerInsight["spendTier"] {
  if (value <= 0) return 0;
  if (value < 50_000) return 1;
  if (value < 250_000) return 2;
  if (value < 1_000_000) return 3;
  return 4;
}

export function bidSizeTier(value: number): BuyerInsight["spendTier"] {
  if (value <= 0) return 0;
  if (value < 1_000) return 1;
  if (value < 5_000) return 2;
  if (value < 25_000) return 3;
  return 4;
}

export function spendTierLabel(tier: BuyerInsight["spendTier"]) {
  return tier === 0 ? "" : "$".repeat(tier);
}

export function seededRelationship(name: string) {
  return stableHash(name) % 100 < 28;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
