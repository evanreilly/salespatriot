import { FilterCell, Grid, HeaderCell } from "fast-grid";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Rfq } from "../shared/rfq";
import { bidSizeTier, spendTierLabel, type BuyerInsight } from "./buyerInsights";
import { columnFields, type FilterField } from "./filters";
import {
  DEFAULT_COLUMN_WIDTH,
  clampColumnWidth,
  fittedWidthFromMeasurements,
  normalizeColumnWidths,
} from "./gridLayout";
import { gridRows, rfqCellValues } from "./gridData";
import { sortRuleKey, type SortRule } from "./gridSort";

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

type Props = {
  rfqs: Rfq[];
  visibleRfqs: Rfq[];
  buyerInsights: Map<string, BuyerInsight>;
  onSelect: (rfq: Rfq, anchor: PopoverAnchor, field: FilterField) => void;
  onSelectNsn: (rfq: Rfq, anchor: PopoverAnchor) => void;
  columnFilters: Record<number, string>;
  onColumnFiltersChange: (filters: Record<number, string>) => void;
  columnWidths: number[];
  onColumnWidthsChange: (widths: number[]) => void;
  onOpenFilterBuilder: (field: FilterField) => void;
  resetVersion: number;
};

export type PopoverAnchor = { element: HTMLElement };

