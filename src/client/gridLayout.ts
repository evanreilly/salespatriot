export const GRID_COLUMN_COUNT = 10;
export const DEFAULT_COLUMN_WIDTH = 200;
export const MINIMUM_COLUMN_WIDTH = 90;
export const MAXIMUM_COLUMN_WIDTH = 560;

export type RectLike = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type Size = { width: number; height: number };

export function defaultColumnWidths() {
  return Array.from({ length: GRID_COLUMN_COUNT }, () => DEFAULT_COLUMN_WIDTH);
}

export function clampColumnWidth(width: number) {
  const finiteWidth = Number.isFinite(width) ? width : DEFAULT_COLUMN_WIDTH;
  return Math.max(MINIMUM_COLUMN_WIDTH, Math.min(MAXIMUM_COLUMN_WIDTH, Math.round(finiteWidth)));
}

export function normalizeColumnWidths(widths: unknown) {
  const candidates = Array.isArray(widths) ? widths : [];
  return defaultColumnWidths().map((fallback, index) => {
    const candidate = candidates[index];
    return typeof candidate === "number" && Number.isFinite(candidate)
      ? clampColumnWidth(candidate)
      : fallback;
  });
}

export function fittedWidthFromMeasurements(measurements: number[]) {
  const widest = measurements.reduce(
    (maximum, measurement) => Number.isFinite(measurement) ? Math.max(maximum, measurement) : maximum,
    0,
  );
  return clampColumnWidth(Math.ceil(widest));
}

export function placeCellPopover(
  anchor: RectLike,
  overlay: Size,
  viewport: Size,
  margin = 8,
) {
  const width = Math.min(overlay.width, Math.max(viewport.width - margin * 2, 0));
  const height = Math.min(overlay.height, Math.max(viewport.height - margin * 2, 0));
  const maximumLeft = Math.max(margin, viewport.width - width - margin);
  const left = clamp(anchor.left, margin, maximumLeft);
  const spaceBelow = viewport.height - anchor.bottom - margin;
  const spaceAbove = anchor.top - margin;
  const placeBelow = height <= spaceBelow || spaceBelow >= spaceAbove;
  const attachedTop = placeBelow ? anchor.bottom : anchor.top - height;
  const maximumTop = Math.max(margin, viewport.height - height - margin);

  return {
    left,
    top: clamp(attachedTop, margin, maximumTop),
    placement: placeBelow ? "below" as const : "above" as const,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
