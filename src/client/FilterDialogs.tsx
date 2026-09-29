import { useEffect, useRef, useState } from "react";
import {
  cloneFilterGroup,
  createFilterRule,
  emptyFilterGroup,
  fieldDefinitions,
  operatorNeedsValue,
  operatorsForField,
  type FilterField,
  type FilterGroup,
  type FilterOperator,
} from "./filters";

type BuilderProps = {
  matchCount: number;
  initialGroup: FilterGroup;
  initialField?: FilterField;
  onChange: (group: FilterGroup) => void;
  onClose: () => void;
};

export function FilterBuilderPanel({
  matchCount,
  initialGroup,
  initialField,
  onChange,
  onClose,
}: BuilderProps) {
  const hasEditedRef = useRef(false);
  const [group, setGroup] = useState<FilterGroup>(() => {
    const next = cloneFilterGroup(initialGroup);
    if (initialField && !next.rules.some((rule) => rule.field === initialField)) {
      next.rules.push(createFilterRule(initialField));
    }
    if (next.rules.length === 0) next.rules.push(createFilterRule(initialField));
    return next;
  });
  useEscape(onClose);
  useEffect(() => {
    if (!hasEditedRef.current) {
      hasEditedRef.current = true;
      return;
    }
    onChange(normalizedGroup(group));
  }, [group, onChange]);

  const updateRule = (id: string, patch: Partial<(typeof group.rules)[number]>) => {
    setGroup((current) => ({
      ...current,
      rules: current.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    }));
  };

  return (
      <section className="filter-builder-panel" role="region" aria-labelledby="filter-builder-title">
        <header className="filter-builder-head">
          <div>
            <h2 id="filter-builder-title">Filters</h2>
            <span>Changes apply and save to the active tab automatically.</span>
          </div>
          <button className="popover-close-button" onClick={onClose} aria-label="Close filter builder">×</button>
        </header>

        <div className="filter-logic-row">
          <span>Show records matching</span>
          <select
            value={group.conjunction}
            onChange={(event) => setGroup((current) => ({ ...current, conjunction: event.target.value as "and" | "or" }))}
          >
            <option value="and">all conditions (AND)</option>
            <option value="or">any condition (OR)</option>
          </select>
        </div>

        <div className="filter-rule-list">
          {group.rules.map((rule, index) => {
            const definition = fieldDefinitions.find((field) => field.key === rule.field)!;
            const operators = operatorsForField(rule.field);
            return (
              <div className="filter-rule" key={rule.id}>
                <span className="rule-joiner">{index === 0 ? "Where" : group.conjunction.toUpperCase()}</span>
                <select
                  aria-label="Filter field"
                  value={rule.field}
                  onChange={(event) => {
                    const field = event.target.value as FilterField;
                    updateRule(rule.id, { field, operator: operatorsForField(field)[0].value, value: "" });
                  }}
                >
                  {fieldDefinitions.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                </select>
                <select
                  aria-label="Filter operator"
                  value={rule.operator}
                  onChange={(event) => updateRule(rule.id, { operator: event.target.value as FilterOperator })}
                >
                  {operators.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
                </select>
                {operatorNeedsValue(rule.operator) ? (
                  <input
                    aria-label="Filter value"
                    type={inputType(definition.kind, rule.operator)}
                    min={rule.operator === "within_next_days" ? "0" : undefined}
                    placeholder={valuePlaceholder(definition.kind, rule.operator)}
                    value={rule.value}
                    onChange={(event) => updateRule(rule.id, { value: event.target.value })}
                  />
                ) : <span className="rule-no-value">No value needed</span>}
                <button
                  className="remove-rule-button"
                  onClick={() => setGroup((current) => ({ ...current, rules: current.rules.filter((candidate) => candidate.id !== rule.id) }))}
                  aria-label="Remove condition"
                >×</button>
              </div>
            );
          })}
        </div>

        <button
          className="add-rule-button"
          onClick={() => setGroup((current) => ({ ...current, rules: [...current.rules, createFilterRule()] }))}
        >+ Add condition</button>

        <footer className="filter-builder-foot">
          <span><strong>{matchCount.toLocaleString()}</strong> RFQs match</span>
          <div>
            <button className="secondary-button" onClick={() => setGroup(emptyFilterGroup())}>Clear</button>
            <button className="primary-button" onClick={onClose}>Done</button>
          </div>
        </footer>
      </section>
  );
}

export function SaveViewPopover({ onSave, onClose }: { onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  useEscape(onClose);

  const save = () => {
    const trimmed = name.trim();
    if (trimmed) onSave(trimmed);
  };

  return (
      <section className="save-view-popover" role="dialog" aria-labelledby="save-view-title">
        <header>
          <h2 id="save-view-title">Name this filter tab</h2>
          <button className="popover-close-button" onClick={onClose} aria-label="Cancel saving view">×</button>
        </header>
        <input
          autoFocus
          value={name}
          placeholder="Aircraft parts expiring in a week"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && save()}
        />
        <footer>
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={!name.trim()} onClick={save}>Save as tab</button>
        </footer>
      </section>
  );
}

export function AddViewPopover({
  onCreate,
  onImport,
  onClose,
}: {
  onCreate: (name: string) => void;
  onImport: (url: string) => boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [sharedUrl, setSharedUrl] = useState("");
  const [importError, setImportError] = useState(false);
  useEscape(onClose);

  const create = () => {
    const trimmed = name.trim();
    if (trimmed) onCreate(trimmed);
  };
  const importView = () => {
    const imported = onImport(sharedUrl);
    setImportError(!imported);
  };

  return (
    <section className="add-view-popover" role="dialog" aria-labelledby="add-view-title">
      <header>
        <div>
          <h2 id="add-view-title">Add filter tab</h2>
          <span>Create an empty tab or import a shared view.</span>
        </div>
        <button className="popover-close-button" onClick={onClose} aria-label="Close add tab panel">×</button>
      </header>
      <div className="add-view-section">
        <label htmlFor="new-view-name">New blank tab</label>
        <div>
          <input
            id="new-view-name"
            autoFocus
            value={name}
            maxLength={120}
            placeholder="Aircraft parts expiring in a week"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && create()}
          />
          <button className="primary-button" disabled={!name.trim()} onClick={create}>Create</button>
        </div>
      </div>
      <div className="add-view-section">
        <label htmlFor="shared-view-url">Shared view URL</label>
        <div>
          <input
            id="shared-view-url"
            value={sharedUrl}
            placeholder="Paste an RFQ view link"
            aria-invalid={importError || undefined}
            onChange={(event) => {
              setSharedUrl(event.target.value);
              setImportError(false);
            }}
            onKeyDown={(event) => event.key === "Enter" && importView()}
          />
          <button className="secondary-button" disabled={!sharedUrl.trim()} onClick={importView}>Import</button>
        </div>
        {importError && <span className="add-view-error" role="alert">This link does not contain a valid RFQ view.</span>}
      </div>
    </section>
  );
}

function normalizedGroup(group: FilterGroup): FilterGroup {
  return {
    conjunction: group.conjunction,
    rules: group.rules.filter((rule) => !operatorNeedsValue(rule.operator) || rule.value.trim() !== ""),
  };
}

function inputType(kind: "text" | "number" | "date", operator: FilterOperator) {
  if (operator === "within_next_days") return "number";
  return kind === "date" ? "date" : kind === "number" ? "number" : "text";
}

function valuePlaceholder(kind: "text" | "number" | "date", operator: FilterOperator) {
  if (operator === "within_next_days") return "7";
  if (kind === "number") return "Value";
  return kind === "date" ? "YYYY-MM-DD" : "Enter value";
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}
