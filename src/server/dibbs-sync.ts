import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";
import { dibbsDataDir, dibbsPageConcurrency, dibbsTimeZone } from "./config.js";
import { DibbsClient, hiddenFormFields } from "./dibbs-client.js";
import {
  hasNextResultsPage,
  parseArchiveListings,
  parseLiveListings,
  parseResultCount,
  type DibbsArchiveListing,
  type DibbsLiveListing,
} from "./dibbs-formats.js";
import {
  concurrentMap,
  createLivePlaceholder,
  existingArchiveSource,
  existingDownloadedSolicitations,
  existingSolicitations,
  hasCompleteArchive,
  ingestArchive,
  ingestLivePdf,
  saveLiveRecords,
  touchLiveImport,
} from "./ingest.js";
import type { SyncProgressUpdate } from "./sync-lock.js";

const recentUrl = "https://www.dibbs.bsm.dla.mil/RFQ/RFQDates.aspx?category=recent";

export type SyncSummary = {
  discovered: number;
  imported: number;
  skipped: number;
  failures: number;
};

export async function syncPublishedArchives(options: {
  limit?: number;
  date?: string;
  force?: boolean;
  client?: DibbsClient;
  onProgress?: (update: SyncProgressUpdate) => void;
} = {}): Promise<SyncSummary> {
  const client = options.client ?? new DibbsClient();
  const listings = parseArchiveListings(await client.getText(recentUrl));
  const candidates = options.date
    ? listings.filter((listing) => listing.date === options.date)
    : listings;
  const selected = candidates.slice(0, options.limit ?? 1);
  const summary: SyncSummary = { discovered: selected.length, imported: 0, skipped: 0, failures: 0 };

  const chronological = [...selected].reverse();
  for (const [index, listing] of chronological.entries()) {
    options.onProgress?.({
      phase: "archive-day",
      current: index,
      total: chronological.length,
      message: `Checking archive ${index + 1} / ${chronological.length}: ${listing.date}`,
    });
    if (!options.force && hasCompleteArchive(listing.date)) {
      summary.skipped += 1;
      continue;
    }
    const runId = startSyncRun("archive", listing.date);
    try {
      const result = await syncArchiveListing(
        client,
        listing,
        options.force ?? false,
        options.onProgress,
        index + 1,
        chronological.length,
      );
      summary.imported += result.imported;
      summary.failures += result.failures;
      finishSyncRun(runId, result.failures ? "partial" : "complete", result.imported, result.failures);
    } catch (error) {
      summary.failures += 1;
      finishSyncRun(runId, "failed", 0, 1, errorMessage(error));
      console.error(`Archive sync failed for ${listing.date}:`, error);
    }
  }
  options.onProgress?.({
    phase: "archive-day",
    current: chronological.length,
    total: chronological.length || 1,
    message: `Completed ${chronological.length} archive checks`,
  });
  return summary;
}

export async function syncToday(options: {
  date?: string;
  maxNew?: number;
  force?: boolean;
  client?: DibbsClient;
  onProgress?: (update: SyncProgressUpdate) => void;
} = {}): Promise<SyncSummary> {
  const client = options.client ?? new DibbsClient();
  const date = options.date ?? currentDibbsDate();
  const sourceUrl = liveResultsUrl(date);
  const liveDir = path.join(dibbsDataDir, "live", date);
  fs.mkdirSync(liveDir, { recursive: true });
  const runId = startSyncRun("live", date);
  try {
    const stageListings = (page: DibbsLiveListing[]) => {
      const known = existingSolicitations(page.map((listing) => listing.solicitationNumber));
      const fresh = page.filter((listing) => !known.has(listing.solicitationNumber));
      if (fresh.length) {
        saveLiveRecords({
          archiveDate: date,
          sourcePath: liveDir,
          sourceUrl,
          records: fresh.map(createLivePlaceholder),
        });
      }
    };
    const listings = await scrapeDatedListings(client, date, options.onProgress, stageListings);
    const existing = existingDownloadedSolicitations(
      listings.map((listing) => listing.solicitationNumber),
    );
    const unseen = options.force
      ? listings
      : listings.filter((listing) => !existing.has(listing.solicitationNumber));
    const selected = options.maxNew === undefined ? unseen : unseen.slice(0, options.maxNew);
    let failures = 0;
    let completed = 0;
    let imported = 0;
    const batchSize = 20;

    for (let offset = 0; offset < selected.length; offset += batchSize) {
      const batch = selected.slice(offset, offset + batchSize);
      const records = await concurrentMap(batch, 4, async (listing) => {
        const filename = safeRemoteFilename(listing.pdfUrl, listing.solicitationNumber);
        const pdfPath = path.join(liveDir, filename);
        try {
          await client.download(listing.pdfUrl, pdfPath, options.force);
          return await ingestLivePdf({ pdfPath, fallback: listing });
        } catch (error) {
          failures += 1;
          console.warn(`Could not ingest ${listing.solicitationNumber}: ${errorMessage(error)}`);
          return null;
        } finally {
          completed += 1;
          options.onProgress?.({
            phase: "live-download",
            current: completed,
            total: selected.length || 1,
            message: `Downloading new RFQs: ${completed.toLocaleString()} / ${selected.length.toLocaleString()}`,
          });
          if (completed % 50 === 0 || completed === selected.length) {
            console.log(`Ingested ${completed.toLocaleString()} / ${selected.length.toLocaleString()} new live PDFs`);
          }
        }
      });
      const usableRecords = records.filter((record) => record !== null);
      if (usableRecords.length) {
        saveLiveRecords({ archiveDate: date, sourcePath: liveDir, sourceUrl, records: usableRecords });
        imported += usableRecords.length;
      }
    }
    if (imported === 0) {
      touchLiveImport(date, liveDir, sourceUrl);
    }
    const summary: SyncSummary = {
      discovered: listings.length,
      imported,
      skipped: listings.length - unseen.length,
      failures,
    };
    finishSyncRun(runId, failures ? "partial" : "complete", imported, failures, undefined, listings.length);
    return summary;
  } catch (error) {
    finishSyncRun(runId, "failed", 0, 1, errorMessage(error));
    throw error;
  }
}

