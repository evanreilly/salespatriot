import path from "node:path";

export type ParsedRfq = {
  solicitationNumber: string;
  title: string;
  nsn: string | null;
  purchaseRequest: string | null;
  quantity: number | null;
  unit: string | null;
  issuedDate: string | null;
  closeDate: string | null;
  buyerName: string | null;
  buyerCode: string | null;
  buyerEmail: string | null;
  agency: string | null;
  supplyChain: string | null;
  naics: string | null;
  deliveryDays: number | null;
  estimatedUnitPrice: number | null;
  estimatedValue: number | null;
  approvedParts: ParsedApprovedPart[];
};

export type ParsedApprovedPart = {
  cageCode: string;
  partNumber: string;
  manufacturer: string;
  sourceText: string;
};

const months: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

export function parseRfqText(text: string, filename: string): ParsedRfq {
  const clean = text.replace(/\r/g, "");
  const dates = [...clean.matchAll(/\b(20\d{2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{1,2})\b/g)].map(
    (match) => `${match[1]}-${months[match[2]]}-${match[3].padStart(2, "0")}`,
  );
  const buyer = clean.match(/Name:\s*(.+?)\s+Buyer Code:\s*([^\s]+)/i);
  const aviationBuyer = clean.match(/Buyer:\s*(.+?)\s+([A-Z]{2,}\d{3,})\s+Tel:/i);
  const issuedByLines = extractIssuedByLines(clean);
  const sectionBIndex = clean.search(/\bSECTION B\b/i);
  const itemSection = sectionBIndex >= 0 ? clean.slice(sectionBIndex) : clean;
  const itemDescription = itemSection.match(/ITEM DESCRIPTION\s*:?\s*([^\n]+)/i)?.[1]?.trim();
  const tLineItem = clean.match(/^\s*0001\s+\d+\s+\w+\s+([A-Z]{2})\s+([\d,.]+)/m);
  const qLineItem = clean.match(/^\s*0001\s+[\d-]+\s+([\d,.]+)\s+([A-Z]{2})\s+/m);
  const quantity = tLineItem
    ? Number(tLineItem[2].replace(/,/g, ""))
    : qLineItem
      ? Number(qLineItem[1].replace(/,/g, ""))
      : null;
  const estimatedUnitPrice = extractLatestUnitPrice(clean);

  return {
    solicitationNumber:
      clean.match(/\b[A-Z0-9]{6}-\d{2}-[A-Z]-[A-Z0-9]{4}\b/)?.[0] ??
      solicitationFromFilename(filename),
    title: itemDescription || "Untitled RFQ",
    nsn:
      matchValue(clean, /NSN\/MATERIAL:\s*([A-Z0-9-]+)/i) ??
      matchValue(clean, /SUPPLIES\/SERVICES:\s*([\d-]{13,})/i),
    purchaseRequest:
      matchValue(clean, /\bPR:\s*([A-Z0-9-]+)/i) ??
      matchValue(clean, /20\d{2}\s+[A-Z]{3}\s+\d{1,2}[ \t]+([A-Z0-9]{8,})/i),
    quantity,
    unit: tLineItem?.[1] ?? qLineItem?.[2] ?? null,
    issuedDate: dates[0] ?? null,
    closeDate: dates[1] ?? null,
    buyerName: buyer?.[1]?.trim() ?? aviationBuyer?.[1]?.trim() ?? null,
    buyerCode: buyer?.[2]?.trim() ?? aviationBuyer?.[2]?.trim() ?? null,
    buyerEmail: matchValue(clean, /Email:\s*([^\s]+)/i),
    agency: issuedByLines[0] ?? null,
    supplyChain: issuedByLines[1] ?? null,
    naics: matchValue(clean, /NORTH AMERICAN INDUSTRY CLASSIFICATION SYSTEM\s+(\d{6})/i),
    deliveryDays:
      numberValue(clean, /DELIVERY \(IN DAYS\):\s*0*(\d+)/i) ??
      numberValue(clean, /\b(\d+)\s+DAYS ADO\b/i),
    estimatedUnitPrice,
    estimatedValue:
      estimatedUnitPrice !== null && quantity !== null ? estimatedUnitPrice * quantity : null,
    approvedParts: extractApprovedParts(itemSection),
  };
}

export function extractLatestUnitPrice(text: string): number | null {
  const history: { price: number; awarded: string }[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(
      /^\s*[A-Z0-9]{5}\s+\S+\s+[\d,.]+\s+([\d,.]+)\s+(\d{8}|\d{2}\/\d{2}\/\d{4})\s+[A-Z]\s*$/i,
    );
    if (!match) continue;
    const price = Number(match[1].replace(/,/g, ""));
    const awarded = normalizeHistoryDate(match[2]);
    if (Number.isFinite(price)) history.push({ price, awarded });
  }
  history.sort((left, right) => right.awarded.localeCompare(left.awarded));
  return history[0]?.price ?? null;
}

export function extractApprovedParts(sectionText: string): ParsedApprovedPart[] {
  const sectionEnd = sectionText.search(/\n\s*SECTION [C-Z]\b/i);
  const sectionB = sectionEnd >= 0 ? sectionText.slice(0, sectionEnd) : sectionText;
  const parts: ParsedApprovedPart[] = [];
  const seen = new Set<string>();

  for (const rawLine of sectionB.split("\n")) {
    const sourceText = rawLine.trim().replace(/\s+/g, " ");
    const match = sourceText.match(/^(.+?)\s+([A-Z0-9]{5})\s+P\/N\s+(.+)$/i);
    if (!match) continue;

    const manufacturer = match[1].trim();
    const cageCode = match[2].toUpperCase();
    const partNumber = match[3].trim();
    const key = `${cageCode}\u0000${partNumber.toUpperCase()}`;
    if (seen.has(key)) continue;

    seen.add(key);
    parts.push({ cageCode, partNumber, manufacturer, sourceText });
  }

  return parts;
}

export function archiveDateFromFilename(archivePath: string): string {
  const filename = path.basename(archivePath);
  const match = filename.match(/(?:^|\D)(\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (!match) {
    throw new Error(`Could not infer archive date from ${filename}; expected a name like CA260927.ZIP`);
  }
  return `20${match[1]}-${match[2]}-${match[3]}`;
}

export function solicitationFromFilename(filename: string): string {
  const stem = path.basename(filename, path.extname(filename)).toUpperCase();
  const match = stem.match(/^([A-Z0-9]{6})(\d{2})([A-Z])([A-Z0-9]{4})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}-${match[4]}` : stem;
}

function extractIssuedByLines(text: string): string[] {
  const lines = text.split("\n");
  const marker = lines.findIndex((line) => /5\. ISSUED BY/.test(line));
  if (marker < 0) return [];

  return lines
    .slice(marker + 1, marker + 5)
    .map((line) => line.trim().split(/\s{2,}/)[0].trim())
    .filter((line) => line.length > 2 && !/^\d+\./.test(line));
}

function matchValue(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function numberValue(text: string, pattern: RegExp): number | null {
  const value = matchValue(text, pattern);
  return value === null ? null : Number(value);
}

function normalizeHistoryDate(value: string): string {
  if (/^\d{8}$/.test(value)) return value;
  const [month, day, year] = value.split("/");
  return `${year}${month}${day}`;
}
