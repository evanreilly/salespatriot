import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "./db.js";
import { enrichManifestFromBatch, parseIndexFile, type DibbsLiveListing, type ManifestRfq } from "./dibbs-formats.js";
import { parseRfqText, type ParsedRfq } from "./parse-rfq.js";
import type { SyncProgressUpdate } from "./sync-lock.js";

const execFileAsync = promisify(execFile);

export type StoredRfq = ParsedRfq & {
  filename: string;
  archiveEntry: string;
  fileSize: number;
  documentPath: string;
};

export type ImportResult = {
  imported: number;
  failures: number;
};

export async function ingestArchive(options: {
  archivePath: string;
  archiveDate: string;
  sourceUrl?: string;
  indexPath?: string;
  batchPath?: string;
  onProgress?: (update: SyncProgressUpdate) => void;
}): Promise<ImportResult> {
  const archivePath = fs.realpathSync(options.archivePath);
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "salespatriot-import-"));
  try {
    await execFileAsync("unzip", ["-qq", "-o", archivePath, "-d", extractDir], {
      maxBuffer: 10 * 1024 * 1024,
    });
    const pdfFiles = walkPdfFiles(extractDir);
    const manifests = await loadManifest(options.indexPath, options.batchPath);
    const manifestBySolicitation = new Map(manifests.map((record) => [record.solicitationNumber, record]));
    let failures = 0;
    let completed = 0;

    const parsed = await concurrentMap(
      pdfFiles,
      Math.min(8, os.availableParallelism()),
      async (filePath): Promise<StoredRfq | null> => {
        const archiveEntry = path.relative(extractDir, filePath).split(path.sep).join("/");
        try {
          const record = await parsePdf(filePath);
          const manifest = manifestBySolicitation.get(record.solicitationNumber);
          return {
            ...mergeWithManifest(record, manifest),
            filename: path.basename(filePath),
            archiveEntry,
            fileSize: fs.statSync(filePath).size,
            documentPath: archivePath,
          };
        } catch (error) {
          failures += 1;
          console.warn(`Could not parse ${archiveEntry}: ${errorMessage(error)}`);
          return null;
        } finally {
          completed += 1;
          options.onProgress?.({
            phase: "parsing",
            current: completed,
            total: pdfFiles.length,
            message: `Parsing ${options.archiveDate}: ${completed.toLocaleString()} / ${pdfFiles.length.toLocaleString()} PDFs`,
          });
          if (completed % 100 === 0 || completed === pdfFiles.length) {
            console.log(`Parsed ${completed.toLocaleString()} / ${pdfFiles.length.toLocaleString()} PDFs`);
          }
        }
      },
    );

    const records = new Map<string, StoredRfq>();
    for (const record of parsed) {
      if (record) records.set(record.solicitationNumber, record);
    }
    const entriesByFilename = new Map(
      pdfFiles.map((filePath) => [path.basename(filePath).toLowerCase(), filePath]),
    );
    for (const manifest of manifests) {
      if (records.has(manifest.solicitationNumber)) continue;
      const filePath = entriesByFilename.get(manifest.filename.toLowerCase());
      records.set(manifest.solicitationNumber, {
        ...manifest,
        archiveEntry: filePath
          ? path.relative(extractDir, filePath).split(path.sep).join("/")
          : manifest.filename,
        fileSize: filePath ? fs.statSync(filePath).size : 0,
        documentPath: archivePath,
      });
    }

    if (records.size === 0) {
      throw new Error(`No RFQ records were found in ${path.basename(archivePath)}`);
    }

    saveImportRecords({
      archiveDate: options.archiveDate,
      sourcePath: archivePath,
      sourceName: path.basename(archivePath),
      sourceKind: "archive",
      sourceUrl: options.sourceUrl,
      indexPath: options.indexPath,
      batchPath: options.batchPath,
      replace: true,
      records: [...records.values()],
    });
    return { imported: records.size, failures };
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

export async function ingestLivePdf(options: {
  pdfPath: string;
  fallback: Pick<ManifestRfq, "solicitationNumber" | "title" | "nsn">;
}): Promise<StoredRfq> {
  const parsed = await parsePdf(options.pdfPath);
  return {
    ...mergeWithManifest(parsed, {
      ...emptyParsedRfq(options.fallback.solicitationNumber, options.fallback.title),
      nsn: options.fallback.nsn,
      filename: path.basename(options.pdfPath),
    }),
    filename: path.basename(options.pdfPath),
    archiveEntry: "",
    fileSize: fs.statSync(options.pdfPath).size,
    documentPath: fs.realpathSync(options.pdfPath),
  };
}

export function saveLiveRecords(options: {
  archiveDate: string;
  sourcePath: string;
  sourceUrl: string;
  records: StoredRfq[];
}) {
  saveImportRecords({
    archiveDate: options.archiveDate,
    sourcePath: options.sourcePath,
    sourceName: `DIBBS live ${options.archiveDate}`,
    sourceKind: "live",
    sourceUrl: options.sourceUrl,
    replace: false,
    records: options.records,
  });
}

export function touchLiveImport(archiveDate: string, sourcePath: string, sourceUrl: string) {
  db.prepare(
    `INSERT INTO imports (
       archive_date, source_path, source_name, file_count, status,
       imported_at, last_checked_at, source_kind, source_url
     ) VALUES (?, ?, ?, 0, 'complete', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'live', ?)
     ON CONFLICT(archive_date) DO UPDATE SET
       last_checked_at = CURRENT_TIMESTAMP,
       status = 'complete'`,
  ).run(archiveDate, sourcePath, `DIBBS live ${archiveDate}`, sourceUrl);
}

export function hasCompleteArchive(archiveDate: string) {
  const row = db
    .prepare(
      `SELECT source_path, index_path, batch_path
       FROM imports
       WHERE archive_date = ? AND source_kind = 'archive' AND status = 'complete'`,
    )
    .get(archiveDate) as
    | { source_path: string; index_path: string | null; batch_path: string | null }
    | undefined;
  return Boolean(
    row &&
      fs.existsSync(row.source_path) &&
      row.index_path &&
      fs.existsSync(row.index_path) &&
      row.batch_path &&
      fs.existsSync(row.batch_path),
  );
}

export function existingArchiveSource(archiveDate: string) {
  const row = db
    .prepare("SELECT source_path FROM imports WHERE archive_date = ? AND source_kind = 'archive'")
    .get(archiveDate) as { source_path: string } | undefined;
  return row?.source_path && fs.existsSync(row.source_path) ? row.source_path : null;
}

export function existingSolicitations(solicitations: string[]) {
  if (solicitations.length === 0) return new Set<string>();
  const placeholders = solicitations.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT solicitation_number FROM rfqs WHERE solicitation_number IN (${placeholders})`)
    .all(...solicitations) as { solicitation_number: string }[];
  return new Set(rows.map((row) => row.solicitation_number));
}

export function existingDownloadedSolicitations(solicitations: string[]) {
  if (solicitations.length === 0) return new Set<string>();
  const placeholders = solicitations.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT solicitation_number
       FROM rfqs
       WHERE solicitation_number IN (${placeholders})
         AND archive_path <> '' AND archive_path NOT LIKE 'http%'`,
    )
    .all(...solicitations) as { solicitation_number: string }[];
  return new Set(rows.map((row) => row.solicitation_number));
}

