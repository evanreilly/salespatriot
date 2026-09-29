import type { Row } from "fast-grid";
import type { Rfq } from "../shared/rfq";

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const cellValueCache = new WeakMap<Rfq, (string | number)[]>();
const rowCache = new WeakMap<Rfq[], Row[]>();

export function rfqCellValues(rfq: Rfq) {
  const cached = cellValueCache.get(rfq);
  if (cached) return cached;
  const values = [
    rfq.solicitationNumber,
    rfq.title,
    rfq.nsn ?? "—",
    rfq.quantity ?? "—",
    rfq.unit ?? "—",
    formatShortDate(rfq.closeDate),
    rfq.buyerName ?? "—",
    rfq.supplyChain ?? rfq.agency ?? "—",
    rfq.naics ?? "—",
    rfq.deliveryDays ?? "—",
  ];
  cellValueCache.set(rfq, values);
  return values;
}

export function gridRows(rfqs: Rfq[]) {
  const cached = rowCache.get(rfqs);
  if (cached) return cached;
  const rows: Row[] = rfqs.map((rfq, id) => ({
    id,
    cells: rfqCellValues(rfq).map((value, cellId) => ({ id: cellId, v: value })),
  }));
  rowCache.set(rfqs, rows);
  return rows;
}

function formatShortDate(value: string | null) {
  if (!value) return "—";
  return shortDateFormatter.format(new Date(`${value}T12:00:00`));
}
