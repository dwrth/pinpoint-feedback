import type { Annotation, PinAnnotation, Point, RectangleAnnotation, Size } from "../types";
import { DEFAULT_MAX_ZOOM, MIN_PIN_RADIUS, TEXT_LINE_HEIGHT, textFont } from "./constants";

/** Maps screenshot pixels to container CSS pixels: screen = image * zoom + pan. */
export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function screenToImage(p: Point, view: ViewTransform): Point {
  return { x: (p.x - view.panX) / view.zoom, y: (p.y - view.panY) / view.zoom };
}

export function imageToScreen(p: Point, view: ViewTransform): Point {
  return { x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Rectangle from two corner points with non-negative width/height. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function normalizeRectangle(r: RectangleAnnotation): RectangleAnnotation {
  if (r.width >= 0 && r.height >= 0) return r;
  const n = normalizeRect({ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height });
  return { ...r, ...n };
}

/** Ramer–Douglas–Peucker simplification. Always keeps the first and last points. */
export function simplifyPath(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const a = points[start]!;
    const b = points[end]!;
    let maxDist = -1;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i]!, a, b);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push({ x: points[i]!.x, y: points[i]!.y });
  }
  return out;
}

/** Numbers pins 1..n in array (creation) order; other annotations are returned untouched. */
export function renumberPins(annotations: readonly Annotation[]): Annotation[] {
  let n = 0;
  return annotations.map((a) => {
    if (a.type !== "pin") return a;
    n += 1;
    return a.number === n ? a : ({ ...a, number: n } satisfies PinAnnotation);
  });
}

export function nextPinNumber(annotations: readonly Annotation[]): number {
  return annotations.reduce((n, a) => (a.type === "pin" ? n + 1 : n), 0) + 1;
}

export function cloneAnnotation<T extends Annotation>(a: T): T {
  switch (a.type) {
    case "pin":
    case "text":
      return { ...a, at: { ...a.at } };
    case "arrow":
      return { ...a, from: { ...a.from }, to: { ...a.to } };
    case "freehand":
      return { ...a, points: a.points.map((p) => ({ x: p.x, y: p.y })) };
    default:
      return { ...a };
  }
}

export function cloneAnnotations(list: readonly Annotation[]): Annotation[] {
  return list.map((a) => cloneAnnotation(a));
}

export function translateAnnotation<T extends Annotation>(a: T, dx: number, dy: number): T {
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  switch (a.type) {
    case "pin":
    case "text":
      return { ...a, at: move(a.at) };
    case "arrow":
      return { ...a, from: move(a.from), to: move(a.to) };
    case "freehand":
      return { ...a, points: a.points.map(move) };
    case "rectangle":
      return { ...a, x: a.x + dx, y: a.y + dy };
    default:
      return a;
  }
}

export type MeasureText = (text: string, font: string) => number;

export interface GeometryOptions {
  /** Pin radius in screenshot pixels. */
  pinRadius?: number;
  /** Measures text width in screenshot pixels; falls back to an estimate. */
  measureText?: MeasureText;
}

export function textLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

export function textBounds(
  a: { at: Point; text: string; fontSize: number },
  measure?: MeasureText,
): Rect {
  const lines = textLines(a.text);
  const font = textFont(a.fontSize);
  let width = 0;
  for (const line of lines) {
    const w = measure ? measure(line, font) : line.length * a.fontSize * 0.58;
    if (w > width) width = w;
  }
  return { x: a.at.x, y: a.at.y, width, height: lines.length * a.fontSize * TEXT_LINE_HEIGHT };
}

