# Sales Patriot

A fast local workspace for reviewing DLA RFQs. It synchronizes published DIBBS archives and the still-changing current day into SQLite, renders all stored records with [Fast Grid](https://github.com/gabrielpetersson/fast-grid), and opens each original PDF directly from its local source.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the stack, ingestion pipeline, PDF parsing strategy, database model, and architecture diagrams.

## Stack

- React 19 + Vite + TypeScript
- Fast Grid, pinned to upstream commit `21a7ee2`
- Express 5 API
- SQLite via `better-sqlite3`
- Zod validation
- Tailwind CSS 4 for the Fast Grid utility classes and app styling

Fast Grid uses `SharedArrayBuffer`, so the included development and production servers send the required COOP/COEP headers.

## Start the app

Prerequisites: Node.js 22+, `unzip`, and Poppler's `pdftotext` command.

```bash
npm install
npm run import -- /path/to/CA260927.ZIP
npm run dev
```

Open <http://localhost:5173>. The API runs on <http://localhost:3001> and Vite proxies `/api` during development.

The supplied archive has already been imported into the local ignored database at `data/salespatriot.sqlite`. Import is idempotent by archive date, so re-running the command replaces that day's records rather than duplicating them. An optional override is available when an archive name has no date:

```bash
npm run import -- /path/to/archive.zip --date 2026-09-27
```

## DIBBS synchronization

The API starts an incremental synchronizer by default. It checks the current DIBBS day at most once an hour and the completed-archive listing every six hours. A fresh completed sync in SQLite suppresses redundant startup work, while an interrupted live run resumes from solicitation numbers already committed in small batches. Automatic checks never replace a completed archive day:

- current-day searches stage each result page immediately, then download only PDFs not already local and commit enriched records every 20 documents so the grid updates throughout a long run;
- completed archives are skipped once their PDF ZIP, fixed-width index, and batch ZIP have been successfully ingested;
- the explicit **Re-sync** button is the only automatic path that re-downloads and replaces an existing day.

The toolbar defaults to all stored dates. `From` and `To` are optional bounds. Both the scheduled archive pass and **Sync latest** fill any missing archives in the configured backfill horizon, skipping finalized days, and then check today. A progress row reports the current archive download, PDF parsing, live-page scan, or live-PDF download. **Re-sync** refreshes only the newest stored day inside the current range. The toolbar also reports the most recently completed sync.

Manual equivalents are available for operations and debugging:

```bash
npm run sync:manifests               # stage the configured horizon from the small index/batch files
npm run sync:manifests -- --since 2026-09-07
npm run sync                         # newest completed archive, then today
npm run sync:today                   # today only
npm run sync:today -- --max-new 10  # bounded smoke run
npm run sync -- --archives-only
```

`sync:manifests` is the demo-safe fast path. It downloads only each day's small fixed-width index and batch ZIP, makes those RFQs searchable immediately, and leaves the large PDF archives to finish in the background. The compact files do not contain buyer name, supply chain, or NAICS, so those columns remain empty until the full PDF archive for that day is extracted. A later full archive import replaces the staged metadata for that date with PDF-derived records. `npm run enrich:metadata` reapplies the current PDF parser to missing metadata in archives already stored locally.

## Saved and shared views

Every tab owns its filters and column widths, including **All RFQs**. Saved tabs have a link button that copies a self-contained URL; opening that URL validates the embedded state, adds it as a local tab, and selects it without requiring an account. The default **All RFQs** tab is not shareable. The `+` button creates a blank tab or imports a pasted shared-view URL.

## Buyer signals

Buyer cells show compact relationship and open-value tags. `REL` is deterministic demo data standing in for prior CRM/award history; `$` through `$$$$` are calculated from the estimated value of that buyer's open RFQs under the current filters. **Buyer tree** opens a treemap sized by those same values. Clicking a buyer cell exposes the buyer email and a **Show bidder breakdown** shortcut to the treemap.

For a temporary external demo, install `cloudflared`, keep `npm run dev` running, and start a Quick Tunnel:

```bash
cloudflared tunnel --url http://localhost:5173 --no-autoupdate
```

Vite is configured to accept `*.trycloudflare.com` hosts. Quick Tunnel URLs are temporary and should not be treated as production deployment URLs.

Set `DIBBS_SYNC_ENABLED=false` to disable the in-process timers. Intervals can be changed with `DIBBS_TODAY_INTERVAL_MINUTES` and `DIBBS_ARCHIVE_INTERVAL_MINUTES`; the manual/CLI backfill horizon is controlled by `DIBBS_ARCHIVE_DAYS` and defaults to `17` published archives (roughly three calendar weeks). Current-day result pages are fetched six at a time by default; tune that bounded fan-out with `DIBBS_PAGE_CONCURRENCY` (maximum `12`). DIBBS dates default to `America/New_York` and downloaded material lives under the ignored `data/dibbs/` directory.

## Production build

```bash
npm run build
npm start
```

The production server serves both the API and built client at <http://localhost:3001>.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/days` | Imported days, counts, source type, and last check |
| `GET` | `/api/rfqs?from=YYYY-MM-DD&to=YYYY-MM-DD` | RFQs in an optional date range; no bounds returns all |
| `GET` | `/api/sync/status` | Last completed synchronization |
| `POST` | `/api/sync/latest` | Incrementally fetch the newest archive and current day |
| `POST` | `/api/sync/resync` | Explicitly replace one stored DIBBS day |
| `GET` | `/api/rfqs/:id` | One RFQ |
| `GET` | `/api/rfqs/:id/approved-parts` | Approved CAGE and part-number rows |
| `POST` | `/api/rfqs` | Create an RFQ |
| `PATCH` | `/api/rfqs/:id` | Update an RFQ |
| `DELETE` | `/api/rfqs/:id` | Delete an RFQ |
| `GET` | `/api/rfqs/:id/pdf` | Stream its PDF from the ZIP |

## Useful commands

```bash
npm test          # parser tests
npm run typecheck # server and client type checks
npm run build     # verified production build
```
