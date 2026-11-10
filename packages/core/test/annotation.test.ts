import { describe, expect, it } from "vitest";
import type { Annotation, ArrowAnnotation, PinAnnotation, TextAnnotation } from "../src/types";
import {
  ANNOTATION_COLORS,
  AnnotationHistory,
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_STROKE_WIDTH,
  annotationBounds,
  clampPan,
  clampZoom,
  cloneAnnotations,
  computeFitZoom,
  defaultAnnotationRenderer,
  findAnnotationAt,
  fitView,
  hitTestAnnotation,
  imageToScreen,
  nextPinNumber,
  normalizeRect,
  normalizeRectangle,
  pinRadiusFor,
  renderAnnotations,
  renumberPins,
  resolveZoomLimits,
  screenToImage,
  simplifyPath,
  translateAnnotation,
  zoomAround,
} from "../src/annotation/index";
import { createRecordingContext } from "./annotation-helpers";

const pin = (id: string, number: number, x = 0, y = 0): PinAnnotation => ({
  id,
  type: "pin",
  color: "#ef4444",
  strokeWidth: 4,
  at: { x, y },
  number,
});

describe("constants", () => {
  it("exposes a palette with red first", () => {
    expect(ANNOTATION_COLORS.length).toBeGreaterThanOrEqual(5);
    expect(ANNOTATION_COLORS[0]).toBe(DEFAULT_ANNOTATION_COLOR);
    for (const c of ANNOTATION_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_STROKE_WIDTH).toBeGreaterThan(0);
  });

  it("scales pin radius with image width but never below 14", () => {
    expect(pinRadiusFor(undefined)).toBe(14);
    expect(pinRadiusFor(800)).toBe(14);
    expect(pinRadiusFor(2880)).toBe(32);
  });
});

