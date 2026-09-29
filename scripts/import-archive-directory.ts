import fs from "node:fs";
import path from "node:path";
import { hasCompleteArchive, ingestArchive } from "../src/server/ingest.js";
import { archiveDateFromFilename } from "../src/server/parse-rfq.js";

const args = process.argv.slice(2);
const directoryArgument = args.find((argument) => !argument.startsWith("--"));
const force = args.includes("--force");

if (!directoryArgument) {
  console.error("Usage: npm run import:directory -- /path/to/archives [--force]");
  process.exit(1);
}

const directory = fs.realpathSync(directoryArgument);
if (!fs.statSync(directory).isDirectory()) throw new Error(`${directory} is not a directory`);

const archives = walk(directory)
  .filter((filePath) => /^ca\d{6}\.zip$/i.test(path.basename(filePath)))
  .map((archivePath) => ({ archivePath, archiveDate: archiveDateFromFilename(archivePath) }))
  .filter((item): item is { archivePath: string; archiveDate: string } => Boolean(item.archiveDate))
  .sort((left, right) => left.archiveDate.localeCompare(right.archiveDate));

if (archives.length === 0) throw new Error(`No caYYMMDD.zip archives found under ${directory}`);

let imported = 0;
for (const [index, archive] of archives.entries()) {
  if (!force && hasCompleteArchive(archive.archiveDate)) {
    console.log(`[${index + 1}/${archives.length}] ${archive.archiveDate}: already imported; skipping`);
    continue;
  }

  const suffix = archive.archiveDate.slice(2).replaceAll("-", "");
  const siblings = fs.readdirSync(path.dirname(archive.archivePath));
  const indexName = siblings.find((name) => name.toLowerCase() === `in${suffix}.txt`);
  const batchName = siblings.find((name) => name.toLowerCase() === `bq${suffix}.zip`);
  console.log(`[${index + 1}/${archives.length}] ingesting ${archive.archiveDate}`);
  const result = await ingestArchive({
    archivePath: archive.archivePath,
    archiveDate: archive.archiveDate,
    indexPath: indexName ? path.join(path.dirname(archive.archivePath), indexName) : undefined,
    batchPath: batchName ? path.join(path.dirname(archive.archivePath), batchName) : undefined,
    onProgress: (progress) => {
      if (progress.current % 250 === 0 || progress.current === progress.total) console.log(`  ${progress.message}`);
    },
  });
  imported += result.imported;
  console.log(`  imported ${result.imported.toLocaleString()} RFQs`);
}

console.log(`Directory import complete: ${imported.toLocaleString()} RFQs imported`);

function walk(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}
