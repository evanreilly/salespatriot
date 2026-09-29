import type { FilterGroup, SavedFilterView } from "./filters.js";
import { normalizeColumnWidths } from "./gridLayout.js";

export type SavedViewState = Pick<
  SavedFilterView,
  "globalQuery" | "group" | "columnFilters" | "columnWidths"
>;

export function updateSavedViewState(
  views: SavedFilterView[],
  activeViewId: string,
  state: SavedViewState,
) {
  return views.map((view) => view.id === activeViewId ? {
    ...view,
    globalQuery: state.globalQuery,
    group: cloneGroup(state.group),
    columnFilters: { ...state.columnFilters },
    columnWidths: normalizeColumnWidths(state.columnWidths),
  } : view);
}

export function parseSavedViews(serialized: string | null): SavedFilterView[] {
  try {
    const parsed: unknown = JSON.parse(serialized ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate) => {
      if (!isSavedView(candidate)) return [];
      return [{
        ...candidate,
        group: cloneGroup(candidate.group),
        columnFilters: { ...candidate.columnFilters },
        columnWidths: normalizeColumnWidths(candidate.columnWidths),
      }];
    });
  } catch {
    return [];
  }
}

export function parseColumnWidths(serialized: string | null) {
  try {
    return normalizeColumnWidths(JSON.parse(serialized ?? "[]"));
  } catch {
    return normalizeColumnWidths([]);
  }
}

function cloneGroup(group: FilterGroup): FilterGroup {
  return {
    conjunction: group.conjunction,
    rules: group.rules.map((rule) => ({ ...rule })),
  };
}

function isSavedView(candidate: unknown): candidate is Omit<SavedFilterView, "columnWidths"> & {
  columnWidths?: unknown;
} {
  if (!candidate || typeof candidate !== "object") return false;
  const value = candidate as Record<string, unknown>;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.globalQuery === "string" &&
    isFilterGroup(value.group) &&
    isStringRecord(value.columnFilters)
  );
}

function isFilterGroup(candidate: unknown): candidate is FilterGroup {
  if (!candidate || typeof candidate !== "object") return false;
  const value = candidate as Record<string, unknown>;
  return (value.conjunction === "and" || value.conjunction === "or") && Array.isArray(value.rules);
}

function isStringRecord(candidate: unknown): candidate is Record<number, string> {
  return Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate) &&
    Object.values(candidate as Record<string, unknown>).every((value) => typeof value === "string");
}