/** Visual bounds of an annotation in screenshot pixels (including stroke). */
export function annotationBounds(a: Annotation, options: GeometryOptions = {}): Rect {
  const half = a.strokeWidth / 2;
  switch (a.type) {
    case "pin": {
      const r = options.pinRadius ?? MIN_PIN_RADIUS;
      return { x: a.at.x - r, y: a.at.y - r, width: r * 2, height: r * 2 };
    }
    case "text":
      return textBounds(a, options.measureText);
    case "rectangle": {
      const n = normalizeRectangle(a);
      return { x: n.x - half, y: n.y - half, width: n.width + a.strokeWidth, height: n.height + a.strokeWidth };
    }
    case "arrow": {
      const head = arrowHeadLength(a.strokeWidth);
      const r = normalizeRect(a.from, a.to);
      return { x: r.x - head, y: r.y - head, width: r.width + head * 2, height: r.height + head * 2 };
    }
    case "freehand": {
      if (a.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of a.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX - half, y: minY - half, width: maxX - minX + a.strokeWidth, height: maxY - minY + a.strokeWidth };
    }
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

export function arrowHeadLength(strokeWidth: number): number {
  return Math.max(10, strokeWidth * 3.5 + 6);
}

/** True when `p` (screenshot pixels) touches the annotation within `tolerance` screenshot pixels. */
export function hitTestAnnotation(
  a: Annotation,
  p: Point,
  tolerance: number,
  options: GeometryOptions = {},
): boolean {
  const half = a.strokeWidth / 2;
  switch (a.type) {
    case "pin":
      return distance(p, a.at) <= (options.pinRadius ?? MIN_PIN_RADIUS) + tolerance;
    case "text": {
      const b = textBounds(a, options.measureText);
      return (
        p.x >= b.x - tolerance &&
        p.x <= b.x + b.width + tolerance &&
        p.y >= b.y - tolerance &&
        p.y <= b.y + b.height + tolerance
      );
    }
    case "arrow": {
      if (distanceToSegment(p, a.from, a.to) <= half + tolerance) return true;
      return distance(p, a.to) <= arrowHeadLength(a.strokeWidth) * 0.6 + tolerance;
    }
    case "rectangle": {
      const r = normalizeRectangle(a);
      const corners: Point[] = [
        { x: r.x, y: r.y },
        { x: r.x + r.width, y: r.y },
        { x: r.x + r.width, y: r.y + r.height },
        { x: r.x, y: r.y + r.height },
      ];
      for (let i = 0; i < 4; i++) {
        if (distanceToSegment(p, corners[i]!, corners[(i + 1) % 4]!) <= half + tolerance) return true;
      }
      return false;
    }
    case "freehand": {
      const pts = a.points;
      if (pts.length === 0) return false;
      if (pts.length === 1) return distance(p, pts[0]!) <= half + tolerance;
      for (let i = 1; i < pts.length; i++) {
        if (distanceToSegment(p, pts[i - 1]!, pts[i]!) <= half + tolerance) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/** Topmost (last drawn) annotation hit by `p`, if any. */
export function findAnnotationAt(
  annotations: readonly Annotation[],
  p: Point,
  tolerance: number,
  options: GeometryOptions = {},
): Annotation | undefined {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i]!;
    if (hitTestAnnotation(a, p, tolerance, options)) return a;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Zoom & pan math                                                     */
/* ------------------------------------------------------------------ */

export function computeFitZoom(image: Size, container: Size): number {
  if (image.width <= 0 || image.height <= 0 || container.width <= 0 || container.height <= 0) return 1;
  return Math.min(container.width / image.width, container.height / image.height);
}

export function fitView(image: Size, container: Size): ViewTransform {
  const zoom = computeFitZoom(image, container);
  return {
    zoom,
    panX: (container.width - image.width * zoom) / 2,
    panY: (container.height - image.height * zoom) / 2,
  };
}

export interface ZoomLimits {
  min: number;
  max: number;
}

export function resolveZoomLimits(fitZoom: number, minZoom?: number, maxZoom?: number): ZoomLimits {
  const min = minZoom ?? Math.min(fitZoom * 0.5, 0.1);
  const max = Math.max(maxZoom ?? DEFAULT_MAX_ZOOM, min);
  return { min, max };
}

export function clampZoom(zoom: number, limits: ZoomLimits): number {
  if (!Number.isFinite(zoom)) return limits.min;
  return Math.min(limits.max, Math.max(limits.min, zoom));
}

/** New view with `zoom`, keeping the screen point `anchor` over the same image point. */
export function zoomAround(view: ViewTransform, zoom: number, anchor: Point): ViewTransform {
  const ratio = zoom / view.zoom;
  return {
    zoom,
    panX: anchor.x - (anchor.x - view.panX) * ratio,
    panY: anchor.y - (anchor.y - view.panY) * ratio,
  };
}

/**
 * Keeps the image reachable: a screenshot smaller than the container stays fully inside it,
 * a larger one may not leave a gap wider than `overscroll` CSS px at any edge.
 */
export function clampPan(view: ViewTransform, image: Size, container: Size, overscroll = 48): ViewTransform {
  const clampAxis = (pan: number, imageLen: number, containerLen: number): number => {
    const len = imageLen * view.zoom;
    if (len <= containerLen) return Math.min(containerLen - len, Math.max(0, pan));
    const margin = Math.min(overscroll, containerLen / 4);
    return Math.min(margin, Math.max(containerLen - len - margin, pan));
  };
  return {
    zoom: view.zoom,
    panX: clampAxis(view.panX, image.width, container.width),
    panY: clampAxis(view.panY, image.height, container.height),
  };
}