export function FastGrid({
  rfqs,
  visibleRfqs,
  buyerInsights,
  onSelect,
  onSelectNsn,
  columnFilters,
  onColumnFiltersChange,
  columnWidths,
  onColumnWidthsChange,
  onOpenFilterBuilder,
  resetVersion,
}: Props) {
  const [sortRules, setSortRules] = useState<SortRule[]>([]);
  const baseIndexes = useMemo(() => new Map(rfqs.map((rfq, index) => [rfq, index])), [rfqs]);
  const visibleIndexes = useMemo(
    () => indexesForView(rfqs, visibleRfqs, baseIndexes),
    [baseIndexes, rfqs, visibleRfqs],
  );
  const [orderedIndexes, setOrderedIndexes] = useState<Uint32Array<ArrayBufferLike>>(visibleIndexes);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<Grid | null>(null);
  const sortWorkerRef = useRef<Worker | null>(null);
  const sortGenerationRef = useRef(0);
  const sortRequestRef = useRef(0);
  const activeSortRequestRef = useRef(0);
  const sortRequestsRef = useRef(new Map<number, { view: Rfq[]; key: string }>());
  const recordsRef = useRef<Rfq[]>(rfqs);
  const visibleRecordsRef = useRef<Rfq[]>(visibleRfqs);
  const buyerInsightsRef = useRef(buyerInsights);
  const sortRulesRef = useRef(sortRules);
  const columnWidthsRef = useRef(normalizeColumnWidths(columnWidths));
  const onSelectRef = useRef(onSelect);
  const onSelectNsnRef = useRef(onSelectNsn);
  const onColumnFiltersChangeRef = useRef(onColumnFiltersChange);
  const onColumnWidthsChangeRef = useRef(onColumnWidthsChange);
  const onOpenFilterBuilderRef = useRef(onOpenFilterBuilder);

  recordsRef.current = rfqs;
  visibleRecordsRef.current = visibleRfqs;
  buyerInsightsRef.current = buyerInsights;
  sortRulesRef.current = sortRules;
  onSelectRef.current = onSelect;
  onSelectNsnRef.current = onSelectNsn;
  onColumnFiltersChangeRef.current = onColumnFiltersChange;
  onColumnWidthsChangeRef.current = onColumnWidthsChange;
  onOpenFilterBuilderRef.current = onOpenFilterBuilder;

  useEffect(() => {
    const worker = new Worker(new URL("./gridSort.worker.ts", import.meta.url), { type: "module" });
    sortWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{
      type: "sorted";
      generation: number;
      requestId: number;
      indexes: Uint32Array;
    }>) => {
      const message = event.data;
      if (message.type !== "sorted" || message.generation !== sortGenerationRef.current) return;
      const request = sortRequestsRef.current.get(message.requestId);
      sortRequestsRef.current.delete(message.requestId);
      if (!request) return;
      rememberSortedIndexes(request.view, request.key, message.indexes);
      if (message.requestId === activeSortRequestRef.current) setOrderedIndexes(message.indexes);
    };
    return () => {
      worker.terminate();
      sortWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = sortWorkerRef.current;
    if (!worker) return;
    sortGenerationRef.current += 1;
    const generation = sortGenerationRef.current;
    sortRequestsRef.current.clear();
    worker.postMessage({
      type: "set-data",
      generation,
      values: rfqs.map(rfqCellValues),
    });
  }, [rfqs]);

  useEffect(() => {
    const key = sortRuleKey(sortRules);
    if (!key) {
      activeSortRequestRef.current = 0;
      setOrderedIndexes(visibleIndexes);
      return;
    }
    const cached = recallSortedIndexes(visibleRfqs, key);
    if (cached) {
      activeSortRequestRef.current = 0;
      setOrderedIndexes(cached);
      return;
    }

    // Update the tab immediately in its natural order. The worker replaces
    // this compact index array with the cached/sorted order when ready.
    setOrderedIndexes(visibleIndexes);
    const worker = sortWorkerRef.current;
    if (!worker) return;
    const requestId = sortRequestRef.current + 1;
    sortRequestRef.current = requestId;
    activeSortRequestRef.current = requestId;
    sortRequestsRef.current.set(requestId, { view: visibleRfqs, key });
    const indexes = visibleIndexes.slice();
    worker.postMessage({
      type: "sort",
      generation: sortGenerationRef.current,
      requestId,
      viewId: viewIdFor(visibleRfqs, rfqs),
      indexes,
      rules: sortRules,
    }, [indexes.buffer]);
  }, [rfqs, sortRules, visibleIndexes, visibleRfqs]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const grid = new Grid(container, [], headers);
    gridRef.current = grid;

    installVariableColumnLayout(grid, columnWidthsRef);

    const setColumnWidth = (column: number, width: number) => {
      const nextWidths = [...columnWidthsRef.current];
      nextWidths[column] = clampColumnWidth(width);
      if (nextWidths[column] === columnWidthsRef.current[column]) return;
      columnWidthsRef.current = nextWidths;
      refreshColumnLayout(grid, nextWidths);
      onColumnWidthsChangeRef.current([...nextWidths]);
    };
    const fitColumn = (column: number) => {
      const fittedWidth = measureFittedColumnWidth(grid, column, visibleRecordsRef.current);
      const currentWidth = columnWidthsRef.current[column] ?? DEFAULT_COLUMN_WIDTH;
      setColumnWidth(column, currentWidth === fittedWidth ? DEFAULT_COLUMN_WIDTH : fittedWidth);
    };
    const startColumnResize = (event: MouseEvent, column: number) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = columnWidthsRef.current[column] ?? DEFAULT_COLUMN_WIDTH;
      document.body.classList.add("column-resizing");

      const onMove = (moveEvent: MouseEvent) => {
        setColumnWidth(column, startWidth + moveEvent.clientX - startX);
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
      const anchor = { element: cell.el };
      if (cell?.id === 2 && rfq.nsn) {
        onSelectNsnRef.current(rfq, anchor);
        return;
      }
      const field = columnFields[cell.id];
      if (field) onSelectRef.current(rfq, anchor, field);
    };
    const handleFilterInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const filterCell = Object.values(grid.headerRows[0]?.cellComponentMap ?? {})
        .find((candidate) => candidate instanceof FilterCell && candidate.input === target);
      if (!(filterCell instanceof FilterCell)) return;
      event.stopImmediatePropagation();
      const next = { ...grid.rowManager.view.filter };
      if (target.value) next[filterCell.index] = target.value;
      else delete next[filterCell.index];
      grid.rowManager.view.filter = next;
      onColumnFiltersChangeRef.current({ ...next });
    };
    const decorate = () => {
      decorateFilterCells(grid, onOpenFilterBuilderRef, sortRulesRef.current);
      decorateHeaderCells(grid, fitColumn, startColumnResize);
      decorateSolicitationCells(grid, recordsRef.current);
      decorateBuyerCells(grid, recordsRef.current, buyerInsightsRef.current);
      applyColumnLayout(grid, columnWidthsRef.current);
    };
    const observer = new MutationObserver(() => queueMicrotask(decorate));
    observer.observe(container, { childList: true, subtree: true });
    container.addEventListener("click", handleSortClick, true);
    container.addEventListener("click", handleClick);
    container.addEventListener("input", handleFilterInput, true);
    decorate();

    return () => {
      observer.disconnect();
      container.removeEventListener("click", handleSortClick, true);
      container.removeEventListener("click", handleClick);
      container.removeEventListener("input", handleFilterInput, true);
      grid.destroy();
      gridRef.current = null;
    };
  }, []);

  useEffect(() => {
    const nextWidths = normalizeColumnWidths(columnWidths);
    if (sameWidths(nextWidths, columnWidthsRef.current)) return;
    columnWidthsRef.current = nextWidths;
    const grid = gridRef.current;
    if (grid) refreshColumnLayout(grid, nextWidths);
  }, [columnWidths]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.rowManager.isViewResult = false;
    grid.rowManager.setRows(gridRows(rfqs), true);
  }, [rfqs]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const buffer = grid.rowManager.viewBuffer.buffer;
    for (let index = 0; index < orderedIndexes.length; index += 1) {
      Atomics.store(buffer, index, orderedIndexes[index]);
    }
    const count = orderedIndexes.length;
    grid.rowManager.viewBuffer.numRows = count;
    grid.rowManager.isViewResult = true;
    grid.rowManager.view.filter = { ...columnFilters };
    grid.rowManager.view.sort = [];
    syncFilterCells(grid);
    syncSortIndicators(grid, sortRules);
    grid.scrollbar.setScrollOffsetY(Math.min(grid.offsetY, Math.max(0, count * 32 - grid.viewportHeight)));
    grid.renderViewportRows();
    refreshRenderedRows(grid);
    grid.renderViewportCells();
    grid.scrollbar.refreshThumb();
    decorateSolicitationCells(grid, rfqs);
    decorateBuyerCells(grid, rfqs, buyerInsights);
  }, [buyerInsights, columnFilters, orderedIndexes, rfqs, sortRules]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || sameFilters(grid.rowManager.view.filter, columnFilters)) return;
    applyColumnFilterView(grid, columnFilters);
  }, [columnFilters]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || resetVersion === 0) return;
    setSortRules([]);

    grid.rowManager.view.sort = [];
    grid.rowManager.view.filter = {};
    syncFilterCells(grid);
    resetSortIndicators(grid);
    grid.scrollbar.setScrollOffsetY(0);
    grid.scrollbar.setScrollOffsetX(0);
    grid.renderViewportRows();
    refreshRenderedRows(grid);
    grid.renderViewportCells();
    grid.scrollbar.refreshThumb();
    decorateSolicitationCells(grid, recordsRef.current);
    decorateBuyerCells(grid, recordsRef.current, buyerInsightsRef.current);
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
  fitColumn: (column: number) => void,
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
        fitColumn(Number(button?.dataset.column));
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
    button.title = "Click to fit this column's content; click again to restore the standard width";
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
    grid.container.dispatchEvent(new Event("fast-grid-positionchange", { bubbles: true }));
  };
  grid.renderViewportCells = () => {
    baseRenderCells();
    applyColumnLayout(grid, widthsRef.current);
    grid.container.dispatchEvent(new Event("fast-grid-positionchange", { bubbles: true }));
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

function measureFittedColumnWidth(grid: Grid, column: number, rfqs: Rfq[]) {
  const measurements: number[] = [];
  const header = grid.headerRows[1]?.cellComponentMap[column];
  const headerButton = header?.el.querySelector<HTMLElement>(".column-title-button");
  if (headerButton) {
    measurements.push(
      measureTextBox(headerButton, headers[column] ?? "") + horizontalBorderWidth(header.el),
    );
  }

  const filter = grid.headerRows[0]?.cellComponentMap[column];
  if (filter instanceof FilterCell) {
    const filterText = filter.input.value || filter.input.placeholder;
    const fixedControlWidth = Array.from(filter.el.children).reduce((total, child) => {
      if (child === filter.input) return total;
      return total + child.getBoundingClientRect().width;
    }, 0);
    measurements.push(
      measureTextBox(filter.input, filterText) +
        fixedControlWidth +
        horizontalBoxInset(filter.el),
    );
  }

  const renderedCell = Object.values(grid.rowComponentMap)
    .map((row) => row.cellComponentMap[column])
    .find((cell) => cell !== undefined);
  const contentElement = renderedCell?.el ?? filter?.el;
  if (contentElement) {
    for (const rfq of rfqs) {
      measurements.push(measureTextBox(contentElement, String(rfqCellValues(rfq)[column] ?? "")));
    }
  }

  return fittedWidthFromMeasurements(measurements.map((width) => width + 2));
}

let measurementCanvas: HTMLCanvasElement | undefined;

function measureTextBox(element: HTMLElement, value: string) {
  const style = window.getComputedStyle(element);
  const canvas = measurementCanvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return element.scrollWidth;
  context.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const letterSpacing = Number.parseFloat(style.letterSpacing);
  const extraLetterSpacing = Number.isFinite(letterSpacing)
    ? Math.max(value.length - 1, 0) * letterSpacing
    : 0;
  return context.measureText(value).width + extraLetterSpacing + horizontalBoxInset(element);
}

function horizontalBoxInset(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  return cssPixels(style.paddingLeft) + cssPixels(style.paddingRight) + horizontalBorderWidth(element);
}

function horizontalBorderWidth(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  return cssPixels(style.borderLeftWidth) + cssPixels(style.borderRightWidth);
}

function cssPixels(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sameWidths(left: number[], right: number[]) {
  return left.length === right.length && left.every((width, index) => width === right[index]);
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

function decorateBuyerCells(grid: Grid, rfqs: Rfq[], insights: Map<string, BuyerInsight>) {
  for (const row of Object.values(grid.rowComponentMap)) {
    const cell = row.cellComponentMap[6];
    const rfq = rfqs[row.id];
    if (!cell || !rfq?.buyerName) continue;
    const insight = insights.get(rfq.buyerName);
    cell.el.classList.add("buyer-cell");
    let tags = cell.el.querySelector<HTMLElement>(".buyer-cell-tags");
    if (!tags) {
      tags = document.createElement("span");
      tags.className = "buyer-cell-tags";
      cell.el.appendChild(tags);
    }
    const relationship = insight?.relationship
      ? '<span class="buyer-tag relationship-tag" title="Prior relationship / win">REL</span>'
      : "";
    const bidValue = Math.max(0, rfq.estimatedValue ?? 0);
    const tier = bidSizeTier(bidValue);
    const spend = tier
      ? `<span class="buyer-tag spend-tag tier-${tier}" title="${formatBuyerSpend(bidValue)} estimated value for this RFQ">${spendTierLabel(tier)}</span>`
      : "";
    const markup = `${relationship}${spend}`;
    if (tags.innerHTML !== markup) tags.innerHTML = markup;
  }
}

function formatBuyerSpend(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function syncFilterCells(grid: Grid) {
  for (const candidate of Object.values(grid.headerRows[0]?.cellComponentMap ?? {})) {
    if (candidate instanceof FilterCell) candidate.syncToFilter();
  }
}

function applyColumnFilterView(grid: Grid, filters: Record<number, string>) {
  grid.rowManager.view.filter = { ...filters };
  syncFilterCells(grid);
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

const sortedIndexCache = new WeakMap<Rfq[], Map<string, Uint32Array<ArrayBufferLike>>>();
const visibleIndexCache = new WeakMap<Rfq[], { base: Rfq[]; indexes: Uint32Array }>();
const gridViewIds = new WeakMap<Rfq[], number>();
let nextGridViewId = 1;

function indexesForView(base: Rfq[], view: Rfq[], baseIndexes: Map<Rfq, number>) {
  const cached = visibleIndexCache.get(view);
  if (cached?.base === base) return cached.indexes;
  const indexes = new Uint32Array(view.length);
  let count = 0;
  for (const rfq of view) {
    const index = baseIndexes.get(rfq);
    if (index === undefined) continue;
    indexes[count] = index;
    count += 1;
  }
  const result = count === indexes.length ? indexes : indexes.slice(0, count);
  visibleIndexCache.set(view, { base, indexes: result });
  return result;
}

function rememberSortedIndexes(
  view: Rfq[],
  key: string,
  indexes: Uint32Array<ArrayBufferLike>,
) {
  let cache = sortedIndexCache.get(view);
  if (!cache) {
    cache = new Map();
    sortedIndexCache.set(view, cache);
  }
  if (cache.size >= 32) cache.delete(cache.keys().next().value as string);
  cache.set(key, indexes);
}

function recallSortedIndexes(view: Rfq[], key: string) {
  return sortedIndexCache.get(view)?.get(key);
}

function viewIdFor(view: Rfq[], base: Rfq[]) {
  if (view === base) return 0;
  const existing = gridViewIds.get(view);
  if (existing !== undefined) return existing;
  const id = nextGridViewId;
  nextGridViewId += 1;
  gridViewIds.set(view, id);
  return id;
}
