import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dibbsArchiveDays, dibbsDataDir } from "../src/server/config.js";
import { db } from "../src/server/db.js";
import { DibbsClient } from "../src/server/dibbs-client.js";
import {
  enrichManifestFromBatch,
  parseArchiveListings,
  parseIndexFile,
} from "../src/server/dibbs-formats.js";
import { saveLiveRecords, type StoredRfq } from "../src/server/ingest.js";

const execFileAsync = promisify(execFile);
const recentUrl = "https://www.dibbs.bsm.dla.mil/RFQ/RFQDates.aspx?category=recent";
const dateIndex = process.argv.indexOf("--date");
const sinceIndex = process.argv.indexOf("--since");
const limitIndex = process.argv.indexOf("--limit");
const requestedDate = dateIndex >= 0 ? process.argv[dateIndex + 1] : undefined;
const sinceDate = sinceIndex >= 0 ? process.argv[sinceIndex + 1] : undefined;
const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : dibbsArchiveDays;
if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
const client = new DibbsClient();
const listings = parseArchiveListings(await client.getText(recentUrl));
const selected = requestedDate
  ? listings.filter((listing) => listing.date === requestedDate)
  : sinceDate
    ? listings.filter((listing) => listing.date >= sinceDate)
  : listings.slice(0, limit);
let stagedCount = 0;
const stagedDates: string[] = [];

if (selected.length === 0) throw new Error(`No published DIBBS archive found${requestedDate ? ` for ${requestedDate}` : ""}`);

for (const listing of [...selected].reverse()) {
  const existing = db.prepare(
    "SELECT source_kind AS sourceKind, status FROM imports WHERE archive_date = ?",
  ).get(listing.date) as { sourceKind: string; status: string } | undefined;
  if (existing?.sourceKind === "archive" && existing.status === "complete") {
    console.log(`${listing.date}: full archive already imported; skipping manifest stage`);
    continue;
  }

  const directory = path.join(dibbsDataDir, "archives", listing.date);
  fs.mkdirSync(directory, { recursive: true });
  const archivePath = path.join(directory, path.basename(new URL(listing.archiveUrl).pathname));
  const indexPath = path.join(directory, path.basename(new URL(listing.indexUrl).pathname));
  const batchPath = path.join(directory, path.basename(new URL(listing.batchUrl).pathname));
  await Promise.all([
    client.download(listing.indexUrl, indexPath),
    client.download(listing.batchUrl, batchPath),
  ]);

  const manifests = parseIndexFile(fs.readFileSync(indexPath, "latin1"));
  await enrichFromBatch(manifests, batchPath);
  const records: StoredRfq[] = manifests.map((manifest) => ({
    ...manifest,
    archiveEntry: manifest.filename,
    fileSize: 0,
    documentPath: archivePath,
  }));
  saveLiveRecords({
    archiveDate: listing.date,
    sourcePath: directory,
    sourceUrl: listing.archiveUrl,
    records,
  });
  db.prepare(
    `UPDATE imports
     SET source_kind = 'archive-manifest', source_name = ?, source_path = ?,
         index_path = ?, batch_path = ?, last_checked_at = CURRENT_TIMESTAMP
     WHERE archive_date = ?`,
  ).run(`DIBBS manifest ${listing.date}`, archivePath, indexPath, batchPath, listing.date);
  stagedCount += records.length;
  stagedDates.push(listing.date);
  console.log(`${listing.date}: staged ${records.length.toLocaleString()} RFQs from index/batch metadata`);
}

if (stagedCount > 0) {
  db.prepare(
    `INSERT INTO sync_runs (
       sync_type, target_date, status, discovered_count, imported_count, completed_at
     ) VALUES ('archive-manifest', ?, 'complete', ?, ?, CURRENT_TIMESTAMP)`,
  ).run(stagedDates.sort().at(-1) ?? null, stagedCount, stagedCount);
}

async function enrichFromBatch(
  manifests: ReturnType<typeof parseIndexFile>,
  batchPath: string,
) {
  const { stdout: names } = await execFileAsync("unzip", ["-Z1", batchPath]);
  const entries = names.trim().split(/\r?\n/);
  const batchEntry = entries.find((entry) => /(?:^|\/)bq\d{6}\.txt$/i.test(entry));
  const sourcesEntry = entries.find((entry) => /(?:^|\/)as\d{6}\.txt$/i.test(entry));
  if (!batchEntry || !sourcesEntry) return;
  const [{ stdout: batchText }, { stdout: sourceText }] = await Promise.all([
    execFileAsync("unzip", ["-p", batchPath, batchEntry], { encoding: "latin1", maxBuffer: 50 * 1024 * 1024 }),
    execFileAsync("unzip", ["-p", batchPath, sourcesEntry], { encoding: "latin1", maxBuffer: 50 * 1024 * 1024 }),
  ]);
  enrichManifestFromBatch(manifests, batchText, sourceText);
}
