import { syncPublishedArchives, syncToday } from "./dibbs-sync.js";
import { dibbsArchiveDays } from "./config.js";

const args = process.argv.slice(2);
const todayOnly = args.includes("--today-only");
const archivesOnly = args.includes("--archives-only");
const force = args.includes("--force");
const date = valueAfter("--date");
const maxNewValue = valueAfter("--max-new");
const limitValue = valueAfter("--limit");

if (todayOnly && archivesOnly) throw new Error("Choose either --today-only or --archives-only");

if (!todayOnly) {
  const result = await syncPublishedArchives({
    force,
    limit: limitValue ? positiveInteger(limitValue, "--limit") : dibbsArchiveDays,
  });
  console.log("Archive sync complete", result);
}

if (!archivesOnly) {
  const result = await syncToday({
    date,
    maxNew: maxNewValue ? positiveInteger(maxNewValue, "--max-new") : undefined,
  });
  console.log("Live sync complete", result);
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
