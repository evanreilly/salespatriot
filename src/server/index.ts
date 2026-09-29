import express from "express";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { db, type RfqRow } from "./db.js";
import { dibbsArchiveDays, port, projectRoot } from "./config.js";
import { serializeRfq } from "./serialize.js";
import { syncPublishedArchives, syncToday } from "./dibbs-sync.js";
import { getSyncProgress, runSyncExclusive } from "./sync-lock.js";
import { startDibbsScheduler } from "./sync-scheduler.js";

const app = express();

app.use((_request, response, next) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
});
app.use(express.json({ limit: "1mb" }));

const nullableText = z.string().trim().max(500).nullable().optional();
const rfqInput = z.object({
  archiveDate: z.iso.date(),
  solicitationNumber: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(500),
  nsn: nullableText,
  purchaseRequest: nullableText,
  quantity: z.number().nonnegative().nullable().optional(),
  unit: nullableText,
  issuedDate: z.iso.date().nullable().optional(),
  closeDate: z.iso.date().nullable().optional(),
  buyerName: nullableText,
  buyerCode: nullableText,
  buyerEmail: z.email().nullable().optional(),
  agency: nullableText,
  supplyChain: nullableText,
  naics: nullableText,
  deliveryDays: z.number().int().nonnegative().nullable().optional(),
  estimatedUnitPrice: z.number().nonnegative().nullable().optional(),
  estimatedValue: z.number().nonnegative().nullable().optional(),
  filename: z.string().trim().min(1).max(255).optional(),
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/days", (_request, response) => {
  const rows = db
    .prepare(
      `SELECT i.archive_date AS date, COUNT(r.id) AS count,
              i.imported_at AS importedAt, i.last_checked_at AS lastCheckedAt,
              i.source_name AS sourceName, i.source_kind AS sourceKind
       FROM imports i
       LEFT JOIN rfqs r ON r.import_id = i.id
       WHERE i.status = 'complete'
       GROUP BY i.id
       ORDER BY i.archive_date DESC`,
    )
    .all();
  response.json({ data: rows });
});

app.get("/api/sync/status", (_request, response) => {
  const latest = db
    .prepare(
      `SELECT sync_type AS syncType, target_date AS targetDate, status,
              discovered_count AS discoveredCount, imported_count AS importedCount,
              error, started_at AS startedAt, completed_at AS completedAt
       FROM sync_runs
       WHERE completed_at IS NOT NULL
       ORDER BY completed_at DESC, id DESC
       LIMIT 1`,
    )
    .get();
  response.json({ data: latest ?? null, progress: getSyncProgress() });
});

app.post("/api/sync/latest", async (_request, response) => {
  if (getSyncProgress().active) {
    response.status(409).json({ error: "A DIBBS sync is already running" });
    return;
  }
  void runSyncExclusive("Sync latest week", async (report) => ({
    archive: await syncPublishedArchives({ limit: dibbsArchiveDays, onProgress: report }),
    live: await syncToday({ onProgress: report }),
  })).catch((error) => console.error("DIBBS sync failed:", error));
  response.status(202).json({ data: { started: true } });
});

app.post("/api/sync/resync", async (request, response) => {
  const parsed = z.object({ date: z.iso.date() }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "A valid date is required" });
    return;
  }
  const imported = db
    .prepare("SELECT source_kind AS sourceKind FROM imports WHERE archive_date = ?")
    .get(parsed.data.date) as { sourceKind: string } | undefined;
  if (!imported) {
    response.status(404).json({ error: "That date has not been imported" });
    return;
  }
  if (imported.sourceKind === "manual") {
    response.status(409).json({ error: "Manual records do not have a DIBBS source to re-sync" });
    return;
  }
  if (getSyncProgress().active) {
    response.status(409).json({ error: "A DIBBS sync is already running" });
    return;
  }
  void runSyncExclusive(`Re-sync ${parsed.data.date}`, (report) => imported.sourceKind === "archive"
    ? syncPublishedArchives({ date: parsed.data.date, force: true, onProgress: report })
    : syncToday({ date: parsed.data.date, force: true, onProgress: report }))
    .catch((error) => console.error("DIBBS re-sync failed:", error));
  response.status(202).json({ data: { started: true } });
});

