import {
  columnFields,
  fieldDefinitions,
  operatorsForField,
  type FilterField,
  type FilterOperator,
  type SavedFilterView,
} from "./filters.js";
import { parseSavedViews } from "./savedViews.js";

const hashKey = "rfq-view";
const maximumPayloadLength = 64_000;

export type SharedFilterView = Omit<SavedFilterView, "id">;

export function createSharedViewUrl(view: SavedFilterView, currentUrl: string) {
  const payload = JSON.stringify({
    version: 1,
    view: {
      name: view.name,
      globalQuery: view.globalQuery,
      group: view.group,
      columnFilters: view.columnFilters,
      columnWidths: view.columnWidths,
    },
  });
  const url = new URL(currentUrl);
  const parameters = new URLSearchParams(url.hash.slice(1));
  parameters.set(hashKey, encodeBase64Url(payload));
  url.hash = parameters.toString();
  return url.toString();
}

export function parseSharedViewUrl(value: string, baseUrl: string): SharedFilterView | null {
  try {
    const url = new URL(value.trim(), baseUrl);
    const encoded = new URLSearchParams(url.hash.slice(1)).get(hashKey);
    if (!encoded || encoded.length > maximumPayloadLength) return null;
    const payload = JSON.parse(decodeBase64Url(encoded)) as { version?: unknown; view?: unknown };
    if (payload.version !== 1 || !payload.view || typeof payload.view !== "object") return null;
    if (!isValidSharedView(payload.view)) return null;
    const parsed = parseSavedViews(JSON.stringify([{ id: "shared", ...payload.view }]));
    if (parsed.length !== 1) return null;
    const { id: _id, ...view } = parsed[0];
    return view;
  } catch {
    return null;
  }
}

function isValidSharedView(candidate: object) {
  const value = candidate as Record<string, unknown>;
  if (
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    value.name.length > 120 ||
    typeof value.globalQuery !== "string" ||
    value.globalQuery.length > 2_000 ||
    !isValidFilterGroup(value.group) ||
    !isValidColumnFilters(value.columnFilters) ||
    !isValidColumnWidths(value.columnWidths)
  ) return false;
  return true;
}

function isValidFilterGroup(candidate: unknown) {
  if (!candidate || typeof candidate !== "object") return false;
  const group = candidate as Record<string, unknown>;
  if ((group.conjunction !== "and" && group.conjunction !== "or") || !Array.isArray(group.rules)) return false;
  if (group.rules.length > 100) return false;
  return group.rules.every((candidateRule) => {
    if (!candidateRule || typeof candidateRule !== "object") return false;
    const rule = candidateRule as Record<string, unknown>;
    if (
      typeof rule.id !== "string" || rule.id.length > 120 ||
      typeof rule.field !== "string" ||
      typeof rule.operator !== "string" ||
      typeof rule.value !== "string" || rule.value.length > 2_000
    ) return false;
    const field = rule.field as FilterField;
    const operator = rule.operator as FilterOperator;
    return fieldDefinitions.some((definition) => definition.key === field) &&
      operatorsForField(field).some((definition) => definition.value === operator);
  });
}

function isValidColumnFilters(candidate: unknown) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  return Object.entries(candidate).every(([index, filter]) => {
    const numericIndex = Number(index);
    return Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < columnFields.length &&
      typeof filter === "string" && filter.length <= 2_000;
  });
}

function isValidColumnWidths(candidate: unknown) {
  return Array.isArray(candidate) && candidate.length <= columnFields.length &&
    candidate.every((width) => typeof width === "number" && Number.isFinite(width));
}

export function withoutSharedViewHash(currentUrl: string) {
  const url = new URL(currentUrl);
  const parameters = new URLSearchParams(url.hash.slice(1));
  parameters.delete(hashKey);
  url.hash = parameters.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
