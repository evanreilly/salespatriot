import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovedPart, Rfq, RfqDay, RfqListResponse, SyncProgress, SyncStatus } from "../shared/rfq";
import { FastGrid, type PopoverAnchor } from "./FastGrid";
import { FilterBuilderPanel, SaveViewPopover } from "./FilterDialogs";
import {
  applyRfqFilters,
  cloneFilterGroup,
  createId,
  emptyFilterGroup,
  fieldDefinitions,
  type FilterField,
  type FilterGroup,
  type SavedFilterView,
} from "./filters";

const savedViewsKey = "sales-patriot.saved-filter-views.v1";

export function App() {
  const [days, setDays] = useState<RfqDay[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [filteredRfqs, setFilteredRfqs] = useState<Rfq[]>([]);
  const [selectedRfq, setSelectedRfq] = useState<Rfq | null>(null);
  const [partsPopover, setPartsPopover] = useState<{ rfq: Rfq; anchor: PopoverAnchor } | null>(null);
  const [previewPopover, setPreviewPopover] = useState<{
    rfq: Rfq;
    anchor: PopoverAnchor;
    field: FilterField;
  } | null>(null);
  const [globalQuery, setGlobalQuery] = useState("");
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(emptyFilterGroup);
  const [columnFilters, setColumnFilters] = useState<Record<number, string>>({});
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>(loadSavedViews);
  const [activeViewId, setActiveViewId] = useState("all");
  const [builderRequest, setBuilderRequest] = useState<{ field?: FilterField } | null>(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [gridResetVersion, setGridResetVersion] = useState(0);
  const [gridViewVersion, setGridViewVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<SyncStatus | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncing, setSyncing] = useState<"latest" | "resync" | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const syncWasActive = useRef(false);
  const dayUpdateVersion = days.map((day) => `${day.date}:${day.lastCheckedAt}`).join("|");
  const latestShownDay = days.find(
    (day) => (!fromDate || day.date >= fromDate) && (!toDate || day.date <= toDate),
  );

  const refreshMetadata = useCallback(async () => {
    const [dayResponse, statusResponse] = await Promise.all([
      fetchJson<{ data: RfqDay[] }>("/api/days"),
      fetchJson<{ data: SyncStatus | null; progress: SyncProgress }>("/api/sync/status"),
    ]);
    setDays(dayResponse.data);
    setLastSync(statusResponse.data);
    setSyncProgress(statusResponse.progress);
    if (statusResponse.progress.active) {
      setSyncing(statusResponse.progress.operation.startsWith("Re-sync") ? "resync" : "latest");
      syncWasActive.current = true;
    } else {
      setSyncing(null);
      if (syncWasActive.current) {
        syncWasActive.current = false;
        setDataVersion((version) => version + 1);
        setSyncMessage("Sync finished");
      }
    }
    if (dayResponse.data.length === 0) setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    const refreshDays = () => {
      refreshMetadata()
        .catch((cause) => {
          if (!active) return;
          setError(errorMessage(cause));
          setLoading(false);
        });
    };
    refreshDays();
    const timer = window.setInterval(refreshDays, 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshMetadata]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelectedRfq(null);
    setPartsPopover(null);
    setPreviewPopover(null);
    setFilteredRfqs([]);
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    fetchJson<RfqListResponse>(`/api/rfqs${params.size ? `?${params}` : ""}`)
      .then(({ data }) => {
        setRfqs(data);
        setFilteredRfqs(data);
      })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setLoading(false));
  }, [fromDate, toDate, dayUpdateVersion, dataVersion]);

  useEffect(() => {
    localStorage.setItem(savedViewsKey, JSON.stringify(savedViews));
  }, [savedViews]);

  useEffect(() => {
    if (activeViewId === "all") return;
    setSavedViews((current) =>
      current.map((view) =>
        view.id === activeViewId
          ? {
              ...view,
              globalQuery,
              group: cloneFilterGroup(filterGroup),
              columnFilters: { ...columnFilters },
            }
          : view,
      ),
    );
  }, [activeViewId, globalQuery, filterGroup, columnFilters]);

  const tableRfqs = useMemo(
    () => applyRfqFilters(rfqs, globalQuery, filterGroup),
    [rfqs, globalQuery, filterGroup],
  );
  const estimatedBidValue = filteredRfqs.reduce((total, rfq) => total + (rfq.estimatedValue ?? 0), 0);
  const filterCount = filterGroup.rules.length + Object.keys(columnFilters).length + (globalQuery.trim() ? 1 : 0);

  const selectAllView = () => {
    setActiveViewId("all");
    setGlobalQuery("");
    setFilterGroup(emptyFilterGroup());
    setColumnFilters({});
    setBuilderRequest(null);
    setSaveViewOpen(false);
    setGridResetVersion((version) => version + 1);
  };

  const selectSavedView = (view: SavedFilterView) => {
    setActiveViewId(view.id);
    setGlobalQuery(view.globalQuery);
    setFilterGroup(cloneFilterGroup(view.group));
    setColumnFilters({ ...view.columnFilters });
    setBuilderRequest(null);
    setSaveViewOpen(false);
    setGridViewVersion((version) => version + 1);
  };

  const saveCurrentView = (name: string) => {
    const view: SavedFilterView = {
      id: createId(),
      name,
      globalQuery,
      group: cloneFilterGroup(filterGroup),
      columnFilters: { ...columnFilters },
    };
    setSavedViews((current) => [...current, view]);
    setActiveViewId(view.id);
    setSaveViewOpen(false);
  };

  const deleteSavedView = (id: string) => {
    setSavedViews((current) => current.filter((view) => view.id !== id));
    if (activeViewId === id) selectAllView();
  };

  const duplicateSavedView = (view: SavedFilterView) => {
    const duplicate: SavedFilterView = {
      id: createId(),
      name: `${view.name} copy`,
      globalQuery: view.globalQuery,
      group: cloneFilterGroup(view.group),
      columnFilters: { ...view.columnFilters },
    };
    setSavedViews((current) => [...current, duplicate]);
    selectSavedView(duplicate);
  };

  const syncLatest = async () => {
    setSyncing("latest");
    setSyncMessage(null);
    try {
      await fetchJson("/api/sync/latest", { method: "POST" });
      await refreshMetadata();
      setSyncMessage("Sync started");
    } catch (cause) {
      setSyncMessage(errorMessage(cause));
      setSyncing(null);
    }
  };

  const resyncLatestShownDay = async () => {
    const date = latestShownDay?.date;
    if (!date) return;
    setSyncing("resync");
    setSyncMessage(null);
    try {
      await fetchJson("/api/sync/resync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date }),
      });
      await refreshMetadata();
      setSyncMessage(`Re-syncing ${date}`);
    } catch (cause) {
      setSyncMessage(errorMessage(cause));
      setSyncing(null);
    }
  };

  return (
    <div className="app-frame">
      <main>
        <section className="table-toolbar" aria-label="RFQ controls and filtered totals">
          <div className="date-range" aria-label="Optional RFQ date range">
            <label className="date-picker">
              <span>From</span>
              <input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} />
            </label>
            <label className="date-picker">
              <span>To</span>
              <input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} />
            </label>
            {(fromDate || toDate) && <button className="clear-date-range" onClick={() => { setFromDate(""); setToDate(""); }}>All dates</button>}
          </div>
          <div className="filtered-summary" aria-live="polite">
            <span><strong>{filteredRfqs.length.toLocaleString()}</strong> RFQs showing</span>
            <span className="summary-divider" aria-hidden="true" />
            <span title="Requested quantity multiplied by the latest procurement-history unit cost">
              <strong>{formatMillions(estimatedBidValue)}</strong> estimated bid value
            </span>
            <span className="summary-divider" aria-hidden="true" />
            <span title={lastSync ? formatSyncTimestamp(lastSync.completedAt) : undefined}>
              {lastSync?.status === "failed" ? "Last sync failed" : "Last synced"} {lastSync ? formatCompactTimestamp(lastSync.completedAt) : "never"}
            </span>
            <button className="sync-button" disabled={syncing !== null} onClick={syncLatest}>
              {syncing === "latest" ? "Syncing…" : "Sync latest"}
            </button>
            <button
              className="sync-button"
              disabled={syncing !== null || !latestShownDay}
              onClick={resyncLatestShownDay}
              title={`Re-download and replace ${latestShownDay?.date || "the latest stored day"}`}
            >
              {syncing === "resync" ? "Re-syncing…" : "Re-sync"}
            </button>
            {syncMessage && <span className="sync-message">{syncMessage}</span>}
          </div>
        </section>

        {syncProgress?.active && (
          <section className="sync-progress-row" aria-live="polite" aria-label="Synchronization progress">
            <span>{syncProgress.message || syncProgress.operation}</span>
            <progress value={syncProgress.current} max={Math.max(syncProgress.total, 1)} />
            <strong>{formatProgress(syncProgress.current, syncProgress.total)}</strong>
          </section>
        )}

        <nav className="saved-view-tabs" aria-label="Saved filter tabs">
          <button className={activeViewId === "all" ? "saved-view-tab active" : "saved-view-tab"} onClick={selectAllView}>
            All RFQs
          </button>
          {savedViews.map((view) => (
            <span className={activeViewId === view.id ? "saved-view-tab active" : "saved-view-tab"} key={view.id}>
              <button onClick={() => selectSavedView(view)}>{view.name}</button>
              <button className="duplicate-view-button" onClick={() => duplicateSavedView(view)} aria-label={`Duplicate ${view.name} tab`} title="Duplicate tab"><CopyIcon /></button>
              <button className="delete-view-button" onClick={() => deleteSavedView(view.id)} aria-label={`Delete ${view.name} tab`}>×</button>
            </span>
          ))}
          <button className="save-tab-button" onClick={() => setSaveViewOpen(true)}>
            <SaveIcon /> Save current filter as tab
          </button>
        </nav>
        {saveViewOpen && <SaveViewPopover onSave={saveCurrentView} onClose={() => setSaveViewOpen(false)} />}

        <section className="whole-table-filter-row" aria-label="Whole table filtering">
          <label className="global-filter-input">
            <SearchIcon />
            <input
              value={globalQuery}
              onChange={(event) => setGlobalQuery(event.target.value)}
              placeholder="Filter the whole table…"
              aria-label="Filter the whole table"
            />
            {globalQuery && <button onClick={() => setGlobalQuery("")} aria-label="Clear whole table filter">×</button>}
          </label>
          <div className="filter-builder-control">
            <button className={filterCount ? "open-filter-builder active" : "open-filter-builder"} onClick={() => setBuilderRequest((current) => current ? null : {})}>
              <FilterIcon />
              Filters{filterCount ? ` (${filterCount})` : ""}
            </button>
          </div>
        </section>

        {builderRequest && (
          <FilterBuilderPanel
            key={builderRequest.field ?? "all-fields"}
            matchCount={filteredRfqs.length}
            initialGroup={filterGroup}
            initialField={builderRequest.field}
            onChange={setFilterGroup}
            onClose={() => setBuilderRequest(null)}
          />
        )}

        <section className="workspace">
          {error ? (
            <div className="message error-message">{error}</div>
          ) : days.length === 0 && !loading ? (
            <div className="message empty-message">
              <strong>No RFQs imported yet.</strong>
              <span>Run the archive import command, then refresh this page.</span>
              <code>npm run import -- /path/to/CA260927.ZIP</code>
            </div>
          ) : !crossOriginIsolated ? (
            <div className="message error-message">
              Fast Grid requires cross-origin isolation. Start the app through the included Vite server.
            </div>
          ) : (
            <div className={loading ? "grid-container grid-loading" : "grid-container"}>
              <FastGrid
                rfqs={tableRfqs}
                onSelect={(rfq, anchor, field) => {
                  setPartsPopover(null);
                  setPreviewPopover({ rfq, anchor, field });
                }}
                onSelectNsn={(rfq, anchor) => {
                  setPreviewPopover(null);
                  setPartsPopover({ rfq, anchor });
                }}
                onFilteredChange={setFilteredRfqs}
                columnFilters={columnFilters}
                onColumnFiltersChange={setColumnFilters}
                onOpenFilterBuilder={(field) => setBuilderRequest({ field })}
                resetVersion={gridResetVersion}
                viewVersion={gridViewVersion}
              />
            </div>
          )}
        </section>
      </main>

      {selectedRfq && <RfqDrawer rfq={selectedRfq} onClose={() => setSelectedRfq(null)} />}
      {previewPopover && (
        <RfqPreviewPopover
          rfq={previewPopover.rfq}
          anchor={previewPopover.anchor}
          field={previewPopover.field}
          onClose={() => setPreviewPopover(null)}
          onOpenFull={() => {
            setSelectedRfq(previewPopover.rfq);
            setPreviewPopover(null);
          }}
        />
      )}
      {partsPopover && (
        <ApprovedPartsPopover
          rfq={partsPopover.rfq}
          anchor={partsPopover.anchor}
          onClose={() => setPartsPopover(null)}
        />
      )}
    </div>
  );
}

