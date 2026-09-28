import fs from "node:fs";
import path from "node:path";
import { ingestArchive } from "./ingest.js";
import { archiveDateFromFilename } from "./parse-rfq.js";

const archiveArgument = process.argv[2];
if (!archiveArgument) {
  console.error("Usage: npm run import -- /path/to/CA260927.ZIP [--date YYYY-MM-DD]");
  process.exit(1);
}

const archivePath = fs.realpathSync(archiveArgument);
const dateIndex = process.argv.indexOf("--date");
const archiveDate = dateIndex >= 0 ? process.argv[dateIndex + 1] : archiveDateFromFilename(archivePath);
if (!archiveDate) throw new Error("--date requires a YYYY-MM-DD value");

console.log(`Importing ${path.basename(archivePath)} as ${archiveDate}`);
const result = await ingestArchive({ archivePath, archiveDate });
console.log(
  `Imported ${result.imported.toLocaleString()} RFQs into SQLite${
    result.failures ? ` (${result.failures} PDFs used manifest fallbacks)` : ""
  }`,
);
