import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { dibbsArchiveDays, dibbsDataDir } from "../src/server/config.js";
import { DibbsClient } from "../src/server/dibbs-client.js";
import { parseArchiveListings, type DibbsArchiveListing } from "../src/server/dibbs-formats.js";
import { hasCompleteArchive, ingestArchive } from "../src/server/ingest.js";

const execFileAsync = promisify(execFile);
const recentUrl = "https://www.dibbs.bsm.dla.mil/RFQ/RFQDates.aspx?category=recent";
const args = process.argv.slice(2);
const requestedDate = valueAfter("--date");
const sinceDate = valueAfter("--since");
const limit = positiveInteger(valueAfter("--limit") ?? String(dibbsArchiveDays), "--limit");
const concurrency = positiveInteger(valueAfter("--concurrency") ?? "3", "--concurrency");
const force = args.includes("--force");

if (requestedDate && sinceDate) throw new Error("Choose either --date or --since");
if (concurrency > 6) throw new Error("--concurrency must be between 1 and 6");

console.log("Stage 1 / 3: loading the small index/batch files so rows appear immediately");
await stageManifests();

const client = new DibbsClient();
const listings = parseArchiveListings(await client.getText(recentUrl));
const selected = selectListings(listings);
const pending = selected.filter((listing) => force || !hasCompleteArchive(listing.date));

if (selected.length === 0) throw new Error("No matching published DIBBS archives were found");
if (pending.length === 0) {
  console.log("All selected archives are already fully imported");
  process.exit(0);
}

console.log(
  `Stage 2 / 3: downloading ${pending.length} PDF archives with ${concurrency} parallel terminal transfers`,
);
console.log("Stage 3 / 3: each completed archive is queued immediately for sequential SQLite ingestion");
let ingestQueue = Promise.resolve();
let ingested = 0;
let nextDownload = 0;
const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
  while (nextDownload < pending.length) {
    const listing = pending[nextDownload++];
    const download = await downloadArchive(listing);
    ingestQueue = ingestQueue.then(() => ingestDownload(download));
  }
});
await Promise.all(workers);
await ingestQueue;

async function ingestDownload(download: Awaited<ReturnType<typeof downloadArchive>>) {
  ingested += 1;
  console.log(`[${ingested}/${pending.length}] ingesting ${download.listing.date}`);
  const result = await ingestArchive({
    archivePath: download.archivePath,
    archiveDate: download.listing.date,
    sourceUrl: download.listing.archiveUrl,
    indexPath: download.indexPath,
    batchPath: download.batchPath,
    onProgress: (progress) => {
      if (progress.current % 250 === 0 || progress.current === progress.total) {
        console.log(`  ${progress.message}`);
      }
    },
  });
  console.log(
    `  imported ${result.imported.toLocaleString()} RFQs${result.failures ? `; ${result.failures} PDF failures used manifest fallbacks` : ""}`,
  );
}

console.log("Demo data bootstrap complete");

async function downloadArchive(listing: DibbsArchiveListing) {
  const directory = path.join(dibbsDataDir, "archives", listing.date);
  fs.mkdirSync(directory, { recursive: true });
  const archivePath = path.join(directory, path.basename(new URL(listing.archiveUrl).pathname));
  const partialPath = `${archivePath}.part`;
  const indexPath = path.join(directory, path.basename(new URL(listing.indexUrl).pathname));
  const batchPath = path.join(directory, path.basename(new URL(listing.batchUrl).pathname));

  if (force) {
    fs.rmSync(archivePath, { force: true });
    fs.rmSync(partialPath, { force: true });
  }
  if (fs.existsSync(archivePath) && await isValidZip(archivePath)) {
    console.log(`${listing.date}: archive already downloaded`);
    return { listing, archivePath, indexPath, batchPath };
  }
  if (fs.existsSync(archivePath)) {
    fs.renameSync(archivePath, `${archivePath}.invalid-${Date.now()}`);
  }

  const authorization = await client.authorizeFileDownload(listing.archiveUrl);
  const cookiePath = path.join(directory, `.curl-${process.pid}-${listing.date}.cookies`);
  console.log(`${listing.date}: downloading ${path.basename(archivePath)}${fs.existsSync(partialPath) ? " (resuming)" : ""}`);
  try {
    await execFileAsync("curl", [
      "--fail",
      "--location",
      "--show-error",
      "--silent",
      "--retry", "8",
      "--retry-all-errors",
      "--retry-delay", "1",
      "--connect-timeout", "30",
      "--continue-at", "-",
      "--user-agent", authorization.userAgent,
      "--cookie", authorization.cookie,
      "--cookie-jar", cookiePath,
      "--output", partialPath,
      listing.archiveUrl,
    ], { maxBuffer: 2 * 1024 * 1024 });
    if (!await isValidZip(partialPath)) {
      throw new Error(`${path.basename(partialPath)} is not a valid ZIP; the partial file was retained`);
    }
    fs.renameSync(partialPath, archivePath);
    console.log(`${listing.date}: downloaded ${formatBytes(fs.statSync(archivePath).size)}`);
    return { listing, archivePath, indexPath, batchPath };
  } finally {
    fs.rmSync(cookiePath, { force: true });
  }
}

function selectListings(listings: DibbsArchiveListing[]) {
  if (requestedDate) return listings.filter((listing) => listing.date === requestedDate);
  if (sinceDate) return listings.filter((listing) => listing.date >= sinceDate);
  return listings.slice(0, limit);
}

function stageManifests() {
  const forwarded: string[] = [];
  if (requestedDate) forwarded.push("--date", requestedDate);
  else if (sinceDate) forwarded.push("--since", sinceDate);
  else forwarded.push("--limit", String(limit));
  return new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["run", "sync:manifests", "--", ...forwarded], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Manifest staging stopped with ${signal ?? `exit code ${code}`}`));
    });
  });
}

async function isValidZip(filePath: string) {
  try {
    await execFileAsync("unzip", ["-tqq", filePath], { maxBuffer: 2 * 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function valueAfter(flag: string) {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

function positiveInteger(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function formatBytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