export async function scrapeDatedListings(
  client: DibbsClient,
  date: string,
  onProgress?: (update: SyncProgressUpdate) => void,
  onListings?: (listings: DibbsLiveListing[]) => void,
) {
  const url = liveResultsUrl(date);
  const html = await client.getText(url);
  const listings = new Map<string, DibbsLiveListing>();
  const firstPage = parseLiveListings(html);
  onListings?.(firstPage);
  for (const listing of firstPage) listings.set(listing.solicitationNumber, listing);
  const recordCount = parseResultCount(html);
  const pageCount = recordCount && firstPage.length
    ? Math.min(100, Math.ceil(recordCount / firstPage.length))
    : hasNextResultsPage(html, 1) ? 100 : 1;
  const hidden = hiddenFormFields(html);
  const pages = Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2);
  let completedPages = 1;
  onProgress?.({ phase: "live-scan", current: 1, total: pageCount, message: `Scanning today's DIBBS listings: 1 / ${pageCount} pages` });
  const pageConcurrency = Math.max(1, Math.min(12, dibbsPageConcurrency));
  const results = await concurrentMap(pages, pageConcurrency, async (page) => {
    const form = new URLSearchParams(hidden);
    form.set("__EVENTTARGET", "ctl00$cph1$grdRfqSearch");
    form.set("__EVENTARGUMENT", `Page$${page}`);
    const pageHtml = await client.postForm(url, form);
    completedPages += 1;
    onProgress?.({
      phase: "live-scan",
      current: completedPages,
      total: pageCount,
      message: `Scanning today's DIBBS listings: ${completedPages} / ${pageCount} pages`,
    });
    if (page % 10 === 0 || page === pageCount) {
      console.log(`Scanned DIBBS result page ${page} / ${pageCount}`);
    }
    const pageListings = parseLiveListings(pageHtml);
    onListings?.(pageListings);
    return pageListings;
  });
  for (const page of results) {
    for (const listing of page) listings.set(listing.solicitationNumber, listing);
  }
  return [...listings.values()];
}

async function syncArchiveListing(
  client: DibbsClient,
  listing: DibbsArchiveListing,
  force: boolean,
  onProgress?: (update: SyncProgressUpdate) => void,
  dayNumber = 1,
  dayTotal = 1,
) {
  const directory = path.join(dibbsDataDir, "archives", listing.date);
  fs.mkdirSync(directory, { recursive: true });
  const archivePath =
    (!force && existingArchiveSource(listing.date)) || path.join(directory, path.basename(new URL(listing.archiveUrl).pathname));
  const indexPath = path.join(directory, path.basename(new URL(listing.indexUrl).pathname));
  const batchPath = path.join(directory, path.basename(new URL(listing.batchUrl).pathname));
  if (!fs.existsSync(archivePath) || force) {
    await client.download(listing.archiveUrl, archivePath, force, (received, total) => {
      onProgress?.({
        phase: "archive-download",
        current: received,
        total: total || Math.max(received, 1),
        message: `Day ${dayNumber} / ${dayTotal}: downloading ${listing.date} (${formatBytes(received)}${total ? ` / ${formatBytes(total)}` : ""})`,
      });
    });
  }
  await Promise.all([
    client.download(listing.indexUrl, indexPath, force),
    client.download(listing.batchUrl, batchPath, force),
  ]);
  const result = await ingestArchive({
    archivePath,
    archiveDate: listing.date,
    sourceUrl: listing.archiveUrl,
    indexPath,
    batchPath,
    onProgress,
  });
  fs.rmSync(path.join(dibbsDataDir, "live", listing.date), { recursive: true, force: true });
  return result;
}

function startSyncRun(syncType: string, targetDate: string) {
  const result = db
    .prepare("INSERT INTO sync_runs (sync_type, target_date, status) VALUES (?, ?, 'running')")
    .run(syncType, targetDate);
  return Number(result.lastInsertRowid);
}

function finishSyncRun(
  id: number,
  status: "complete" | "partial" | "failed",
  imported: number,
  failures: number,
  error?: string,
  discovered = imported + failures,
) {
  db.prepare(
    `UPDATE sync_runs
     SET status = ?, discovered_count = ?, imported_count = ?, error = ?, completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(status, discovered, imported, error ?? (failures ? `${failures} records failed` : null), id);
}

function liveResultsUrl(date: string) {
  const [year, month, day] = date.split("-");
  return `https://www.dibbs.bsm.dla.mil/RFQ/RfqRecs.aspx?category=post&TypeSrch=dt&Value=${month}-${day}-${year}`;
}

function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function currentDibbsDate() {
  return dateInTimeZone(new Date(), dibbsTimeZone);
}

function safeRemoteFilename(url: string, solicitationNumber: string) {
  const filename = path.basename(new URL(url).pathname);
  return /^[a-zA-Z0-9._-]+$/.test(filename) ? filename : `${solicitationNumber.replaceAll("-", "")}.PDF`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
