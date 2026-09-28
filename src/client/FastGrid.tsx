import { FilterCell, Grid, HeaderCell, type Row } from "fast-grid";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Rfq } from "../shared/rfq";
import { columnFields, type FilterField } from "./filters";

const headers = [
  "Solicitation",
  "Item description",
  "NSN",
  "Quantity",
  "Unit",
  "Closes",
  "Buyer",
  "Supply chain",
  "NAICS",
  "Delivery days",
];

const defaultColumnWidth = 200;
const minimumColumnWidth = 90;
const maximumColumnWidth = 560;

type Props = {
  rfqs: Rfq[];
  onSelect: (rfq: Rfq, anchor: PopoverAnchor, field: FilterField) => void;
  onSelectNsn: (rfq: Rfq, anchor: PopoverAnchor) => void;
  onFilteredChange: (rfqs: Rfq[]) => void;
  columnFilters: Record<number, string>;
  onColumnFiltersChange: (filters: Record<number, string>) => void;
  onOpenFilterBuilder: (field: FilterField) => void;
  resetVersion: number;
  viewVersion: number;
};

export type PopoverAnchor = { left: number; right: number; top: number; bottom: number };

type SortRule = { column: number; direction: "ascending" | "descending" };

export function FastGrid({
  rfqs,
  onSelect,
  onSelectNsn,
  onFilteredChange,
  columnFilters,
  onColumnFiltersChange,
  onOpenFilterBuilder,
  resetVersion,
  viewVersion,
}: Props) {
  const [sortRules, setSortRules] = useState<SortRule[]>([]);
  const orderedRfqs = useMemo(() => sortRfqs(rfqs, sortRules), [rfqs, sortRules]);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<Grid | null>(null);
  const recordsRef = useRef<Rfq[]>(orderedRfqs);
  const sortRulesRef = useRef(sortRules);
  const columnWidthsRef = useRef(headers.map(() => defaultColumnWidth));
  const autoFitColumnsRef = useRef(new Set<number>());
  const onSelectRef = useRef(onSelect);
  const onSelectNsnRef = useRef(onSelectNsn);
  const onFilteredChangeRef = useRef(onFilteredChange);
  const onColumnFiltersChangeRef = useRef(onColumnFiltersChange);
  const onOpenFilterBuilderRef = useRef(onOpenFilterBuilder);

  recordsRef.current = orderedRfqs;
  sortRulesRef.current = sortRules;
  onSelectRef.current = onSelect;
  onSelectNsnRef.current = onSelectNsn;
  onFilteredChangeRef.current = onFilteredChange;
  onColumnFiltersChangeRef.current = onColumnFiltersChange;
  onOpenFilterBuilderRef.current = onOpenFilterBuilder;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const grid = new Grid(container, [], headers);
    gridRef.current = grid;

    installVariableColumnLayout(grid, columnWidthsRef);

    const setColumnWidth = (column: number, width: number, autoFit: boolean) => {
      columnWidthsRef.current[column] = Math.max(
        minimumColumnWidth,
        Math.min(maximumColumnWidth, Math.round(width)),
      );
      if (autoFit) autoFitColumnsRef.current.add(column);
      else autoFitColumnsRef.current.delete(column);
      refreshColumnLayout(grid, columnWidthsRef.current);
    };
    const toggleAutoFit = (column: number) => {
      if (autoFitColumnsRef.current.has(column)) {
        setColumnWidth(column, defaultColumnWidth, false);
        return;
      }
      setColumnWidth(column, fittedColumnWidth(column, recordsRef.current), true);
    };
    const startColumnResize = (event: MouseEvent, column: number) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = columnWidthsRef.current[column] ?? defaultColumnWidth;
      autoFitColumnsRef.current.delete(column);
      document.body.classList.add("column-resizing");

      const onMove = (moveEvent: MouseEvent) => {
        setColumnWidth(column, startWidth + moveEvent.clientX - startX, false);
      };
      const onUp = () => {
        document.body.classList.remove("column-resizing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    const handleSortClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const control = target.closest<HTMLElement>(".column-sort-button");
      if (!control || !container.contains(control)) return;
      event.preventDefault();
      event.stopPropagation();
      const column = Number(control.dataset.column);
      if (!Number.isInteger(column)) return;
      setSortRules((current) => toggleSortRule(current, column));
    };
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const component = Object.values(grid.rowComponentMap).find((row) => row.el.contains(target));
      const rfq = component ? recordsRef.current[component.id] : undefined;
      if (!component || !rfq) return;
      const cell = Object.values(component.cellComponentMap).find((candidate) => candidate.el.contains(target));
      if (!cell) return;
      const rect = cell.el.getBoundingClientRect();
      const anchor = {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
      if (cell?.id === 2 && rfq.nsn) {
        onSelectNsnRef.current(rfq, anchor);
        return;
      }
      const field = columnFields[cell.id];
      if (field) onSelectRef.current(rfq, anchor, field);
    };
    const handleFilterInput = () => {
      queueMicrotask(() => {
        onColumnFiltersChangeRef.current({ ...grid.rowManager.view.filter });
        notifyFilteredRows(grid, recordsRef.current, onFilteredChangeRef.current);
        window.setTimeout(() => {
          refreshRenderedRows(grid);
          decorateSolicitationCells(grid, recordsRef.current);
        }, 50);
      });
    };
    const decorate = () => {
      decorateFilterCells(grid, onOpenFilterBuilderRef, sortRulesRef.current);
      decorateHeaderCells(grid, toggleAutoFit, startColumnResize);
      decorateSolicitationCells(grid, recordsRef.current);
      applyColumnLayout(grid, columnWidthsRef.current);
    };
    const observer = new MutationObserver(() => queueMicrotask(decorate));
    observer.observe(container, { childList: true, subtree: true });
    container.addEventListener("click", handleSortClick, true);
    container.addEventListener("click", handleClick);
    container.addEventListener("input", handleFilterInput);
    decorate();

    return () => {
      observer.disconnect();
      container.removeEventListener("click", handleSortClick, true);
      container.removeEventListener("click", handleClick);
      container.removeEventListener("input", handleFilterInput);
      grid.destroy();
      gridRef.current = null;
    };
  }, []);

  useEffect(() => {
    const rows: Row[] = orderedRfqs.map((rfq, id) => ({
      id,
      cells: rfqCellValues(rfq).map((value, cellId) => ({ id: cellId, v: value })),
    }));
    const grid = gridRef.current;
    if (!grid) return;
    grid.rowManager.setRows(rows);
    applyColumnFilterView(grid, columnFilters);
    syncSortIndicators(grid, sortRules);
    window.setTimeout(() => refreshRenderedRows(grid), 50);
    decorateSolicitationCells(grid, orderedRfqs);
    notifyFilteredRows(grid, orderedRfqs, onFilteredChangeRef.current);
  }, [orderedRfqs, viewVersion]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || sameFilters(grid.rowManager.view.filter, columnFilters)) return;
    applyColumnFilterView(grid, columnFilters);
    window.setTimeout(() => refreshRenderedRows(grid), 50);
    notifyFilteredRows(grid, recordsRef.current, onFilteredChangeRef.current);
  }, [columnFilters]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || resetVersion === 0) return;
    setSortRules([]);

    // Supersede any filter still running in Fast Grid's worker. An empty view
    // is handled only on the main thread, so posting an identity filter keeps
    // a stale result from the previous tab from reappearing after reset.
    grid.rowManager.view.sort = [];
    grid.rowManager.view.filter = { 0: "" };
    void grid.rowManager.runFilter();
    grid.rowManager.view.filter = {};
    grid.rowManager.isViewResult = false;
    syncFilterCells(grid);
    resetSortIndicators(grid);
    grid.scrollbar.setScrollOffsetY(0);
    grid.scrollbar.setScrollOffsetX(0);
    grid.renderViewportRows();
    refreshRenderedRows(grid);
    grid.renderViewportCells();
    grid.scrollbar.refreshThumb();
    decorateSolicitationCells(grid, recordsRef.current);
    notifyFilteredRows(grid, recordsRef.current, onFilteredChangeRef.current);
  }, [resetVersion]);

  return (
    <div className="grid-shell">
      <div ref={containerRef} className="rfq-grid" aria-label="RFQs for selected day" />
    </div>
  );
}