function RfqPreviewPopover({
  rfq,
  anchor,
  field,
  onClose,
  onOpenFull,
}: {
  rfq: Rfq;
  anchor: PopoverAnchor;
  field: FilterField;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  const width = Math.min(520, window.innerWidth - 16);
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  const placeAbove = anchor.bottom + 330 > window.innerHeight;
  const top = placeAbove ? Math.max(8, anchor.top - 324) : anchor.bottom + 3;
  const fieldLabel = fieldDefinitions.find((definition) => definition.key === field)?.label ?? "Detail";
  const summaryDetails = [
    { field: "nsn" as const, label: "NSN", value: rfq.nsn },
    {
      field: "quantity" as const,
      label: "Quantity",
      value: rfq.quantity === null ? null : `${rfq.quantity.toLocaleString()} ${rfq.unit ?? ""}`.trim(),
    },
    { field: "closeDate" as const, label: "Closes", value: formatLongDate(rfq.closeDate) },
    { field: "buyerName" as const, label: "Buyer", value: rfq.buyerName },
    { field: "supplyChain" as const, label: "Supply chain", value: rfq.supplyChain ?? rfq.agency },
  ].filter((detail) => detail.field !== field);

  return (
    <section
      ref={panelRef}
      className="rfq-preview-popover"
      role="dialog"
      aria-label={`${fieldLabel} for ${rfq.solicitationNumber}`}
      style={{ width, left, top }}
    >
      <header className="rfq-preview-head">
        <div>
          <span>{fieldLabel}</span>
          <strong>{previewFieldValue(rfq, field)}</strong>
          {field !== "solicitationNumber" && <small>{rfq.solicitationNumber}</small>}
        </div>
        <button className="popover-close-button" onClick={onClose} aria-label="Close RFQ preview">×</button>
      </header>

      {field !== "title" && (
        <div className="rfq-preview-description">
          <span>Item description</span>
          <strong>{rfq.title}</strong>
        </div>
      )}

      <div className="rfq-preview-detail-grid">
        {summaryDetails.map((detail) => (
          <div key={detail.field}>
            <span>{detail.label}</span>
            <strong>{detail.value || "—"}</strong>
          </div>
        ))}
      </div>

      <footer className="rfq-preview-foot">
        <a href={`/api/rfqs/${rfq.id}/pdf`} target="_blank" rel="noreferrer">
          Source PDF <ArrowUpRight />
        </a>
        <button onClick={onOpenFull}>Open full details</button>
      </footer>
    </section>
  );
}

function ApprovedPartsPopover({
  rfq,
  anchor,
  onClose,
}: {
  rfq: Rfq;
  anchor: PopoverAnchor;
  onClose: () => void;
}) {
  const [parts, setParts] = useState<ApprovedPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setParts([]);
    setError(null);
    setLoading(true);
    fetch(`/api/rfqs/${rfq.id}/approved-parts`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return response.json() as Promise<{ data: ApprovedPart[] }>;
      })
      .then(({ data }) => setParts(data))
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(errorMessage(cause));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [rfq.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  const width = Math.min(650, window.innerWidth - 16);
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  const placeAbove = anchor.bottom + 400 > window.innerHeight;
  const top = placeAbove ? Math.max(8, anchor.top - 394) : anchor.bottom + 3;

  return (
      <section
        ref={panelRef}
        className="approved-parts-popover"
        role="dialog"
        aria-labelledby="parts-title"
        style={{ width, left, top }}
      >
        <div className="parts-modal-head">
          <div>
            <h2 id="parts-title">Approved parts · {rfq.nsn}</h2>
            <span>{rfq.title}</span>
          </div>
          <button className="popover-close-button" onClick={onClose} aria-label="Close approved parts">×</button>
        </div>

        {loading ? (
          <div className="parts-state">Loading approved parts…</div>
        ) : error ? (
          <div className="parts-state parts-error">{error}</div>
        ) : parts.length === 0 ? (
          <div className="parts-state">
            <strong>No approved parts listed</strong>
            <span>This RFQ’s Section B does not identify an approved CAGE and part-number pair.</span>
          </div>
        ) : (
          <div className="parts-table-wrap">
            <table className="parts-table">
              <thead>
                <tr>
                  <th>Manufacturer</th>
                  <th>CAGE</th>
                  <th>Part number</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((part) => (
                  <tr key={part.id}>
                    <td>{part.manufacturer}</td>
                    <td><code>{part.cageCode}</code></td>
                    <td><code>{part.partNumber}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="parts-modal-foot">
          <span>{parts.length ? `${parts.length} approved ${parts.length === 1 ? "part" : "parts"}` : "Source: RFQ Section B"}</span>
          <a href={`/api/rfqs/${rfq.id}/pdf`} target="_blank" rel="noreferrer">Verify in source PDF <ArrowUpRight /></a>
        </div>
      </section>
  );
}

function RfqDrawer({ rfq, onClose }: { rfq: Rfq; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={rfq.solicitationNumber}>
      <button className="drawer-scrim" onClick={onClose} aria-label="Close details" />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">{rfq.solicitationNumber}</p>
            <h2>{rfq.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close details">×</button>
        </div>
        <div className="detail-grid">
          <Detail label="NSN" value={rfq.nsn} />
          <Detail label="Purchase request" value={rfq.purchaseRequest} />
          <Detail label="Quantity" value={rfq.quantity === null ? null : `${rfq.quantity.toLocaleString()} ${rfq.unit ?? ""}`} />
          <Detail label="NAICS" value={rfq.naics} />
          <Detail label="Issued" value={formatLongDate(rfq.issuedDate)} />
          <Detail label="Closes" value={formatLongDate(rfq.closeDate)} />
          <Detail label="Delivery" value={rfq.deliveryDays === null ? null : `${rfq.deliveryDays} days`} />
          <Detail label="Buyer" value={rfq.buyerName} />
          <Detail label="Buyer email" value={rfq.buyerEmail} />
          <Detail label="Supply chain" value={rfq.supplyChain ?? rfq.agency} wide />
        </div>
        <a className="pdf-button" href={`/api/rfqs/${rfq.id}/pdf`} target="_blank" rel="noreferrer">
          Open source PDF
          <ArrowUpRight />
        </a>
        <p className="source-note">Source: {rfq.filename} · {formatBytes(rfq.fileSize)}</p>
      </aside>
    </div>
  );
}

function Detail({ label, value, wide = false }: { label: string; value: string | null; wide?: boolean }) {
  return (
    <div className={wide ? "detail wide" : "detail"}>
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function ArrowUpRight() {
  return <svg viewBox="0 0 20 20"><path d="M6 14 14 6M8 6h6v6" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.7" cy="8.7" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m12.5 12.5 4 4" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

function FilterIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14l-5.4 6.1v4.6l-3.2 1.6v-6.2L3 4Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

function SaveIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3h10.5L17 5.5V17H4V3Z" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M7 3v5h7V3M7 17v-5h7v5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>;
}

function CopyIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6.5" y="6.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M4.5 13.5h-1v-10h10v1" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function formatLongDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function formatBytes(bytes: number) {
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1_000)} KB`;
}

function formatMillions(value: number) {
  return `$${(value / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}M`;
}

function formatCompactTimestamp(value: string) {
  const date = parseSqliteTimestamp(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function formatSyncTimestamp(value: string) {
  const date = parseSqliteTimestamp(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatProgress(current: number, total: number) {
  if (!total) return "—";
  return `${Math.min(100, Math.round((current / total) * 100))}%`;
}

function parseSqliteTimestamp(value: string) {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

function previewFieldValue(rfq: Rfq, field: FilterField) {
  if (field === "supplyChain") return rfq.supplyChain ?? rfq.agency ?? "—";
  if (field === "quantity") {
    return rfq.quantity === null ? "—" : `${rfq.quantity.toLocaleString()} ${rfq.unit ?? ""}`.trim();
  }
  if (field === "closeDate") return formatLongDate(rfq.closeDate);
  if (field === "deliveryDays") return rfq.deliveryDays === null ? "—" : `${rfq.deliveryDays} days`;
  if (field === "estimatedValue") return rfq.estimatedValue === null ? "—" : `$${rfq.estimatedValue.toLocaleString()}`;
  return String(rfq[field] ?? "—");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

function loadSavedViews(): SavedFilterView[] {
  try {
    const value = JSON.parse(localStorage.getItem(savedViewsKey) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
