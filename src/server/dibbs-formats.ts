import path from "node:path";
import { solicitationFromFilename, type ParsedApprovedPart, type ParsedRfq } from "./parse-rfq.js";

export type DibbsArchiveListing = {
  date: string;
  archiveUrl: string;
  indexUrl: string;
  batchUrl: string;
};

export type DibbsLiveListing = {
  solicitationNumber: string;
  title: string;
  nsn: string | null;
  pdfUrl: string;
};

export type ManifestRfq = ParsedRfq & { filename: string };

export function parseArchiveListings(html: string): DibbsArchiveListing[] {
  const urls = [...html.matchAll(/href=["'](https:\/\/dibbs2\.bsm\.dla\.mil\/Downloads\/RFQ\/Archive\/[^"']+)["']/gi)]
    .map((match) => decodeHtml(match[1]));
  const bySuffix = new Map<string, Partial<DibbsArchiveListing>>();
  for (const url of urls) {
    const match = url.match(/\/(ca|in|bq)(\d{6})\.(zip|txt)$/i);
    if (!match) continue;
    const suffix = match[2];
    const current = bySuffix.get(suffix) ?? { date: dateFromSuffix(suffix) };
    if (match[1].toLowerCase() === "ca") current.archiveUrl = url;
    if (match[1].toLowerCase() === "in") current.indexUrl = url;
    if (match[1].toLowerCase() === "bq") current.batchUrl = url;
    bySuffix.set(suffix, current);
  }
  return [...bySuffix.values()]
    .filter(
      (entry): entry is DibbsArchiveListing =>
        Boolean(entry.date && entry.archiveUrl && entry.indexUrl && entry.batchUrl),
    )
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function parseLiveListings(html: string): DibbsLiveListing[] {
  const listings = new Map<string, DibbsLiveListing>();
  const pdfPattern = /href=["'](https:\/\/dibbs2\.bsm\.dla\.mil\/Downloads\/RFQ\/[^"']+\.PDF)["']/gi;
  for (const match of html.matchAll(pdfPattern)) {
    const pdfUrl = match[1];
    const start = html.lastIndexOf("<tr", match.index);
    const end = html.indexOf("</tr>", match.index);
    const row = html.slice(Math.max(0, start), end < 0 ? match.index + match[0].length : end);
    const filename = path.basename(new URL(decodeHtml(pdfUrl)).pathname);
    const solicitationNumber = solicitationFromFilename(filename);
    const title = spanText(row, /_lblNomenclature\b/i) || "Untitled RFQ";
    const nsnText = spanText(row, /_lblNsn\b/i).replace(/-/g, "");
    listings.set(solicitationNumber, {
      solicitationNumber,
      title,
      nsn: nsnText || null,
      pdfUrl: decodeHtml(pdfUrl),
    });
  }
  return [...listings.values()];
}

export function parseResultCount(html: string) {
  const value = html.match(/Records\s+Found:\s*(?:<[^>]+>\s*)*([\d,]+)/i)?.[1];
  return value ? Number(value.replaceAll(",", "")) : null;
}

export function hasNextResultsPage(html: string, currentPage: number) {
  return new RegExp(`Page\\$${currentPage + 1}(?:&#39;|')`, "i").test(html);
}

export function parseIndexFile(text: string): ManifestRfq[] {
  const records = new Map<string, ManifestRfq>();
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (line.length < 129) continue;
    let offset = 0;
    const take = (length: number) => {
      const value = line.slice(offset, offset + length).trim();
      offset += length;
      return value;
    };
    const rawSolicitation = take(13);
    const nsn = take(46).replace(/-/g, "");
    const purchaseRequest = take(13);
    const closeDate = normalizeShortDate(take(8));
    const filename = take(19);
    const quantity = numericValue(take(7));
    const unit = take(2);
    const title = take(21);
    const buyerCode = take(5);
    if (!rawSolicitation || !filename) continue;
    const solicitationNumber = solicitationFromFilename(`${rawSolicitation}.pdf`);
    if (records.has(solicitationNumber)) continue;
    records.set(solicitationNumber, {
      solicitationNumber,
      title: title || "Untitled RFQ",
      nsn: nsn || null,
      purchaseRequest: purchaseRequest || null,
      quantity,
      unit: unit || null,
      issuedDate: null,
      closeDate,
      buyerName: null,
      buyerCode: buyerCode || null,
      buyerEmail: null,
      agency: null,
      supplyChain: null,
      naics: null,
      deliveryDays: null,
      estimatedUnitPrice: null,
      estimatedValue: null,
      approvedParts: [],
      filename,
    });
  }
  return [...records.values()];
}

export function enrichManifestFromBatch(
  manifests: ManifestRfq[],
  batchText: string,
  approvedSourceText: string,
) {
  const bySolicitation = new Map(manifests.map((record) => [record.solicitationNumber, record]));
  for (const line of batchText.replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    const solicitationNumber = solicitationFromFilename(`${fields[0] ?? ""}.pdf`);
    const record = bySolicitation.get(solicitationNumber);
    if (!record) continue;
    record.closeDate ??= normalizeShortDate(fields[4] ?? "");
    record.purchaseRequest ??= fields[45] || null;
    record.nsn ??= fields[46] || null;
    record.unit ??= fields[47] || null;
    record.quantity ??= numericValue(fields[48] ?? "");
    record.deliveryDays ??= integerValue(fields[50] ?? "");
  }

  const approvedByNsn = parseApprovedSources(approvedSourceText);
  for (const record of manifests) {
    if (record.nsn) record.approvedParts = approvedByNsn.get(record.nsn.replace(/-/g, "")) ?? [];
  }
}

export function parseApprovedSources(text: string) {
  const byNsn = new Map<string, ParsedApprovedPart[]>();
  const seen = new Set<string>();
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    const [rawNsn, cageCode, partNumber, manufacturer] = parseCsvLine(line);
    const nsn = rawNsn?.replace(/-/g, "");
    if (!nsn || !cageCode || !partNumber) continue;
    const key = `${nsn}\u0000${cageCode}\u0000${partNumber.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const part: ParsedApprovedPart = {
      cageCode,
      partNumber,
      manufacturer: manufacturer || "Approved source",
      sourceText: [manufacturer, cageCode, "P/N", partNumber].filter(Boolean).join(" "),
    };
    byNsn.set(nsn, [...(byNsn.get(nsn) ?? []), part]);
  }
  return byNsn;
}

export function parseCsvLine(line: string) {
  const fields: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  fields.push(value);
  return fields;
}

function spanText(row: string, idPattern: RegExp) {
  for (const match of row.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)) {
    const id = match[1].match(/\bid=["']([^"']+)["']/i)?.[1] ?? "";
    if (idPattern.test(id)) return stripTags(match[2]);
  }
  return "";
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"');
}

function dateFromSuffix(suffix: string) {
  return `20${suffix.slice(0, 2)}-${suffix.slice(2, 4)}-${suffix.slice(4, 6)}`;
}

function normalizeShortDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[1]}-${match[2]}`;
}

function numericValue(value: string) {
  const number = Number(value.replace(/,/g, ""));
  return Number.isFinite(number) && value.trim() ? number : null;
}

function integerValue(value: string) {
  const number = numericValue(value);
  return number === null ? null : Math.trunc(number);
}