function decorateFilterCells(
  grid: Grid,
  openBuilderRef: MutableRefObject<(field: FilterField) => void>,
  sortRules: SortRule[],
) {
  for (const candidate of Object.values(grid.headerRows[0]?.cellComponentMap ?? {})) {
    if (!(candidate instanceof FilterCell)) continue;
    candidate.input.classList.add("quick-filter-input");
    let button = candidate.el.querySelector<HTMLButtonElement>(".column-filter-button");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "column-filter-button";
      button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14l-5.4 6.1v4.6l-3.2 1.6v-6.2L3 4Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const field = columnFields[candidate.index];
        if (field) openBuilderRef.current(field);
      });
      candidate.el.insertBefore(button, candidate.arrow.parentElement);
    }
    button.title = `Build ${headers[candidate.index] ?? "column"} filter`;
    button.setAttribute("aria-label", button.title);
    const sortButton = candidate.arrow.parentElement;
    if (sortButton) {
      sortButton.classList.add("column-sort-button");
      sortButton.dataset.column = String(candidate.index);
      sortButton.setAttribute("role", "button");
      sortButton.setAttribute("aria-label", `Sort by ${headers[candidate.index] ?? "column"}`);
    }
  }
  syncSortIndicators(grid, sortRules);
}

function decorateHeaderCells(
  grid: Grid,
  toggleAutoFit: (column: number) => void,
  startResize: (event: MouseEvent, column: number) => void,
) {
  for (const candidate of Object.values(grid.headerRows[1]?.cellComponentMap ?? {})) {
    if (!(candidate instanceof HeaderCell)) continue;
    candidate.el.classList.add("column-title-cell");

    let button = candidate.el.querySelector<HTMLButtonElement>(".column-title-button");
    if (!button) {
      candidate.el.textContent = "";
      button = document.createElement("button");
      button.type = "button";
      button.className = "column-title-button";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleAutoFit(Number(button?.dataset.column));
      });
      candidate.el.appendChild(button);

      const resizeHandle = document.createElement("span");
      resizeHandle.className = "column-resize-handle";
      resizeHandle.setAttribute("aria-hidden", "true");
      resizeHandle.addEventListener("mousedown", (event) => {
        startResize(event, Number(resizeHandle.dataset.column));
      });
      candidate.el.appendChild(resizeHandle);
    }

    button.dataset.column = String(candidate.id);
    const title = headers[candidate.id] ?? "Column";
    if (button.textContent !== title) button.textContent = title;
    button.title = "Click to fit content; click again to restore the standard width";
    const resizeHandle = candidate.el.querySelector<HTMLElement>(".column-resize-handle");
    if (resizeHandle) resizeHandle.dataset.column = String(candidate.id);
  }
}

