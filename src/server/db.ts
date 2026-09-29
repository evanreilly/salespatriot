import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { databasePath } from "./config.js";

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY,
    archive_date TEXT NOT NULL UNIQUE,
    source_path TEXT NOT NULL,
    source_name TEXT NOT NULL,
    file_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'processing',
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_kind TEXT NOT NULL DEFAULT 'archive',
    source_url TEXT,
    index_path TEXT,
    batch_path TEXT
  );

  CREATE TABLE IF NOT EXISTS rfqs (
    id INTEGER PRIMARY KEY,
    import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    archive_date TEXT NOT NULL,
    solicitation_number TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    nsn TEXT,
    purchase_request TEXT,
    quantity REAL,
    unit TEXT,
    issued_date TEXT,
    close_date TEXT,
    buyer_name TEXT,
    buyer_code TEXT,
    buyer_email TEXT,
    agency TEXT,
    supply_chain TEXT,
    naics TEXT,
    delivery_days INTEGER,
    estimated_unit_price REAL,
    estimated_value REAL,
    filename TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    archive_path TEXT NOT NULL,
    archive_entry TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS approved_parts (
    id INTEGER PRIMARY KEY,
    rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
    cage_code TEXT NOT NULL,
    part_number TEXT NOT NULL,
    manufacturer TEXT NOT NULL,
    source_text TEXT NOT NULL,
    UNIQUE(rfq_id, cage_code, part_number)
  );

  CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY,
    sync_type TEXT NOT NULL,
    target_date TEXT,
    status TEXT NOT NULL,
    discovered_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_rfqs_archive_date ON rfqs(archive_date);
  CREATE INDEX IF NOT EXISTS idx_rfqs_close_date ON rfqs(close_date);
  CREATE INDEX IF NOT EXISTS idx_rfqs_title ON rfqs(title);
  CREATE INDEX IF NOT EXISTS idx_approved_parts_rfq_id ON approved_parts(rfq_id);
  CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON sync_runs(started_at DESC);
`);

ensureColumn("rfqs", "estimated_unit_price", "REAL");
ensureColumn("rfqs", "estimated_value", "REAL");
ensureColumn("imports", "last_checked_at", "TEXT");
ensureColumn("imports", "source_kind", "TEXT NOT NULL DEFAULT 'archive'");
ensureColumn("imports", "source_url", "TEXT");
ensureColumn("imports", "index_path", "TEXT");
ensureColumn("imports", "batch_path", "TEXT");
db.exec("UPDATE imports SET last_checked_at = COALESCE(last_checked_at, imported_at)");

export type RfqRow = {
  id: number;
  archive_date: string;
  solicitation_number: string;
  title: string;
  nsn: string | null;
  approved_part_numbers?: string | null;
  purchase_request: string | null;
  quantity: number | null;
  unit: string | null;
  issued_date: string | null;
  close_date: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  buyer_email: string | null;
  agency: string | null;
  supply_chain: string | null;
  naics: string | null;
  delivery_days: number | null;
  estimated_unit_price: number | null;
  estimated_value: number | null;
  filename: string;
  file_size: number;
  archive_path: string;
  archive_entry: string;
  created_at: string;
  updated_at: string;
};

function ensureColumn(table: string, column: string, type: string) {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!columns.some((candidate) => candidate.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