export function createLivePlaceholder(listing: DibbsLiveListing): StoredRfq {
  return {
    ...emptyParsedRfq(listing.solicitationNumber, listing.title),
    nsn: listing.nsn,
    filename: path.basename(new URL(listing.pdfUrl).pathname),
    archiveEntry: "",
    fileSize: 0,
    documentPath: listing.pdfUrl,
  };
}

async function loadManifest(indexPath?: string, batchPath?: string) {
  if (!indexPath || !fs.existsSync(indexPath)) return [];
  const manifests = parseIndexFile(fs.readFileSync(indexPath, "latin1"));
  if (!batchPath || !fs.existsSync(batchPath)) return manifests;
  const { stdout: names } = await execFileAsync("unzip", ["-Z1", batchPath]);
  const entries = names.trim().split(/\r?\n/);
  const batchEntry = entries.find((entry) => /(?:^|\/)bq\d{6}\.txt$/i.test(entry));
  const sourcesEntry = entries.find((entry) => /(?:^|\/)as\d{6}\.txt$/i.test(entry));
  if (!batchEntry || !sourcesEntry) return manifests;
  const [{ stdout: batchText }, { stdout: sourceText }] = await Promise.all([
    execFileAsync("unzip", ["-p", batchPath, batchEntry], { encoding: "latin1", maxBuffer: 50 * 1024 * 1024 }),
    execFileAsync("unzip", ["-p", batchPath, sourcesEntry], { encoding: "latin1", maxBuffer: 50 * 1024 * 1024 }),
  ]);
  enrichManifestFromBatch(manifests, batchText, sourceText);
  return manifests;
}

