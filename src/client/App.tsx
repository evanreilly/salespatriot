import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { ApprovedPart, Rfq, RfqDay, RfqListResponse, SyncStatus } from "../shared/rfq";
import { FastGrid, type PopoverAnchor } from "./FastGrid";
import { BuyerTagKey, BuyerTreemapPanel } from "./BuyerTreemap";
import { buildBuyerInsights, buyerInsightMap } from "./buyerInsights";
import { AddViewPopover, FilterBuilderPanel, SaveViewPopover } from "./FilterDialogs";
import {
  applyCachedRfqFilters,
  cloneFilterGroup,
  createId,
  emptyFilterGroup,
  fieldDefinitions,
  type FilterField,
  type FilterGroup,
  type SavedFilterView,
} from "./filters";
import { defaultColumnWidths, normalizeColumnWidths, placeCellPopover } from "./gridLayout";
import { parseColumnWidths, parseSavedViews, updateSavedViewState } from "./savedViews";
import { createSharedViewUrl, parseSharedViewUrl, withoutSharedViewHash } from "./viewSharing";
import { appPath } from "./paths";

const savedViewsKey = "sales-patriot.saved-filter-views.v1";
const allRfqsColumnWidthsKey = "sales-patriot.all-rfqs-column-widths.v1";