function installVariableColumnLayout(
  grid: Grid,
  widthsRef: MutableRefObject<number[]>,
) {
  const baseGetState = grid.getState;
  const baseRenderRows = grid.renderViewportRows;
  const baseRenderCells = grid.renderViewportCells;

  grid.getState = () => {
    const state = baseGetState();
    const widths = widthsRef.current;
    const offsets = columnOffsets(widths);
    const tableWidth = offsets[offsets.length - 1] ?? 0;
    const viewportWidth = grid.viewportWidth;
    const scrollableWidth = Math.max(tableWidth - viewportWidth, 0);
    grid.offsetX = Math.max(0, Math.min(grid.offsetX, scrollableWidth));

    let startCell = 0;
    while (
      startCell < widths.length - 1 &&
      (offsets[startCell + 1] ?? tableWidth) <= grid.offsetX
    ) {
      startCell += 1;
    }
    startCell = Math.max(0, startCell - 1);

    let endCell = startCell;
    const viewportEnd = grid.offsetX + viewportWidth;
    while (endCell < widths.length && (offsets[endCell] ?? tableWidth) < viewportEnd) {
      endCell += 1;
    }
    endCell = Math.min(widths.length, endCell + 1);

    const thumbSizeX = Math.round(
      Math.max(Math.min((viewportWidth / Math.max(tableWidth, 1)) * viewportWidth, viewportWidth), 30),
    );
    const thumbOffsetX =
      scrollableWidth === 0 ? 0 : (grid.offsetX / scrollableWidth) * (viewportWidth - thumbSizeX);

    state.startCell = startCell;
    state.endCell = endCell;
    state.cellOffset = 0;
    state.tableWidth = tableWidth;
    state.scrollableWidth = scrollableWidth;
    state.thumbSizeX = thumbSizeX;
    state.thumbOffsetX = thumbOffsetX;
    return state;
  };

  grid.renderViewportRows = () => {
    baseRenderRows();
    applyColumnLayout(grid, widthsRef.current);
  };
  grid.renderViewportCells = () => {
    baseRenderCells();
    applyColumnLayout(grid, widthsRef.current);
  };
}