async function parsePdf(filePath: string) {
  const { stdout } = await execFileAsync(
    "pdftotext",
    ["-layout", "-f", "1", "-l", "12", filePath, "-"],
    { maxBuffer: 15 * 1024 * 1024 },
  );
  return parseRfqText(stdout, path.basename(filePath));
}

function mergeWithManifest(parsed: ParsedRfq, manifest?: ManifestRfq): ParsedRfq {
  if (!manifest) return parsed;
  const quantity = parsed.quantity ?? manifest.quantity;
  const estimatedUnitPrice = parsed.estimatedUnitPrice ?? manifest.estimatedUnitPrice;
  return {
    ...parsed,
    title: parsed.title === "Untitled RFQ" ? manifest.title : parsed.title,
    nsn: parsed.nsn ?? manifest.nsn,
    purchaseRequest: parsed.purchaseRequest ?? manifest.purchaseRequest,
    quantity,
    unit: parsed.unit ?? manifest.unit,
    issuedDate: parsed.issuedDate ?? manifest.issuedDate,
    closeDate: parsed.closeDate ?? manifest.closeDate,
    buyerCode: parsed.buyerCode ?? manifest.buyerCode,
    deliveryDays: parsed.deliveryDays ?? manifest.deliveryDays,
    estimatedUnitPrice,
    estimatedValue:
      parsed.estimatedValue ??
      (quantity !== null && estimatedUnitPrice !== null ? quantity * estimatedUnitPrice : null),
    approvedParts: parsed.approvedParts.length ? parsed.approvedParts : manifest.approvedParts,
  };
}