app.get("/api/rfqs", (request, response) => {
  const from = optionalDate(request.query.from);
  const to = optionalDate(request.query.to);
  if (from === false || to === false) {
    response.status(400).json({ error: "Invalid date range" });
    return;
  }
  if (from && to && from > to) {
    response.status(400).json({ error: "From date must not be after To date" });
    return;
  }
  const clauses: string[] = [];
  const values: string[] = [];
  if (from) {
    clauses.push("r.archive_date >= ?");
    values.push(from);
  }
  if (to) {
    clauses.push("r.archive_date <= ?");
    values.push(to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT r.*,
              (SELECT json_group_array(part_number)
               FROM (
                 SELECT DISTINCT part_number
                 FROM approved_parts
                 WHERE rfq_id = r.id
                 ORDER BY part_number
               )) AS approved_part_numbers
       FROM rfqs r
       ${where}
       ORDER BY r.archive_date DESC, r.solicitation_number`,
    )
    .all(...values) as RfqRow[];
  response.json({ data: rows.map(serializeRfq), total: rows.length, from: from || "", to: to || "" });
});

app.get("/api/rfqs/:id", (request, response) => {
  const id = Number(request.params.id);
  const row = db.prepare("SELECT * FROM rfqs WHERE id = ?").get(id) as
    | RfqRow
    | undefined;
  if (!row) {
    response.status(404).json({ error: "RFQ not found" });
    return;
  }
  response.json({ data: serializeRfq(row) });
});

app.get("/api/rfqs/:id/approved-parts", (request, response) => {
  const id = Number(request.params.id);
  const rfq = db.prepare("SELECT id FROM rfqs WHERE id = ?").get(id);
  if (!rfq) {
    response.status(404).json({ error: "RFQ not found" });
    return;
  }

  const rows = db
    .prepare(
      `SELECT id, rfq_id AS rfqId, cage_code AS cageCode,
              part_number AS partNumber, manufacturer
       FROM approved_parts
       WHERE rfq_id = ?
       ORDER BY manufacturer, part_number`,
    )
    .all(id);
  response.json({ data: rows });
});

app.post("/api/rfqs", (request, response) => {
  const parsed = rfqInput.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid RFQ", details: parsed.error.issues });
    return;
  }

  const input = parsed.data;
  const importId = ensureManualImport(input.archiveDate);
  try {
    const result = db
      .prepare(
        `INSERT INTO rfqs (
          import_id, archive_date, solicitation_number, title, nsn,
          purchase_request, quantity, unit, issued_date, close_date,
          buyer_name, buyer_code, buyer_email, agency, supply_chain,
          naics, delivery_days, estimated_unit_price, estimated_value,
          filename, archive_path, archive_entry
        ) VALUES (
          @importId, @archiveDate, @solicitationNumber, @title, @nsn,
          @purchaseRequest, @quantity, @unit, @issuedDate, @closeDate,
          @buyerName, @buyerCode, @buyerEmail, @agency, @supplyChain,
          @naics, @deliveryDays, @estimatedUnitPrice, @estimatedValue,
          @filename, '', ''
        )`,
      )
      .run({
        ...withNullDefaults(input),
        importId,
        filename: input.filename ?? `${input.solicitationNumber}.pdf`,
      });
    const row = db.prepare("SELECT * FROM rfqs WHERE id = ?").get(result.lastInsertRowid) as RfqRow;
    response.status(201).json({ data: serializeRfq(row) });
  } catch (error) {
    handleDatabaseError(error, response);
  }
});

app.patch("/api/rfqs/:id", (request, response) => {
  const id = Number(request.params.id);
  const current = db.prepare("SELECT * FROM rfqs WHERE id = ?").get(id) as
    | RfqRow
    | undefined;
  if (!current) {
    response.status(404).json({ error: "RFQ not found" });
    return;
  }

  const currentInput = {
    archiveDate: current.archive_date,
    solicitationNumber: current.solicitation_number,
    title: current.title,
    nsn: current.nsn,
    purchaseRequest: current.purchase_request,
    quantity: current.quantity,
    unit: current.unit,
    issuedDate: current.issued_date,
    closeDate: current.close_date,
    buyerName: current.buyer_name,
    buyerCode: current.buyer_code,
    buyerEmail: current.buyer_email,
    agency: current.agency,
    supplyChain: current.supply_chain,
    naics: current.naics,
    deliveryDays: current.delivery_days,
    estimatedUnitPrice: current.estimated_unit_price,
    estimatedValue: current.estimated_value,
    filename: current.filename,
  };
  const parsed = rfqInput.safeParse({ ...currentInput, ...request.body });
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid RFQ", details: parsed.error.issues });
    return;
  }

  const input = parsed.data;
  const importId = ensureManualImport(input.archiveDate);
  try {
    db.prepare(
      `UPDATE rfqs SET
        import_id = @importId, archive_date = @archiveDate,
        solicitation_number = @solicitationNumber, title = @title,
        nsn = @nsn, purchase_request = @purchaseRequest,
        quantity = @quantity, unit = @unit, issued_date = @issuedDate,
        close_date = @closeDate, buyer_name = @buyerName,
        buyer_code = @buyerCode, buyer_email = @buyerEmail,
        agency = @agency, supply_chain = @supplyChain, naics = @naics,
        delivery_days = @deliveryDays, estimated_unit_price = @estimatedUnitPrice,
        estimated_value = @estimatedValue, filename = @filename,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = @id`,
    ).run({ ...withNullDefaults(input), importId, id });
    const row = db.prepare("SELECT * FROM rfqs WHERE id = ?").get(id) as RfqRow;
    response.json({ data: serializeRfq(row) });
  } catch (error) {
    handleDatabaseError(error, response);
  }
});

app.delete("/api/rfqs/:id", (request, response) => {
  const result = db.prepare("DELETE FROM rfqs WHERE id = ?").run(Number(request.params.id));
  if (result.changes === 0) {
    response.status(404).json({ error: "RFQ not found" });
    return;
  }
  response.status(204).end();
});

app.get("/api/rfqs/:id/pdf", (request, response) => {
  const row = db
    .prepare("SELECT filename, file_size, archive_path, archive_entry FROM rfqs WHERE id = ?")
    .get(Number(request.params.id)) as
    | Pick<RfqRow, "filename" | "file_size" | "archive_path" | "archive_entry">
    | undefined;

  if (!row) {
    response.status(404).json({ error: "RFQ not found" });
    return;
  }
  if (/^https:\/\/dibbs2\.bsm\.dla\.mil\/Downloads\/RFQ\/[^\s]+\.PDF$/i.test(row.archive_path)) {
    response.redirect(row.archive_path);
    return;
  }
  if (!row.archive_path || !fs.existsSync(row.archive_path)) {
    response.status(404).json({ error: "Source archive is unavailable" });
    return;
  }

  response.type("application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="${safeFilename(row.filename)}"`);
  if (row.file_size > 0) response.setHeader("Content-Length", String(row.file_size));

  if (!row.archive_entry) {
    const stream = fs.createReadStream(row.archive_path);
    stream.pipe(response);
    stream.on("error", () => {
      if (!response.headersSent) response.status(500).json({ error: "Could not open PDF" });
      else response.destroy();
    });
    response.on("close", () => stream.destroy());
    return;
  }

  const unzip = spawn("unzip", ["-p", row.archive_path, row.archive_entry], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  unzip.stdout.pipe(response);
  unzip.on("error", () => {
    if (!response.headersSent) response.status(500).json({ error: "Could not open PDF" });
    else response.destroy();
  });
  response.on("close", () => unzip.kill());
});

const webDist = path.join(projectRoot, "dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((_request, response) => response.sendFile(path.join(webDist, "index.html")));
}

app.listen(port, () => {
  console.log(`Sales Patriot API listening on http://localhost:${port}`);
  startDibbsScheduler();
});

function ensureManualImport(archiveDate: string): number {
  db.prepare(
    `INSERT INTO imports (
       archive_date, source_path, source_name, status, source_kind, last_checked_at
     ) VALUES (?, '', 'Manual entry', 'complete', 'manual', CURRENT_TIMESTAMP)
     ON CONFLICT(archive_date) DO NOTHING`,
  ).run(archiveDate);
  return (db.prepare("SELECT id FROM imports WHERE archive_date = ?").get(archiveDate) as { id: number }).id;
}

function withNullDefaults<T extends Record<string, unknown>>(input: T) {
  const defaults = {
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
    filename: null,
  };
  return Object.fromEntries(
    Object.entries({ ...defaults, ...input }).map(([key, value]) => [key, value ?? null]),
  );
}

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function handleDatabaseError(error: unknown, response: express.Response) {
  if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
    response.status(409).json({ error: "That solicitation number already exists" });
    return;
  }
  console.error(error);
  response.status(500).json({ error: "Database operation failed" });
}

function optionalDate(value: unknown): string | null | false {
  if (value === undefined || value === "") return null;
  const parsed = z.iso.date().safeParse(value);
  return parsed.success ? parsed.data : false;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
