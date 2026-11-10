import type { AnnotationRenderOptions, AnnotationRenderer, Canvas2D } from "../interfaces";
import type {
  Annotation,
  ArrowAnnotation,
  FreehandAnnotation,
  PinAnnotation,
  RectangleAnnotation,
  Size,
  TextAnnotation,
} from "../types";
import { SELECTION_COLOR, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, pinRadiusFor, textFont } from "./constants";
import { annotationBounds, arrowHeadLength, normalizeRectangle, textLines } from "./geometry";

export interface RenderAnnotationsOptions extends AnnotationRenderOptions {
  /** Size of the screenshot; used to size pins so they stay legible on large captures. */
  imageSize?: Size;
  /** Overrides the pin radius (screenshot pixels). */
  pinRadius?: number;
}

/** Relative luminance (0..1) of a CSS hex or rgb() color; 0.3 when unparseable. */
export function colorLuminance(color: string): number {
  let r: number;
  let g: number;
  let b: number;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
  if (hex) {
    const h = hex[1]!;
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  } else {
    const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim());
    if (!rgb) return 0.3;
    r = Number(rgb[1]);
    g = Number(rgb[2]);
    b = Number(rgb[3]);
  }
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Color that contrasts with `color` (for halos and pin numbers). */
export function contrastColor(color: string, alpha = 1): string {
  return colorLuminance(color) > 0.45 ? `rgba(17, 24, 39, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
}

function resolvePinRadius(options: RenderAnnotationsOptions): number {
  return options.pinRadius ?? pinRadiusFor(options.imageSize?.width);
}

function drawPin(ctx: Canvas2D, a: PinAnnotation, radius: number, scale: number): void {
  const { x, y } = a.at;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = radius * 0.45 * scale;
  ctx.shadowOffsetY = radius * 0.12 * scale;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = a.color;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, radius * 0.14);
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  const label = String(a.number);
  const fontSize = radius * (label.length > 2 ? 0.8 : label.length > 1 ? 0.95 : 1.1);
  ctx.font = `700 ${fontSize}px ${TEXT_FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colorLuminance(a.color) > 0.6 ? "#111827" : "#ffffff";
  ctx.fillText(label, x, y + radius * 0.04);
}

function strokeStyle(ctx: Canvas2D, a: Annotation): void {
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function drawFreehand(ctx: Canvas2D, a: FreehandAnnotation): void {
  const pts = a.points;
  const first = pts[0];
  if (!first) return;
  strokeStyle(ctx, a);
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(first.x, first.y, a.strokeWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1]!.x, pts[1]!.y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const n = pts[i + 1]!;
      ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
    }
    const last = pts[pts.length - 1]!;
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
}

function drawArrow(ctx: Canvas2D, a: ArrowAnnotation): void {
  const dx = a.to.x - a.from.x;
  const dy = a.to.y - a.from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(arrowHeadLength(a.strokeWidth), len);
  const halfWidth = head * 0.55;
  const baseX = a.to.x - ux * head;
  const baseY = a.to.y - uy * head;
  strokeStyle(ctx, a);

  ctx.beginPath();
  ctx.moveTo(a.from.x, a.from.y);
  ctx.lineTo(a.to.x - ux * head * 0.6, a.to.y - uy * head * 0.6);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(a.to.x, a.to.y);
  ctx.lineTo(baseX - uy * halfWidth, baseY + ux * halfWidth);
  ctx.lineTo(baseX + uy * halfWidth, baseY - ux * halfWidth);
  ctx.closePath();
  ctx.lineWidth = Math.max(1, a.strokeWidth * 0.5);
  ctx.fill();
  ctx.stroke();
}

function drawRectangle(ctx: Canvas2D, a: RectangleAnnotation): void {
  const r = normalizeRectangle(a);
  strokeStyle(ctx, a);
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.width, r.height);
  ctx.stroke();
}

function drawText(ctx: Canvas2D, a: TextAnnotation): void {
  const lineHeight = a.fontSize * TEXT_LINE_HEIGHT;
  const offset = (lineHeight - a.fontSize) / 2;
  ctx.font = textFont(a.fontSize);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(2, a.fontSize * 0.18);
  ctx.strokeStyle = contrastColor(a.color, 0.9);
  ctx.fillStyle = a.color;
  const lines = textLines(a.text);
  lines.forEach((line, i) => {
    if (!line) return;
    const y = a.at.y + i * lineHeight + offset;
    ctx.strokeText(line, a.at.x, y);
  });
  lines.forEach((line, i) => {
    if (!line) return;
    ctx.fillText(line, a.at.x, a.at.y + i * lineHeight + offset);
  });
}

function drawSelection(ctx: Canvas2D, a: Annotation, pinRadius: number, scale: number): void {
  const b = annotationBounds(a, {
    pinRadius,
    measureText: (text, font) => {
      ctx.font = font;
      return ctx.measureText(text).width;
    },
  });
  const pad = 6 / scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
  ctx.setLineDash([]);
  ctx.lineWidth = 4 / scale;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.stroke();
  ctx.setLineDash([6 / scale, 4 / scale]);
  ctx.lineWidth = 2 / scale;
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws annotations (stored in screenshot pixels) onto `ctx`, on top of its current transform,
 * scaled by `options.scale`. Leaves the context state as it found it.
 */
export function renderAnnotations(
  ctx: Canvas2D,
  annotations: readonly Annotation[],
  options: RenderAnnotationsOptions = {},
): void {
  const scale = options.scale && options.scale > 0 ? options.scale : 1;
  const pinRadius = resolvePinRadius(options);
  ctx.save();
  if (scale !== 1) ctx.scale(scale, scale);
  let selected: Annotation | undefined;
  for (const a of annotations) {
    ctx.save();
    switch (a.type) {
      case "pin":
        drawPin(ctx, a, pinRadius, scale);
        break;
      case "freehand":
        drawFreehand(ctx, a);
        break;
      case "arrow":
        drawArrow(ctx, a);
        break;
      case "rectangle":
        drawRectangle(ctx, a);
        break;
      case "text":
        drawText(ctx, a);
        break;
    }
    ctx.restore();
    if (options.selectedId !== undefined && a.id === options.selectedId) selected = a;
  }
  if (selected) drawSelection(ctx, selected, pinRadius, scale);
  ctx.restore();
}

export const defaultAnnotationRenderer: AnnotationRenderer = {
  render(ctx, annotations, options) {
    renderAnnotations(ctx, annotations, options);
  },
};