export function App() {
  const [days, setDays] = useState<RfqDay[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [fullDetails, setFullDetails] = useState<{ rfq: Rfq; anchor: PopoverAnchor } | null>(null);
  const [partsPopover, setPartsPopover] = useState<{ rfq: Rfq; anchor: PopoverAnchor } | null>(null);
  const [previewPopover, setPreviewPopover] = useState<{
    rfq: Rfq;
    anchor: PopoverAnchor;
    field: FilterField;
  } | null>(null);
  const [globalQuery, setGlobalQuery] = useState("");
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(emptyFilterGroup);
  const [columnFilters, setColumnFilters] = useState<Record<number, string>>({});
  const [allRfqsColumnWidths, setAllRfqsColumnWidths] = useState(loadAllRfqsColumnWidths);
  const [columnWidths, setColumnWidths] = useState(() => [...allRfqsColumnWidths]);
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>(loadSavedViews);
  const [activeViewId, setActiveViewId] = useState("all");
  const [builderRequest, setBuilderRequest] = useState<{ field?: FilterField } | null>(null);
  const [buyerTreeOpen, setBuyerTreeOpen] = useState(false);
  const [buyerTreeFocus, setBuyerTreeFocus] = useState<string | null>(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [addViewOpen, setAddViewOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [gridResetVersion, setGridResetVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<SyncStatus | null>(null);
  const dayUpdateVersion = days.map((day) => `${day.date}:${day.lastCheckedAt}`).join("|");

  const applySavedView = useCallback((view: SavedFilterView) => {
    setActiveViewId(view.id);
    setGlobalQuery(view.globalQuery);
    setFilterGroup(cloneFilterGroup(view.group));
    setColumnFilters({ ...view.columnFilters });
    setColumnWidths(normalizeColumnWidths(view.columnWidths));
    setBuilderRequest(null);
    setSaveViewOpen(false);
    setAddViewOpen(false);
  }, []);

  const importSharedView = useCallback((url: string) => {
    const shared = parseSharedViewUrl(url, window.location.href);
    if (!shared) return false;
    const imported: SavedFilterView = { ...shared, id: createId(), name: shared.name.trim() };
    setSavedViews((current) => [...current, imported]);
    applySavedView(imported);
    return true;
  }, [applySavedView]);

  const refreshMetadata = useCallback(async () => {
    const [dayResponse, statusResponse] = await Promise.all([
      fetchJson<{ data: RfqDay[] }>(appPath("/api/days")),
      fetchJson<{ data: SyncStatus | null }>(appPath("/api/sync/status")),
    ]);
    setDays(dayResponse.data);
    setLastSync(statusResponse.data);
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
    return () => {
      active = false;
    };
  }, [refreshMetadata]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setFullDetails(null);
    setPartsPopover(null);
    setPreviewPopover(null);
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    fetchJson<RfqListResponse>(appPath(`/api/rfqs${params.size ? `?${params}` : ""}`))
      .then(({ data }) => {
        setRfqs(data);
      })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setLoading(false));
  }, [fromDate, toDate, dayUpdateVersion]);

  useEffect(() => {
    localStorage.setItem(savedViewsKey, JSON.stringify(savedViews));
  }, [savedViews]);

  useEffect(() => {
    const importLocationView = () => {
      if (!importSharedView(window.location.href)) return;
      window.history.replaceState(window.history.state, "", withoutSharedViewHash(window.location.href));
    };
    importLocationView();
    window.addEventListener("hashchange", importLocationView);
    return () => window.removeEventListener("hashchange", importLocationView);
  }, [importSharedView]);

  useEffect(() => {
    if (activeViewId === "all") {
      setAllRfqsColumnWidths(normalizeColumnWidths(columnWidths));
      return;
    }
    setSavedViews((current) => updateSavedViewState(current, activeViewId, {
      globalQuery,
      group: filterGroup,
      columnFilters,
      columnWidths,
    }));
  }, [activeViewId, globalQuery, filterGroup, columnFilters, columnWidths]);

  useEffect(() => {
    localStorage.setItem(allRfqsColumnWidthsKey, JSON.stringify(allRfqsColumnWidths));
  }, [allRfqsColumnWidths]);

  const filteredRfqs = useMemo(
    () => applyCachedRfqFilters(rfqs, globalQuery, filterGroup, columnFilters),
    [rfqs, globalQuery, filterGroup, columnFilters],
  );
  const estimatedBidValue = useMemo(
    () => filteredRfqs.reduce((total, rfq) => total + (rfq.estimatedValue ?? 0), 0),
    [filteredRfqs],
  );
  const buyerInsights = useMemo(() => buildBuyerInsights(filteredRfqs), [filteredRfqs]);
  const buyersByName = useMemo(() => buyerInsightMap(buyerInsights), [buyerInsights]);
  const filterCount = filterGroup.rules.length + Object.keys(columnFilters).length + (globalQuery.trim() ? 1 : 0);

  const selectAllView = () => {
    setActiveViewId("all");
    setGlobalQuery("");
    setFilterGroup(emptyFilterGroup());
    setColumnFilters({});
    setColumnWidths(normalizeColumnWidths(allRfqsColumnWidths));
    setBuilderRequest(null);
    setSaveViewOpen(false);
    setAddViewOpen(false);
    setGridResetVersion((version) => version + 1);
  };

  const selectSavedView = (view: SavedFilterView) => {
    applySavedView(view);
  };

  const saveCurrentView = (name: string) => {
    const view: SavedFilterView = {
      id: createId(),
      name,
      globalQuery,
      group: cloneFilterGroup(filterGroup),
      columnFilters: { ...columnFilters },
      columnWidths: [...columnWidths],
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
      columnWidths: [...view.columnWidths],
    };
    setSavedViews((current) => [...current, duplicate]);
    selectSavedView(duplicate);
  };

  const createBlankView = (name: string) => {
    const view: SavedFilterView = {
      id: createId(),
      name,
      globalQuery: "",
      group: emptyFilterGroup(),
      columnFilters: {},
      columnWidths: defaultColumnWidths(),
    };
    setSavedViews((current) => [...current, view]);
    applySavedView(view);
  };

  const copySharedView = async (view: SavedFilterView) => {
    const snapshot = activeViewId === view.id ? {
      ...view,
      globalQuery,
      group: cloneFilterGroup(filterGroup),
      columnFilters: { ...columnFilters },
      columnWidths: [...columnWidths],
    } : view;
    try {
      await copyText(createSharedViewUrl(snapshot, window.location.href));
      const message = `Copied ${view.name}`;
      setShareMessage(message);
      window.setTimeout(() => setShareMessage((current) => current === message ? null : current), 2_400);
    } catch {
      const message = "Could not copy link";
      setShareMessage(message);
      window.setTimeout(() => setShareMessage((current) => current === message ? null : current), 2_400);
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
          </div>
        </section>

        <nav className="saved-view-tabs" aria-label="Saved filter tabs">
          <span className={activeViewId === "all" ? "saved-view-tab active" : "saved-view-tab"}>
            <button onClick={selectAllView}>All RFQs</button>
          </span>
          {savedViews.map((view) => (
            <span className={activeViewId === view.id ? "saved-view-tab active" : "saved-view-tab"} key={view.id}>
              <button onClick={() => selectSavedView(view)}>{view.name}</button>
              <button className="share-view-button" onClick={() => copySharedView(view)} aria-label={`Copy ${view.name} view link`} title="Copy share link"><ShareIcon /></button>
              <button className="duplicate-view-button" onClick={() => duplicateSavedView(view)} aria-label={`Duplicate ${view.name} tab`} title="Duplicate tab"><CopyIcon /></button>
              <button className="delete-view-button" onClick={() => deleteSavedView(view.id)} aria-label={`Delete ${view.name} tab`}>×</button>
            </span>
          ))}
          <button
            className={addViewOpen ? "add-tab-button active" : "add-tab-button"}
            onClick={() => {
              setAddViewOpen((open) => !open);
              setSaveViewOpen(false);
            }}
            aria-label="Add filter tab"
            title="Add filter tab"
          >+</button>
          <button className="save-tab-button" onClick={() => { setSaveViewOpen(true); setAddViewOpen(false); }}>
            <SaveIcon /> Save current filter as tab
          </button>
          {shareMessage && <span className="share-view-message" role="status">{shareMessage}</span>}
        </nav>
        {saveViewOpen && <SaveViewPopover onSave={saveCurrentView} onClose={() => setSaveViewOpen(false)} />}
        {addViewOpen && <AddViewPopover onCreate={createBlankView} onImport={importSharedView} onClose={() => setAddViewOpen(false)} />}

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
          <button
            className={buyerTreeOpen ? "buyer-tree-button active" : "buyer-tree-button"}
            onClick={() => {
              setBuyerTreeFocus(null);
              setBuyerTreeOpen((open) => !open);
            }}
          >
            <TreeMapIcon /> Buyer tree
          </button>
          <BuyerTagKey />
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

        {buyerTreeOpen && (
          <BuyerTreemapPanel
            key={buyerTreeFocus ?? "all-buyers"}
            insights={buyerInsights}
            initialBuyer={buyerTreeFocus}
            onClose={() => {
              setBuyerTreeOpen(false);
              setBuyerTreeFocus(null);
            }}
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
                rfqs={rfqs}
                visibleRfqs={filteredRfqs}
                buyerInsights={buyersByName}
                onSelect={(rfq, anchor, field) => {
                  setPartsPopover(null);
                  setPreviewPopover({ rfq, anchor, field });
                }}
                onSelectNsn={(rfq, anchor) => {
                  setPreviewPopover(null);
                  setPartsPopover({ rfq, anchor });
                }}
                columnFilters={columnFilters}
                onColumnFiltersChange={setColumnFilters}
                columnWidths={columnWidths}
                onColumnWidthsChange={setColumnWidths}
                onOpenFilterBuilder={(field) => setBuilderRequest({ field })}
                resetVersion={gridResetVersion}
              />
            </div>
          )}
        </section>
      </main>

      {fullDetails && (
        <RfqDetailsPanel
          rfq={fullDetails.rfq}
          anchor={fullDetails.anchor}
          onClose={() => setFullDetails(null)}
        />
      )}
      {previewPopover && (
        <RfqPreviewPopover
          rfq={previewPopover.rfq}
          anchor={previewPopover.anchor}
          field={previewPopover.field}
          onClose={() => setPreviewPopover(null)}
          onOpenFull={() => {
            setFullDetails({ rfq: previewPopover.rfq, anchor: previewPopover.anchor });
            setPreviewPopover(null);
          }}
          onShowBuyerBreakdown={() => {
            setBuyerTreeFocus(previewPopover.rfq.buyerName);
            setBuyerTreeOpen(true);
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
  onShowBuyerBreakdown,
}: {
  rfq: Rfq;
  anchor: PopoverAnchor;
  field: FilterField;
  onClose: () => void;
  onOpenFull: () => void;
  onShowBuyerBreakdown: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const popoverStyle = useCellAttachedPopover(anchor, panelRef, 520);

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
    { field: "buyerEmail" as const, label: "Buyer email", value: rfq.buyerEmail },
    { field: "supplyChain" as const, label: "Supply chain", value: rfq.supplyChain ?? rfq.agency },
  ].filter((detail) => detail.field !== field);

  return (
    <section
      ref={panelRef}
      className="rfq-preview-popover"
      role="dialog"
      aria-label={`${fieldLabel} for ${rfq.solicitationNumber}`}
      style={popoverStyle}
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
        <a href={appPath(`/api/rfqs/${rfq.id}/pdf`)} target="_blank" rel="noreferrer">
          Source PDF <ArrowUpRight />
        </a>
        <div>
          {field === "buyerName" && rfq.buyerName && (
            <button onClick={onShowBuyerBreakdown}>Show bidder breakdown</button>
          )}
          <button onClick={onOpenFull}>Open full details</button>
        </div>
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
  const popoverStyle = useCellAttachedPopover(anchor, panelRef, 650);

  useEffect(() => {
    const controller = new AbortController();
    setParts([]);
    setError(null);
    setLoading(true);
    fetch(appPath(`/api/rfqs/${rfq.id}/approved-parts`), { signal: controller.signal })
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

  return (
      <section
        ref={panelRef}
        className="approved-parts-popover"
        role="dialog"
        aria-labelledby="parts-title"
        style={popoverStyle}
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
          <a href={appPath(`/api/rfqs/${rfq.id}/pdf`)} target="_blank" rel="noreferrer">Verify in source PDF <ArrowUpRight /></a>
        </div>
      </section>
  );
}

function useCellAttachedPopover(
  anchor: PopoverAnchor,
  panelRef: RefObject<HTMLElement | null>,
  preferredWidth: number,
) {
  const [style, setStyle] = useState<CSSProperties>({
    left: 0,
    top: 0,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    let animationFrame = 0;
    const update = () => {
      const panel = panelRef.current;
      if (!panel || !anchor.element.isConnected) {
        setStyle((current) => current.visibility === "hidden" ? current : { ...current, visibility: "hidden" });
        return;
      }

      const width = Math.min(preferredWidth, Math.max(window.innerWidth - 16, 0));
      panel.style.width = `${width}px`;
      const overlay = panel.getBoundingClientRect();
      const position = placeCellPopover(
        anchor.element.getBoundingClientRect(),
        { width: overlay.width, height: overlay.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      const next: CSSProperties = {
        width,
        left: position.left,
        top: position.top,
        visibility: "visible",
      };
      setStyle((current) => samePopoverStyle(current, next) ? current : next);
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(update);
    };
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    if (panelRef.current) resizeObserver.observe(panelRef.current);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("fast-grid-positionchange", scheduleUpdate);
    update();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("fast-grid-positionchange", scheduleUpdate);
    };
  }, [anchor, panelRef, preferredWidth]);

  return style;
}

function samePopoverStyle(left: CSSProperties, right: CSSProperties) {
  return left.width === right.width && left.left === right.left && left.top === right.top &&
    left.visibility === right.visibility;
}

function RfqDetailsPanel({
  rfq,
  anchor,
  onClose,
}: {
  rfq: Rfq;
  anchor: PopoverAnchor;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const popoverStyle = useCellAttachedPopover(anchor, panelRef, 610);

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

  return (
    <aside
      ref={panelRef}
      className="full-details-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="full-details-title"
      style={popoverStyle}
    >
      <header className="full-details-head">
        <div>
          <span>RFQ details</span>
          <strong id="full-details-title">{rfq.solicitationNumber}</strong>
        </div>
        <button className="popover-close-button" onClick={onClose} aria-label="Close details">×</button>
      </header>

      <section className="full-details-description">
        <span>Item description</span>
        <strong>{rfq.title}</strong>
      </section>

      <div className="full-details-table-wrap">
        <table className="full-details-table">
          <tbody>
            <SpecRow label="NSN" value={rfq.nsn} secondLabel="Purchase request" secondValue={rfq.purchaseRequest} />
            <SpecRow
              label="Quantity"
              value={rfq.quantity === null ? null : rfq.quantity.toLocaleString()}
              secondLabel="Unit"
              secondValue={rfq.unit}
            />
            <SpecRow label="Issued" value={formatLongDate(rfq.issuedDate)} secondLabel="Closes" secondValue={formatLongDate(rfq.closeDate)} />
            <SpecRow
              label="Delivery"
              value={rfq.deliveryDays === null ? null : `${rfq.deliveryDays} days`}
              secondLabel="NAICS"
              secondValue={rfq.naics}
            />
            <SpecRow
              label="Est. unit cost"
              value={formatCurrency(rfq.estimatedUnitPrice)}
              secondLabel="Est. bid value"
              secondValue={formatCurrency(rfq.estimatedValue)}
            />
            <SpecRow label="Buyer" value={rfq.buyerName} secondLabel="Buyer code" secondValue={rfq.buyerCode} />
            <tr className="full-details-wide-row"><th>Buyer email</th><td colSpan={3}>{rfq.buyerEmail || "—"}</td></tr>
            <SpecRow label="Supply chain" value={rfq.supplyChain} secondLabel="Agency" secondValue={rfq.agency} />
            <SpecRow label="Archive date" value={rfq.archiveDate} secondLabel="Source size" secondValue={formatBytes(rfq.fileSize)} />
            <tr className="full-details-wide-row"><th>Source file</th><td colSpan={3}>{rfq.filename}</td></tr>
          </tbody>
        </table>
      </div>

      <footer className="full-details-foot">
        <span>Updated {formatCompactTimestamp(rfq.updatedAt)}</span>
        <a href={appPath(`/api/rfqs/${rfq.id}/pdf`)} target="_blank" rel="noreferrer">
          Open source PDF <ArrowUpRight />
        </a>
      </footer>
    </aside>
  );
}

function SpecRow({
  label,
  value,
  secondLabel,
  secondValue,
}: {
  label: string;
  value: string | null;
  secondLabel: string;
  secondValue: string | null;
}) {
  return <tr><th>{label}</th><td>{value || "—"}</td><th>{secondLabel}</th><td>{secondValue || "—"}</td></tr>;
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

function ShareIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.2 12.8 12.8 7.2M8.1 5.2l1.5-1.5a3.3 3.3 0 0 1 4.7 4.7l-1.5 1.5M11.9 14.8l-1.5 1.5a3.3 3.3 0 0 1-4.7-4.7l1.5-1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

function TreeMapIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="12.5" y="3" width="4.5" height="5" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="3" y="12.5" width="5" height="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="9.5" y="9.5" width="7.5" height="7.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through for browsers that expose Clipboard but block it by policy.
    }
  }
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) throw new Error("Copy failed");
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

function formatCurrency(value: number | null) {
  return value === null ? null : value.toLocaleString("en-US", { style: "currency", currency: "USD" });
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

function parseSqliteTimestamp(value: string) {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

function previewFieldValue(rfq: Rfq, field: FilterField) {
  if (field === "approvedPartNumber") return rfq.approvedPartNumbers.join(", ") || "—";
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
    return parseSavedViews(localStorage.getItem(savedViewsKey));
  } catch {
    return [];
  }
}

function loadAllRfqsColumnWidths() {
  try {
    return parseColumnWidths(localStorage.getItem(allRfqsColumnWidthsKey));
  } catch {
    return defaultColumnWidths();
  }
}
