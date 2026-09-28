import type { Rfq } from "../shared/rfq";

export type FilterField =
  | "solicitationNumber"
  | "title"
  | "nsn"
  | "quantity"
  | "unit"
  | "closeDate"
  | "buyerName"
  | "supplyChain"
  | "naics"
  | "deliveryDays"
  | "estimatedValue";

export type FilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "greater_than"
  | "less_than"
  | "at_least"
  | "at_most"
  | "before"
  | "after"
  | "within_next_days"
  | "is_empty"
  | "is_not_empty";

export type FilterRule = {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value: string;
};

export type FilterGroup = {
  conjunction: "and" | "or";
  rules: FilterRule[];
};

export type SavedFilterView = {
  id: string;
  name: string;
  globalQuery: string;
  group: FilterGroup;
  columnFilters: Record<number, string>;
};

type FieldKind = "text" | "number" | "date";

export const fieldDefinitions: { key: FilterField; label: string; kind: FieldKind }[] = [
  { key: "solicitationNumber", label: "Solicitation", kind: "text" },
  { key: "title", label: "Item description", kind: "text" },
  { key: "nsn", label: "NSN", kind: "text" },
  { key: "quantity", label: "Quantity", kind: "number" },
  { key: "unit", label: "Unit", kind: "text" },
  { key: "closeDate", label: "Close date", kind: "date" },
  { key: "buyerName", label: "Buyer", kind: "text" },
  { key: "supplyChain", label: "Supply chain", kind: "text" },
  { key: "naics", label: "NAICS", kind: "text" },
  { key: "deliveryDays", label: "Delivery days", kind: "number" },
  { key: "estimatedValue", label: "Estimated value", kind: "number" },
];

export const columnFields: FilterField[] = [
  "solicitationNumber",
  "title",
  "nsn",
  "quantity",
  "unit",
  "closeDate",
  "buyerName",
  "supplyChain",
  "naics",
  "deliveryDays",
];

const textOperators: { value: FilterOperator; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "starts_with", label: "starts with" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const numberOperators: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "greater_than", label: "is greater than" },
  { value: "less_than", label: "is less than" },
  { value: "at_least", label: "is at least" },
  { value: "at_most", label: "is at most" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const dateOperators: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "is on" },
  { value: "before", label: "is before" },
  { value: "after", label: "is after" },
  { value: "within_next_days", label: "is within the next (days)" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

export function operatorsForField(field: FilterField) {
  const kind = fieldDefinitions.find((definition) => definition.key === field)?.kind ?? "text";
  return kind === "number" ? numberOperators : kind === "date" ? dateOperators : textOperators;
}

export function createFilterRule(field: FilterField = "title"): FilterRule {
  return { id: createId(), field, operator: "contains", value: "" };
}

export function emptyFilterGroup(): FilterGroup {
  return { conjunction: "and", rules: [] };
}

export function applyRfqFilters(rfqs: Rfq[], globalQuery: string, group: FilterGroup): Rfq[] {
  const query = globalQuery.trim().toLowerCase();
  return rfqs.filter((rfq) => {
    if (query && !searchableValues(rfq).some((value) => value.toLowerCase().includes(query))) return false;
    if (group.rules.length === 0) return true;
    const matches = group.rules.map((rule) => matchesRule(rfq, rule));
    return group.conjunction === "and" ? matches.every(Boolean) : matches.some(Boolean);
  });
}

export function cloneFilterGroup(group: FilterGroup): FilterGroup {
  return { conjunction: group.conjunction, rules: group.rules.map((rule) => ({ ...rule })) };
}

export function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function operatorNeedsValue(operator: FilterOperator) {
  return operator !== "is_empty" && operator !== "is_not_empty";
}

function matchesRule(rfq: Rfq, rule: FilterRule) {
  const rawValue = getFieldValue(rfq, rule.field);
  const empty = rawValue === null || rawValue === undefined || rawValue === "";
  if (rule.operator === "is_empty") return empty;
  if (rule.operator === "is_not_empty") return !empty;
  if (empty) return false;

  const definition = fieldDefinitions.find((candidate) => candidate.key === rule.field);
  if (definition?.kind === "number") {
    const left = Number(rawValue);
    const right = Number(rule.value);
    if (!Number.isFinite(right)) return false;
    if (rule.operator === "equals") return left === right;
    if (rule.operator === "not_equals") return left !== right;
    if (rule.operator === "greater_than") return left > right;
    if (rule.operator === "less_than") return left < right;
    if (rule.operator === "at_least") return left >= right;
    if (rule.operator === "at_most") return left <= right;
    return false;
  }

  const left = String(rawValue).toLowerCase();
  const right = rule.value.trim().toLowerCase();
  if (definition?.kind === "date") {
    if (rule.operator === "within_next_days") {
      const days = Number(rule.value);
      if (!Number.isFinite(days)) return false;
      const today = startOfLocalDay(new Date());
      const date = new Date(`${String(rawValue)}T00:00:00`);
      const difference = (date.getTime() - today.getTime()) / 86_400_000;
      return difference >= 0 && difference <= days;
    }
    if (rule.operator === "before") return left < right;
    if (rule.operator === "after") return left > right;
    return left === right;
  }

  if (rule.operator === "contains") return left.includes(right);
  if (rule.operator === "not_contains") return !left.includes(right);
  if (rule.operator === "equals") return left === right;
  if (rule.operator === "not_equals") return left !== right;
  if (rule.operator === "starts_with") return left.startsWith(right);
  return false;
}

function getFieldValue(rfq: Rfq, field: FilterField): string | number | null {
  if (field === "supplyChain") return rfq.supplyChain ?? rfq.agency;
  return rfq[field];
}

function searchableValues(rfq: Rfq) {
  return columnFields.map((field) => String(getFieldValue(rfq, field) ?? ""));
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