function saveImportRecords(options: {
  archiveDate: string;
  sourcePath: string;
  sourceName: string;
  sourceKind: "archive" | "live";
  sourceUrl?: string;
  indexPath?: string;
  batchPath?: string;
  replace: boolean;
  records: StoredRfq[];
}) {
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO imports (
         archive_date, source_path, source_name, file_count, status,
         imported_at, last_checked_at, source_kind, source_url, index_path, batch_path
       ) VALUES (
         @archiveDate, @sourcePath, @sourceName, 0, 'processing',
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, @sourceKind, @sourceUrl, @indexPath, @batchPath
       )
       ON CONFLICT(archive_date) DO UPDATE SET
         source_path = excluded.source_path,
         source_name = excluded.source_name,
         status = 'processing',
         imported_at = CURRENT_TIMESTAMP,
         last_checked_at = CURRENT_TIMESTAMP,
         source_kind = excluded.source_kind,
         source_url = excluded.source_url,
         index_path = COALESCE(excluded.index_path, imports.index_path),
         batch_path = COALESCE(excluded.batch_path, imports.batch_path)`,
    ).run({
      ...options,
      sourceUrl: options.sourceUrl ?? null,
      indexPath: options.indexPath ?? null,
      batchPath: options.batchPath ?? null,
    });
    const importId = (
      db.prepare("SELECT id FROM imports WHERE archive_date = ?").get(options.archiveDate) as { id: number }
    ).id;
    if (options.replace) db.prepare("DELETE FROM rfqs WHERE import_id = ?").run(importId);

    const upsertRfq = db.prepare(
      `INSERT INTO rfqs (
        import_id, archive_date, solicitation_number, title, nsn,
        purchase_request, quantity, unit, issued_date, close_date,
        buyer_name, buyer_code, buyer_email, agency, supply_chain,
        naics, delivery_days, estimated_unit_price, estimated_value,
        filename, file_size, archive_path, archive_entry
      ) VALUES (
        @importId, @archiveDate, @solicitationNumber, @title, @nsn,
        @purchaseRequest, @quantity, @unit, @issuedDate, @closeDate,
        @buyerName, @buyerCode, @buyerEmail, @agency, @supplyChain,
        @naics, @deliveryDays, @estimatedUnitPrice, @estimatedValue,
        @filename, @fileSize, @documentPath, @archiveEntry
      )
      ON CONFLICT(solicitation_number) DO UPDATE SET
        import_id = excluded.import_id,
        archive_date = excluded.archive_date,
        title = excluded.title,
        nsn = excluded.nsn,
        purchase_request = excluded.purchase_request,
        quantity = excluded.quantity,
        unit = excluded.unit,
        issued_date = excluded.issued_date,
        close_date = excluded.close_date,
        buyer_name = excluded.buyer_name,
        buyer_code = excluded.buyer_code,
        buyer_email = excluded.buyer_email,
        agency = excluded.agency,
        supply_chain = excluded.supply_chain,
        naics = excluded.naics,
        delivery_days = excluded.delivery_days,
        estimated_unit_price = excluded.estimated_unit_price,
        estimated_value = excluded.estimated_value,
        filename = excluded.filename,
        file_size = excluded.file_size,
        archive_path = excluded.archive_path,
        archive_entry = excluded.archive_entry,
        updated_at = CURRENT_TIMESTAMP`,
    );
    const findRfq = db.prepare("SELECT id FROM rfqs WHERE solicitation_number = ?");
    const deleteParts = db.prepare("DELETE FROM approved_parts WHERE rfq_id = ?");
    const insertPart = db.prepare(
      `INSERT INTO approved_parts (rfq_id, cage_code, part_number, manufacturer, source_text)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const record of options.records) {
      upsertRfq.run({ ...record, importId, archiveDate: options.archiveDate });
      const rfqId = (findRfq.get(record.solicitationNumber) as { id: number }).id;
      deleteParts.run(rfqId);
      for (const part of record.approvedParts) {
        insertPart.run(rfqId, part.cageCode, part.partNumber, part.manufacturer, part.sourceText);
      }
    }
    const count = (
      db.prepare("SELECT COUNT(*) AS count FROM rfqs WHERE import_id = ?").get(importId) as { count: number }
    ).count;
    db.prepare(
      `UPDATE imports
       SET file_count = ?, status = 'complete', imported_at = CURRENT_TIMESTAMP,
           last_checked_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(count, importId);
  });
  run();
}

function emptyParsedRfq(solicitationNumber: string, title: string): ParsedRfq {
  return {
    solicitationNumber,
    title,
    nsn: null,
    purchaseRequest: null,
    quantity: null,
    unit: null,
    issuedDate: null,
    closeDate: null,
    buyerName: null,
    buyerCode: null,
    buyerEmail: null,
    agency: null,
    supplyChain: null,
    naics: null,
    deliveryDays: null,
    estimatedUnitPrice: null,
    estimatedValue: null,
    approvedParts: [],
  };
}

function walkPdfFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkPdfFiles(entryPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) files.push(entryPath);
  }
  return files.sort();
}

export async function concurrentMap<T, U>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await callback(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
