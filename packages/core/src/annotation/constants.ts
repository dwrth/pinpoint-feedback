export const ANNOTATION_COLORS: readonly string[] = Object.freeze([
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#111827",
]);

export const DEFAULT_ANNOTATION_COLOR = "#ef4444";
export const DEFAULT_STROKE_WIDTH = 6;

export const SELECTION_COLOR = "#2563eb";
export const TEXT_LINE_HEIGHT = 1.25;
export const TEXT_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const TEXT_FONT_WEIGHT = 600;

export const MIN_PIN_RADIUS = 14;
export const DEFAULT_MAX_ZOOM = 8;
export const ZOOM_STEP = 1.25;

export function textFont(fontSize: number): string {
  return `${TEXT_FONT_WEIGHT} ${fontSize}px ${TEXT_FONT_FAMILY}`;
}

/** Pin radius in screenshot pixels: large enough to stay legible on high-resolution captures. */
export function pinRadiusFor(imageWidth: number | undefined): number {
  if (!imageWidth || !Number.isFinite(imageWidth)) return MIN_PIN_RADIUS;
  return Math.max(MIN_PIN_RADIUS, Math.round(imageWidth / 90));
}

/** Font size in screenshot pixels for new text annotations. */
export function textSizeFor(imageWidth: number | undefined, strokeWidth: number): number {
  const base = imageWidth ? Math.max(16, imageWidth / 70) : 20;
  const factor = Math.min(3, Math.max(0.6, strokeWidth / DEFAULT_STROKE_WIDTH));
  return Math.round(base * factor);
}
