import { enCapture } from "../i18n/capture";

const HATCH_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%'>" +
  "<defs><pattern id='p' width='14' height='14' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>" +
  "<rect width='14' height='14' fill='#eef0f3'/><rect width='7' height='14' fill='#d3d8df'/></pattern></defs>" +
  "<rect width='100%' height='100%' fill='url(#p)'/></svg>";

/** Hatched image used in place of images that could not be loaded during capture. */
export const PLACEHOLDER_IMAGE_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(HATCH_SVG)}`;

/** English placeholder labels; localized ones come from `CaptureMessages` (`placeholder.*`). */
export const PLACEHOLDER_LABELS = {
  iframe: enCapture["placeholder.iframe"],
  object: enCapture["placeholder.object"],
  canvas: enCapture["placeholder.canvas"],
  video: enCapture["placeholder.video"],
} as const;

export type PlaceholderKind = keyof typeof PLACEHOLDER_LABELS;

export const PLACEHOLDER_ATTRIBUTE = "data-pinpoint-placeholder";

const BOX_STYLES: ReadonlyArray<readonly [string, string]> = [
  ["box-sizing", "border-box"],
  ["overflow", "hidden"],
  ["align-items", "center"],
  ["justify-content", "center"],
  ["text-align", "center"],
  ["padding", "8px"],
  ["border", "2px dashed #8a93a1"],
  ["border-radius", "0"],
  ["background", "repeating-linear-gradient(45deg, #eef0f3 0 10px, #dde1e7 10px 20px)"],
  ["color", "#2f3640"],
  ["font", "600 13px/1.35 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"],
  ["letter-spacing", "normal"],
  ["text-transform", "none"],
  ["text-shadow", "0 0 3px #ffffff, 0 0 3px #ffffff"],
  ["opacity", "1"],
  ["visibility", "visible"],
  ["filter", "none"],
  ["object-fit", "fill"],
];

/**
 * Builds a clearly labelled, hatched box that replaces `clone` (an element in the cloned DOM).
 * Layout-related inline styles (position, margins, transforms...) are kept from the clone.
 */
export function createPlaceholder(
  clone: Element,
  kind: PlaceholderKind,
  size: { width: number; height: number },
  label: string = PLACEHOLDER_LABELS[kind],
): HTMLElement {
  const doc = clone.ownerDocument;
  const box = doc.createElement("div");
  const inlineStyle = clone.getAttribute("style");
  if (inlineStyle) box.setAttribute("style", inlineStyle);
  const className = clone.getAttribute("class");
  if (className) box.setAttribute("class", className);
  box.setAttribute(PLACEHOLDER_ATTRIBUTE, kind);

  const display = box.style.getPropertyValue("display");
  box.style.setProperty("display", display.startsWith("inline") ? "inline-flex" : "flex", "important");
  box.style.setProperty("width", `${Math.max(0, size.width)}px`, "important");
  box.style.setProperty("height", `${Math.max(0, size.height)}px`, "important");
  for (const [name, value] of BOX_STYLES) box.style.setProperty(name, value, "important");

  const text = doc.createElement("span");
  text.textContent = label;
  box.appendChild(text);
  return box;
}

export function replaceWithPlaceholder(
  clone: Element,
  kind: PlaceholderKind,
  size: { width: number; height: number },
  label?: string,
): HTMLElement {
  const placeholder = createPlaceholder(clone, kind, size, label);
  clone.replaceWith(placeholder);
  return placeholder;
}