function refreshColumnLayout(grid: Grid, widths: number[]) {
  grid.scrollbar.setScrollOffsetX(grid.offsetX);
  grid.renderViewportRows();
  grid.renderViewportCells();
  applyColumnLayout(grid, widths);
  grid.scrollbar.refreshThumb();
}

function applyColumnLayout(grid: Grid, widths: number[]) {
  const offsets = columnOffsets(widths);
  const rows = [...grid.headerRows, ...Object.values(grid.rowComponentMap)];
  for (const row of rows) {
    for (const cell of Object.values(row.cellComponentMap)) {
      const width = widths[cell.id];
      const offset = offsets[cell.id];
      if (width === undefined || offset === undefined) continue;
      cell.el.style.width = `${width}px`;
      cell.el.style.transform = `translateX(${offset - grid.offsetX}px)`;
    }
  }
}

function columnOffsets(widths: number[]) {
  const offsets = [0];
  for (const width of widths) offsets.push((offsets[offsets.length - 1] ?? 0) + width);
  return offsets;
}

function fittedColumnWidth(column: number, rfqs: Rfq[]) {
  const values = [headers[column] ?? "", ...rfqs.map((rfq) => rfqCellValues(rfq)[column] ?? "")];
  const longest = values.reduce<number>(
    (length, value) => Math.max(length, String(value).length),
    0,
  );
  return Math.max(minimumColumnWidth, Math.min(maximumColumnWidth, longest * 7.4 + 34));
}

function decorateSolicitationCells(grid: Grid, rfqs: Rfq[]) {
  for (const row of Object.values(grid.rowComponentMap)) {
    const cell = row.cellComponentMap[0];
    const rfq = rfqs[row.id];
    if (!cell || !rfq) continue;
    cell.el.classList.add("solicitation-cell");
    let link = cell.el.querySelector<HTMLAnchorElement>(".row-pdf-button");
    if (!link) {
      link = document.createElement("a");
      link.className = "row-pdf-button";
      link.target = "_blank";
      link.rel = "noreferrer";
      link.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 2.8h5.6l3.4 3.4v11H5.5v-14.4Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11 2.8v3.6h3.5M7.8 10h4.5M7.8 12.7h4.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
      link.addEventListener("click", (event) => event.stopPropagation());
      cell.el.appendChild(link);
    }
    link.href = `/api/rfqs/${rfq.id}/pdf`;
    link.title = `Open ${rfq.solicitationNumber} PDF`;
    link.setAttribute("aria-label", link.title);
  }
}

function syncFilterCells(grid: Grid) {
  for (const candidate of Object.values(grid.headerRows[0]?.cellComponentMap ?? {})) {
    if (candidate instanceof FilterCell) candidate.syncToFilter();
  }
}