describe("view transform", () => {
  const views = [
    { zoom: 1, panX: 0, panY: 0 },
    { zoom: 0.37, panX: 12.5, panY: -40.25 },
    { zoom: 3.3, panX: -1234.5, panY: 77 },
  ];

  it("round-trips screen <-> image coordinates", () => {
    for (const view of views) {
      for (const p of [
        { x: 0, y: 0 },
        { x: 123.456, y: 789.012 },
        { x: -5, y: 1e4 },
      ]) {
        const back = screenToImage(imageToScreen(p, view), view);
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
      }
    }
  });

  it("maps screen to image space using zoom and pan", () => {
    expect(screenToImage({ x: 110, y: 60 }, { zoom: 2, panX: 10, panY: 20 })).toEqual({ x: 50, y: 20 });
    expect(imageToScreen({ x: 50, y: 20 }, { zoom: 2, panX: 10, panY: 20 })).toEqual({ x: 110, y: 60 });
  });

  it("computes fit zoom and centers the image", () => {
    expect(computeFitZoom({ width: 1000, height: 500 }, { width: 500, height: 500 })).toBe(0.5);
    expect(fitView({ width: 1000, height: 500 }, { width: 500, height: 500 })).toEqual({ zoom: 0.5, panX: 0, panY: 125 });
    expect(computeFitZoom({ width: 0, height: 0 }, { width: 500, height: 500 })).toBe(1);
  });

  it("zooms around an anchor keeping the image point under it fixed", () => {
    const view = { zoom: 0.5, panX: 20, panY: 30 };
    const anchor = { x: 200, y: 150 };
    const before = screenToImage(anchor, view);
    const next = zoomAround(view, 2, anchor);
    expect(next.zoom).toBe(2);
    const after = screenToImage(anchor, next);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("resolves and clamps zoom limits", () => {
    expect(resolveZoomLimits(0.5)).toEqual({ min: 0.1, max: 8 });
    expect(resolveZoomLimits(0.1)).toEqual({ min: 0.05, max: 8 });
    expect(resolveZoomLimits(0.5, 0.25, 4)).toEqual({ min: 0.25, max: 4 });
    const limits = { min: 0.1, max: 8 };
    expect(clampZoom(20, limits)).toBe(8);
    expect(clampZoom(0.01, limits)).toBe(0.1);
    expect(clampZoom(2, limits)).toBe(2);
    expect(clampZoom(Number.NaN, limits)).toBe(0.1);
  });

  it("keeps a small image inside the container", () => {
    const v = clampPan({ zoom: 0.5, panX: -400, panY: 900 }, { width: 400, height: 200 }, { width: 500, height: 500 });
    expect(v).toEqual({ zoom: 0.5, panX: 0, panY: 400 });
  });

  it("limits overscroll of a large image", () => {
    const image = { width: 2000, height: 2000 };
    const container = { width: 400, height: 400 };
    const v = clampPan({ zoom: 1, panX: 1000, panY: -5000 }, image, container);
    expect(v.panX).toBe(48);
    expect(v.panY).toBe(400 - 2000 - 48);
    const ok = clampPan({ zoom: 1, panX: -100, panY: -200 }, image, container);
    expect(ok).toEqual({ zoom: 1, panX: -100, panY: -200 });
  });
});

describe("geometry helpers", () => {
  it("normalises rectangles", () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 4, y: 2 })).toEqual({ x: 4, y: 2, width: 6, height: 18 });
    const r = normalizeRectangle({ id: "r", type: "rectangle", color: "#000", strokeWidth: 2, x: 10, y: 10, width: -5, height: -8 });
    expect(r).toMatchObject({ x: 5, y: 2, width: 5, height: 8 });
  });

  it("simplifies paths with RDP keeping endpoints", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyPath(line, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 49, y: 0 },
    ]);
    const corner = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ];
    expect(simplifyPath(corner, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    const short = [{ x: 1, y: 1 }];
    const out = simplifyPath(short, 1);
    expect(out).toEqual(short);
    expect(out[0]).not.toBe(short[0]);
  });

  it("renumbers pins sequentially in creation order", () => {
    const list: Annotation[] = [
      pin("a", 1),
      { id: "r", type: "rectangle", color: "#000", strokeWidth: 2, x: 0, y: 0, width: 5, height: 5 },
      pin("c", 3),
      pin("d", 7),
    ];
    const out = renumberPins(list);
    expect(out.filter((a) => a.type === "pin").map((a) => (a as PinAnnotation).number)).toEqual([1, 2, 3]);
    expect(out[0]).toBe(list[0]);
    expect(out[1]).toBe(list[1]);
    expect(list[2]).toMatchObject({ number: 3 });
    expect(nextPinNumber(out)).toBe(4);
  });

  it("translates every annotation type", () => {
    const arrow: ArrowAnnotation = { id: "a", type: "arrow", color: "#000", strokeWidth: 2, from: { x: 0, y: 0 }, to: { x: 5, y: 5 } };
    expect(translateAnnotation(arrow, 1, 2)).toMatchObject({ from: { x: 1, y: 2 }, to: { x: 6, y: 7 } });
    expect(translateAnnotation(pin("p", 1, 3, 3), -3, -3).at).toEqual({ x: 0, y: 0 });
    expect(
      translateAnnotation({ id: "f", type: "freehand", color: "#000", strokeWidth: 2, points: [{ x: 1, y: 1 }] }, 1, 1).points,
    ).toEqual([{ x: 2, y: 2 }]);
    expect(
      translateAnnotation({ id: "r", type: "rectangle", color: "#000", strokeWidth: 2, x: 1, y: 1, width: 2, height: 2 }, 1, 1),
    ).toMatchObject({ x: 2, y: 2, width: 2, height: 2 });
  });

  it("deep-clones annotations", () => {
    const list: Annotation[] = [{ id: "f", type: "freehand", color: "#000", strokeWidth: 2, points: [{ x: 1, y: 1 }] }];
    const copy = cloneAnnotations(list);
    (copy[0] as { points: { x: number }[] }).points[0]!.x = 99;
    expect((list[0] as { points: { x: number }[] }).points[0]!.x).toBe(1);
  });

  it("hit-tests annotations with tolerance", () => {
    expect(hitTestAnnotation(pin("p", 1, 100, 100), { x: 110, y: 100 }, 0, { pinRadius: 14 })).toBe(true);
    expect(hitTestAnnotation(pin("p", 1, 100, 100), { x: 120, y: 100 }, 0, { pinRadius: 14 })).toBe(false);
    expect(hitTestAnnotation(pin("p", 1, 100, 100), { x: 120, y: 100 }, 7, { pinRadius: 14 })).toBe(true);

    const rect: Annotation = { id: "r", type: "rectangle", color: "#000", strokeWidth: 4, x: 0, y: 0, width: 100, height: 50 };
    expect(hitTestAnnotation(rect, { x: 50, y: 1 }, 2)).toBe(true);
    expect(hitTestAnnotation(rect, { x: 50, y: 25 }, 2)).toBe(false);
    expect(hitTestAnnotation(rect, { x: 101, y: 25 }, 2)).toBe(true);

    const arrow: Annotation = { id: "a", type: "arrow", color: "#000", strokeWidth: 4, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };
    expect(hitTestAnnotation(arrow, { x: 50, y: 3 }, 2)).toBe(true);
    expect(hitTestAnnotation(arrow, { x: 50, y: 10 }, 2)).toBe(false);

    const free: Annotation = {
      id: "f",
      type: "freehand",
      color: "#000",
      strokeWidth: 4,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ],
    };
    expect(hitTestAnnotation(free, { x: 15, y: 5 }, 1)).toBe(true);
    expect(hitTestAnnotation(free, { x: 10, y: 0 }, 1)).toBe(false);

    const text: TextAnnotation = { id: "t", type: "text", color: "#000", strokeWidth: 2, at: { x: 10, y: 10 }, text: "ab\nabcd", fontSize: 10 };
    const measure = (t: string) => t.length * 5;
    expect(hitTestAnnotation(text, { x: 28, y: 32 }, 0, { measureText: measure })).toBe(true);
    expect(hitTestAnnotation(text, { x: 31, y: 32 }, 0, { measureText: measure })).toBe(false);
    expect(annotationBounds(text, { measureText: measure })).toEqual({ x: 10, y: 10, width: 20, height: 25 });
  });

  it("finds the topmost annotation", () => {
    const list = [pin("bottom", 1, 50, 50), pin("top", 2, 55, 50)];
    expect(findAnnotationAt(list, { x: 52, y: 50 }, 0, { pinRadius: 14 })?.id).toBe("top");
    expect(findAnnotationAt(list, { x: 500, y: 500 }, 0)).toBeUndefined();
  });
});

