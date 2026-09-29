import { useMemo, useState, type CSSProperties } from "react";
import type { BuyerInsight } from "./buyerInsights";
import { spendTierLabel } from "./buyerInsights";

type Rect = BuyerInsight & { x: number; y: number; width: number; height: number };

export function BuyerTagKey() {
  return (
    <div className="buyer-tag-key" aria-label="Buyer relationship and individual RFQ value tag key">
      <span className="buyer-key-label">Bid size</span>
      <span className="buyer-tag relationship-tag">REL</span><span>prior relationship / win</span>
      <span className="buyer-tag spend-tag tier-1">$</span><span>&lt;$1k</span>
      <span className="buyer-tag spend-tag tier-2">$$</span><span>$1–5k</span>
      <span className="buyer-tag spend-tag tier-3">$$$</span><span>$5–25k</span>
      <span className="buyer-tag spend-tag tier-4">$$$$</span><span>$25k+</span>
    </div>
  );
}

export function BuyerTreemapPanel({
  insights,
  initialBuyer,
  onClose,
}: {
  insights: BuyerInsight[];
  initialBuyer: string | null;
  onClose: () => void;
}) {
  const [selectedBuyer, setSelectedBuyer] = useState(initialBuyer);
  const valued = useMemo(() => insights.filter((insight) => insight.totalValue > 0), [insights]);
  const rectangles = useMemo(() => layoutBuyerTreemap(valued), [valued]);
  const totalValue = valued.reduce((total, insight) => total + insight.totalValue, 0);
  const selected = insights.find((insight) => insight.name === selectedBuyer) ?? null;

  return (
    <section className="buyer-treemap-panel" aria-label="Open solicitation value by buyer">
      <header className="buyer-treemap-head">
        <div>
          <strong>Open solicitation value by buyer</strong>
          <span>{insights.length.toLocaleString()} buyers · {formatCompactCurrency(totalValue)} · current filters</span>
        </div>
        {selected && (
          <div className="buyer-treemap-selection">
            <span>Selected</span>
            <strong>{selected.name}</strong>
            <b>{formatCompactCurrency(selected.totalValue)} · {selected.openRfqCount.toLocaleString()} RFQs</b>
          </div>
        )}
        <button className="popover-close-button" onClick={onClose} aria-label="Close buyer treemap">×</button>
      </header>
      <div className="buyer-treemap-canvas">
        {rectangles.map((rectangle) => {
          const labelFits = rectangle.width >= 10 && rectangle.height >= 12;
          const style = {
            left: `${rectangle.x}%`,
            top: `${rectangle.y}%`,
            width: `${rectangle.width}%`,
            height: `${rectangle.height}%`,
            "--buyer-color": `var(--buyer-color-${rectangle.colorIndex})`,
          } as CSSProperties;
          return (
            <button
              key={rectangle.name}
              className={`buyer-treemap-tile${rectangle.relationship ? " relationship" : ""}${selectedBuyer === rectangle.name ? " selected" : ""}`}
              style={style}
              onClick={() => setSelectedBuyer(rectangle.name)}
              title={`${rectangle.name}: ${formatCurrency(rectangle.totalValue)} across ${rectangle.openRfqCount.toLocaleString()} open RFQs${rectangle.relationship ? " · prior relationship / win" : ""}`}
            >
              {labelFits && <><strong>{rectangle.name}</strong><span>{formatCompactCurrency(rectangle.totalValue)} · {spendTierLabel(rectangle.spendTier)}</span></>}
            </button>
          );
        })}
        {rectangles.length === 0 && <div className="buyer-treemap-empty">No open RFQs with estimated values match the current filters.</div>}
      </div>
    </section>
  );
}

export function layoutBuyerTreemap(insights: BuyerInsight[]): Rect[] {
  const items = insights.filter((insight) => insight.totalValue > 0);
  const rectangles: Rect[] = [];
  partition(items, { x: 0, y: 0, width: 100, height: 100 }, rectangles);
  return rectangles;
}

function partition(
  items: BuyerInsight[],
  bounds: { x: number; y: number; width: number; height: number },
  output: Rect[],
) {
  if (items.length === 0) return;
  if (items.length === 1) {
    output.push({ ...items[0], ...bounds });
    return;
  }
  const total = items.reduce((sum, item) => sum + item.totalValue, 0);
  let leftTotal = 0;
  let split = 1;
  let smallestDifference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < items.length; index += 1) {
    leftTotal += items[index - 1].totalValue;
    const difference = Math.abs(total / 2 - leftTotal);
    if (difference > smallestDifference) break;
    smallestDifference = difference;
    split = index;
  }
  const first = items.slice(0, split);
  const second = items.slice(split);
  const ratio = first.reduce((sum, item) => sum + item.totalValue, 0) / total;
  if (bounds.width >= bounds.height) {
    const firstWidth = bounds.width * ratio;
    partition(first, { ...bounds, width: firstWidth }, output);
    partition(second, { ...bounds, x: bounds.x + firstWidth, width: bounds.width - firstWidth }, output);
  } else {
    const firstHeight = bounds.height * ratio;
    partition(first, { ...bounds, height: firstHeight }, output);
    partition(second, { ...bounds, y: bounds.y + firstHeight, height: bounds.height - firstHeight }, output);
  }
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