function applyColumnFilterView(grid: Grid, filters: Record<number, string>) {
  const previousHadFilters = Object.keys(grid.rowManager.view.filter).length > 0;
  const hasFilters = Object.keys(filters).length > 0;

  if (!hasFilters && previousHadFilters) {
    // Fast Grid computes views in a worker. Posting an identity filter first
    // invalidates any result still in flight from the previously selected tab.
    grid.rowManager.view.filter = { 0: "" };
    void grid.rowManager.runFilter();
  }

  grid.rowManager.view.filter = { ...filters };
  grid.rowManager.isViewResult = false;
  syncFilterCells(grid);
  grid.renderViewportRows();
  refreshRenderedRows(grid);
  grid.renderViewportCells();
  grid.scrollbar.refreshThumb();

  if (hasFilters) void grid.rowManager.runFilter();
}

function resetSortIndicators(grid: Grid) {
  syncSortIndicators(grid, []);
}

function syncSortIndicators(grid: Grid, sortRules: SortRule[]) {
  for (const candidate of Object.values(grid.headerRows[0]?.cellComponentMap ?? {})) {
    if (!(candidate instanceof FilterCell)) continue;
    const rule = sortRules.find((entry) => entry.column === candidate.index);
    candidate.arrow.style.transform =
      rule?.direction === "descending"
        ? "rotate(180deg)"
        : rule?.direction === "ascending"
          ? "rotate(0deg)"
          : "rotate(90deg)";
  }
}

function refreshRenderedRows(grid: Grid) {
  for (const component of Object.values(grid.rowComponentMap)) {
    const row = grid.rowManager.rows[component.id];
    if (!row) continue;
    component.cells = row.cells;
    for (const cellComponent of Object.values(component.cellComponentMap)) {
      const cell = row.cells[cellComponent.id];
      if (cell) cellComponent.setContent(cell.v);
    }
  }
}

function sameFilters(left: Record<number, string>, right: Record<number, string>) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function notifyFilteredRows(grid: Grid, rfqs: Rfq[], onChange: (rfqs: Rfq[]) => void) {
  const filters = grid.rowManager.view.filter;
  if (Object.keys(filters).length === 0) {
    onChange(rfqs);
    return;
  }

  onChange(
    rfqs.filter((_, rowIndex) => {
      const row = grid.rowManager.rows[rowIndex];
      if (!row) return false;
      return Object.entries(filters).every(([column, value]) =>
        String(row.cells[Number(column)]?.v ?? "")
          .toLowerCase()
          .includes(value.toLowerCase()),
      );
    }),
  );
}

function formatShortDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function rfqCellValues(rfq: Rfq) {
  return [
    rfq.solicitationNumber,
    rfq.title,
    rfq.nsn ?? "—",
    rfq.quantity ?? "—",
    rfq.unit ?? "—",
    formatShortDate(rfq.closeDate),
    rfq.buyerName ?? "—",
    rfq.supplyChain ?? rfq.agency ?? "—",
    rfq.naics ?? "—",
    rfq.deliveryDays ?? "—",
  ];
}

function toggleSortRule(sortRules: SortRule[], column: number): SortRule[] {
  const existing = sortRules.find((rule) => rule.column === column);
  if (!existing) return [...sortRules, { column, direction: "descending" }];
  if (existing.direction === "descending") {
    return sortRules.map((rule) =>
      rule.column === column ? { ...rule, direction: "ascending" } : rule,
    );
  }
  return sortRules.filter((rule) => rule.column !== column);
}

const gridCollator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

function sortRfqs(rfqs: Rfq[], sortRules: SortRule[]) {
  if (sortRules.length === 0) return rfqs;
  return rfqs
    .map((rfq, index) => ({ rfq, index, values: rfqCellValues(rfq) }))
    .sort((left, right) => {
      for (const rule of sortRules) {
        const comparison = gridCollator.compare(
          String(left.values[rule.column] ?? ""),
          String(right.values[rule.column] ?? ""),
        );
        if (comparison !== 0) return rule.direction === "ascending" ? comparison : -comparison;
      }
      return left.index - right.index;
    })
    .map(({ rfq }) => rfq);
}