describe("AnnotationHistory", () => {
  it("undoes and redoes snapshots", () => {
    const h = new AnnotationHistory<number>();
    expect(h.canUndo).toBe(false);
    expect(h.undo(0)).toBeUndefined();
    h.record(0);
    h.record(1);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(h.redo(0)).toBe(1);
    expect(h.redo(1)).toBe(2);
    expect(h.redo(2)).toBeUndefined();
  });

  it("clears redo on new record and respects the limit", () => {
    const h = new AnnotationHistory<number>(3);
    h.record(0);
    h.undo(1);
    h.record(5);
    expect(h.canRedo).toBe(false);
    for (let i = 0; i < 10; i++) h.record(i);
    let count = 0;
    let state = 10;
    for (let s = h.undo(state); s !== undefined; s = h.undo(state)) {
      state = s;
      count++;
    }
    expect(count).toBe(3);
    expect(state).toBe(7);
    h.clear();
    expect(h.canUndo || h.canRedo).toBe(false);
  });
});

describe("renderAnnotations", () => {
  const all: Annotation[] = [
    pin("p", 1, 10, 10),
    { id: "f", type: "freehand", color: "#22c55e", strokeWidth: 4, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }, { x: 20, y: 5 }] },
    { id: "a", type: "arrow", color: "#3b82f6", strokeWidth: 4, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
    { id: "r", type: "rectangle", color: "#a855f7", strokeWidth: 4, x: 10, y: 10, width: -5, height: 20 },
    { id: "t", type: "text", color: "#111827", strokeWidth: 4, at: { x: 0, y: 0 }, text: "hello\nworld", fontSize: 20 },
  ];

  it("draws each annotation type and balances save/restore", () => {
    const rec = createRecordingContext();
    renderAnnotations(rec.ctx, all);
    expect(rec.named("save").length).toBe(rec.named("restore").length);
    expect(rec.named("fillText").map((c) => c.args[0])).toEqual(["1", "hello", "world"]);
    expect(rec.named("strokeText").map((c) => c.args[0])).toEqual(["hello", "world"]);
    expect(rec.named("quadraticCurveTo").length).toBe(2);
    expect(rec.named("rect")[0]!.args).toEqual([5, 10, 5, 20]);
    expect(rec.named("arc")[0]!.args.slice(0, 3)).toEqual([10, 10, 14]);
    expect(rec.named("scale")).toHaveLength(0);
    expect(rec.named("setLineDash")).toHaveLength(0);
  });

  it("applies scale, image-relative pin size and selection outline", () => {
    const rec = createRecordingContext();
    renderAnnotations(rec.ctx, [all[0]!], { scale: 0.5, imageSize: { width: 2700, height: 1000 }, selectedId: "p" });
    expect(rec.named("scale")[0]!.args).toEqual([0.5, 0.5]);
    expect(rec.named("arc")[0]!.args.slice(0, 3)).toEqual([10, 10, 30]);
    expect(rec.named("setLineDash").length).toBeGreaterThan(0);
  });

  it("draws an arrow head proportional to stroke width", () => {
    const thin = createRecordingContext();
    const thick = createRecordingContext();
    const arrow = (w: number): Annotation => ({ id: "a", type: "arrow", color: "#000", strokeWidth: w, from: { x: 0, y: 0 }, to: { x: 500, y: 0 } });
    renderAnnotations(thin.ctx, [arrow(2)]);
    renderAnnotations(thick.ctx, [arrow(12)]);
    const headBase = (rec: ReturnType<typeof createRecordingContext>) => (rec.named("lineTo")[1]!.args[0] as number);
    expect(500 - headBase(thick)).toBeGreaterThan(500 - headBase(thin));
  });

  it("is exposed through the default renderer", () => {
    const rec = createRecordingContext();
    defaultAnnotationRenderer.render(rec.ctx, [all[2]!]);
    expect(rec.named("stroke").length).toBeGreaterThan(0);
    expect(rec.named("fill").length).toBe(1);
  });

  it("draws a dot for single-point freehand strokes", () => {
    const rec = createRecordingContext();
    renderAnnotations(rec.ctx, [{ id: "f", type: "freehand", color: "#000", strokeWidth: 6, points: [{ x: 3, y: 4 }] }]);
    expect(rec.named("arc")[0]!.args.slice(0, 3)).toEqual([3, 4, 3]);
  });
});
