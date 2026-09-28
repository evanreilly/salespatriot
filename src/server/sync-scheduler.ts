import {
  dibbsArchiveIntervalMinutes,
  dibbsSyncEnabled,
  dibbsTodayIntervalMinutes,
} from "./config.js";
import { syncPublishedArchives, syncToday } from "./dibbs-sync.js";
import { runSyncExclusive } from "./sync-lock.js";

export function startDibbsScheduler() {
  if (!dibbsSyncEnabled) {
    console.log("DIBBS sync scheduler disabled (DIBBS_SYNC_ENABLED=false)");
    return;
  }

  console.log(
    `DIBBS sync scheduler active: live every ${dibbsTodayIntervalMinutes}m, archives every ${dibbsArchiveIntervalMinutes}m`,
  );
  void runStartupCycle();

  const liveTimer = setInterval(runLive, minutes(dibbsTodayIntervalMinutes));
  const archiveTimer = setInterval(runArchives, minutes(dibbsArchiveIntervalMinutes));
  liveTimer.unref();
  archiveTimer.unref();
}

async function runLive() {
  await runSyncExclusive("Scheduled current-day sync", async (report) => {
    const result = await syncToday({ onProgress: report });
    console.log(
      `DIBBS live sync: ${result.imported} new, ${result.skipped} known, ${result.failures} failed`,
    );
  }).catch((error) => {
    console.error("DIBBS live sync failed:", error);
  });
}

async function runArchives() {
  await runSyncExclusive("Scheduled archive check", async (report) => {
    const result = await syncPublishedArchives({ limit: 1, onProgress: report });
    console.log(
      `DIBBS archive sync: ${result.imported} RFQs imported, ${result.skipped} days current, ${result.failures} failed`,
    );
  }).catch((error) => {
    console.error("DIBBS archive discovery failed:", error);
  });
}

async function runStartupCycle() {
  await runArchives();
  await runLive();
}

function minutes(value: number) {
  return Math.max(1, Number.isFinite(value) ? value : 1) * 60_000;
}
