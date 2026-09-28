import path from "node:path";

export const projectRoot = path.resolve(process.env.PROJECT_ROOT ?? process.cwd());
export const dataDir = process.env.DATA_DIR ?? path.join(projectRoot, "data");
export const databasePath =
  process.env.DATABASE_PATH ?? path.join(dataDir, "salespatriot.sqlite");
export const port = Number(process.env.PORT ?? 3001);
export const dibbsDataDir = process.env.DIBBS_DATA_DIR ?? path.join(dataDir, "dibbs");
export const dibbsSyncEnabled = process.env.DIBBS_SYNC_ENABLED !== "false";
export const dibbsTodayIntervalMinutes = Number(process.env.DIBBS_TODAY_INTERVAL_MINUTES ?? 15);
export const dibbsArchiveIntervalMinutes = Number(process.env.DIBBS_ARCHIVE_INTERVAL_MINUTES ?? 360);
export const dibbsArchiveDays = Number(process.env.DIBBS_ARCHIVE_DAYS ?? 7);
export const dibbsTimeZone = process.env.DIBBS_TIME_ZONE ?? "America/New_York";
