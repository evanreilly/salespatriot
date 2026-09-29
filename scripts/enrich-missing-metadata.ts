import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "../src/server/db.js";
import { concurrentMap, parsePdf } from "../src/server/ingest.js";

const execFileAsync = promisify(execFile);

type Candidate = {
  id: number;
  archivePath: string;
  archiveEntry: string;
  buyerName: string | null;
  supplyChain: string | null;
  naics: string | null;
};

const candidates = db.prepare(
  `SELECT id, archive_path AS archivePath, archive_entry AS archiveEntry,
          buyer_name AS buyerName, supply_chain AS supplyChain, naics
   FROM rfqs
   WHERE file_size > 0
     AND archive_path NOT LIKE 'http%'
     AND (buyer_name IS NULL OR supply_chain IS NULL OR naics IS NULL)
   ORDER BY archive_path, archive_entry`,
).all() as Candidate[];

const byArchive = new Map<string, Candidate[]>();
for (const candidate of candidates) {
  if (!fs.existsSync(candidate.archivePath) || !candidate.archiveEntry) continue;
  const rows = byArchive.get(candidate.archivePath) ?? [];
  rows.push(candidate);
  byArchive.set(candidate.archivePath, rows);
}

const update = db.prepare(
  `UPDATE rfqs
   SET buyer_name = COALESCE(@buyerName, buyer_name),
       buyer_code = CASE WHEN @buyerName IS NOT NULL THEN @buyerCode ELSE buyer_code END,
       buyer_email = COALESCE(@buyerEmail, buyer_email),
       agency = COALESCE(@agency, agency),
       supply_chain = COALESCE(@supplyChain, supply_chain),
       naics = COALESCE(@naics, naics),
       updated_at = CURRENT_TIMESTAMP
   WHERE id = @id`,
);

let parsedCount = 0;
let updatedCount = 0;
let failureCount = 0;

for (const [archivePath, rows] of byArchive) {
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "salespatriot-enrich-"));
  try {
    await execFileAsync(
      "unzip",
      ["-qq", "-o", archivePath, ...rows.map((row) => row.archiveEntry), "-d", extractDir],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const parsed = await concurrentMap(rows, Math.min(8, os.availableParallelism()), async (row) => {
      const filePath = safeExtractedPath(extractDir, row.archiveEntry);
      try {
        return { row, record: await parsePdf(filePath) };
      } catch (error) {
        failureCount += 1;
        console.warn(`Could not enrich ${row.archiveEntry}: ${errorMessage(error)}`);
        return null;
      }
    });

    const save = db.transaction(() => {
      for (const result of parsed) {
        if (!result) continue;
        parsedCount += 1;
        const { record, row } = result;
        const improvesMetadata =
          (!row.buyerName && record.buyerName) ||
          (!row.supplyChain && record.supplyChain) ||
          (!row.naics && record.naics);
        if (improvesMetadata) {
          update.run({ id: row.id, ...record });
          updatedCount += 1;
        }
      }
    });
    save();
    console.log(`${path.basename(archivePath)}: enriched ${updatedCount.toLocaleString()} cumulative RFQs`);
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

console.log(
  `Metadata enrichment complete: ${updatedCount.toLocaleString()} updated, ` +
    `${parsedCount.toLocaleString()} parsed, ${failureCount.toLocaleString()} failed`,
);

function safeExtractedPath(directory: string, entry: string) {
  const resolved = path.resolve(directory, entry);
  if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) {
    throw new Error(`Unsafe archive entry: ${entry}`);
  }
  return resolved;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
