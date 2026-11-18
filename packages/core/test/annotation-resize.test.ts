import { describe, expect, it } from "vitest";
import type { Annotation, FreehandAnnotation, PinAnnotation, RectangleAnnotation, TextAnnotation } from "../src/types";
import {
  type Rect,
  type ResizeHandle,
  geometryBounds,
  handlePosition,
  resizeAnnotation,
  resizeHandlesFor,
  resizeRect,
} from "../src/annotation/geometry";

const base = { color: "#000", strokeWidth: 4 };
const box: Rect = { x: 100, y: 80, width: 100, height: 120 };

const rect = (overrides: Partial<RectangleAnnotation> = {}): RectangleAnnotation => ({
  ...base,
  id: "r",
  type: "rectangle",
  x: 100,
  y: 80,
  width: 100,
  height: 120,
  ...overrides,
});

const text = (overrides: Partial<TextAnnotation> = {}): TextAnnotation => ({
  ...base,
  id: "t",
  type: "text",
  at: { x: 100, y: 100 },
  text: "Hi",
  fontSize: 20,
  ...overrides,
});

const freehand = (points: FreehandAnnotation["points"]): FreehandAnnotation => ({ ...base, id: "f", type: "freehand", points });

describe("geometryBounds", () => {
  it("uses the pin radius for pins", () => {
    const pin: PinAnnotation = { ...base, id: "p", type: "pin", at: { x: 50, y: 50 }, number: 1 };
    expect(geometryBounds(pin)).toEqual({ x: 36, y: 36, width: 28, height: 28 });
    expect(geometryBounds(pin, { pinRadius: 5 })).toEqual({ x: 45, y: 45, width: 10, height: 10 });
  });

  it("measures text with the supplied measure function, or an estimate without one", () => {
    const t = text();
    expect(geometryBounds(t, { measureText: (s) => s.length * 10 })).toEqual({ x: 100, y: 100, width: 20, height: 25 });
    expect(geometryBounds(t).width).toBeCloseTo(2 * 20 * 0.58);
  });

  it("normalises boxes drawn backwards", () => {
    expect(geometryBounds(rect({ x: 200, y: 200, width: -100, height: -120 }))).toEqual({ x: 100, y: 80, width: 100, height: 120 });
    expect(geometryBounds({ ...rect(), type: "redaction" })).toEqual(box);
  });

  it("uses the normalised endpoints for arrows", () => {
    expect(geometryBounds({ ...base, id: "a", type: "arrow", from: { x: 200, y: 100 }, to: { x: 100, y: 40 } })).toEqual({
      x: 100,
      y: 40,
      width: 100,
      height: 60,
    });
  });

  it("bounds freehand points and returns an empty box for an empty stroke", () => {
    expect(geometryBounds(freehand([{ x: 10, y: 5 }, { x: 30, y: 25 }, { x: 20, y: 0 }]))).toEqual({ x: 10, y: 0, width: 20, height: 25 });
    expect(geometryBounds(freehand([]))).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("resizeHandlesFor", () => {
  it("gives pins no handles and text only its corners", () => {
    expect(resizeHandlesFor({ ...base, id: "p", type: "pin", at: { x: 0, y: 0 }, number: 1 }, box)).toEqual([]);
    expect(resizeHandlesFor(text(), { x: 0, y: 0, width: 20, height: 25 })).toEqual(["nw", "ne", "se", "sw"]);
  });

  it("gives boxes and paths all eight handles", () => {
    expect(resizeHandlesFor(rect(), box)).toHaveLength(8);
    expect(resizeHandlesFor(freehand([{ x: 0, y: 0 }, { x: 5, y: 5 }]), { x: 0, y: 0, width: 5, height: 5 })).toHaveLength(8);
  });

  it("keeps only the handles along the extent of a straight arrow", () => {
    const horizontal = { ...base, id: "a", type: "arrow" as const, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };
    expect(resizeHandlesFor(horizontal, { x: 0, y: 0, width: 100, height: 0 })).toEqual(["e", "w"]);
    const vertical = { ...horizontal, from: { x: 0, y: 0 }, to: { x: 0, y: 100 } };
    expect(resizeHandlesFor(vertical, { x: 0, y: 0, width: 0, height: 100 })).toEqual(["n", "s"]);
  });

  it("offers no handles for a stroke with no extent", () => {
    expect(resizeHandlesFor(freehand([]), { x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
  });
});

describe("handlePosition", () => {
  it.each<[ResizeHandle, number, number]>([
    ["nw", 100, 80],
    ["n", 150, 80],
    ["ne", 200, 80],
    ["e", 200, 140],
    ["se", 200, 200],
    ["s", 150, 200],
    ["sw", 100, 200],
    ["w", 100, 140],
  ])("places the %s handle on the box outline", (handle, x, y) => {
    expect(handlePosition(box, handle)).toEqual({ x, y });
  });
});

describe("resizeRect", () => {
  it.each<[ResizeHandle, { x: number; y: number }, Rect]>([
    ["nw", { x: 50, y: 40 }, { x: 50, y: 40, width: 150, height: 160 }],
    ["n", { x: 0, y: 40 }, { x: 100, y: 40, width: 100, height: 160 }],
    ["ne", { x: 250, y: 40 }, { x: 100, y: 40, width: 150, height: 160 }],
    ["e", { x: 250, y: 0 }, { x: 100, y: 80, width: 150, height: 120 }],
    ["se", { x: 250, y: 250 }, { x: 100, y: 80, width: 150, height: 170 }],
    ["s", { x: 0, y: 250 }, { x: 100, y: 80, width: 100, height: 170 }],
    ["sw", { x: 50, y: 250 }, { x: 50, y: 80, width: 150, height: 170 }],
    ["w", { x: 50, y: 0 }, { x: 50, y: 80, width: 150, height: 120 }],
  ])("moves the %s edges to the pointer", (handle, pointer, expected) => {
    expect(resizeRect(box, handle, pointer, 8)).toEqual(expected);
  });

  it("keeps each side at least the minimum size and the opposite edge fixed", () => {
    expect(resizeRect(box, "e", { x: 0, y: 0 }, 8)).toEqual({ x: 100, y: 80, width: 8, height: 120 });
    expect(resizeRect(box, "w", { x: 500, y: 0 }, 8)).toEqual({ x: 192, y: 80, width: 8, height: 120 });
    expect(resizeRect(box, "n", { x: 0, y: 500 }, 8)).toEqual({ x: 100, y: 192, width: 100, height: 8 });
    expect(resizeRect(box, "s", { x: 0, y: -500 }, 8)).toEqual({ x: 100, y: 80, width: 100, height: 8 });
  });
});

describe("resizeAnnotation", () => {
  it("leaves pins alone", () => {
    const pin: PinAnnotation = { ...base, id: "p", type: "pin", at: { x: 1, y: 1 }, number: 1 };
    expect(resizeAnnotation(pin, box, "se", { x: 500, y: 500 }, 8)).toBe(pin);
  });

  it("takes the new box for rectangles and redactions", () => {
    expect(resizeAnnotation(rect(), box, "nw", { x: 50, y: 40 }, 8)).toMatchObject({ x: 50, y: 40, width: 150, height: 160 });
    expect(resizeAnnotation({ ...rect(), type: "redaction" }, box, "se", { x: 250, y: 250 }, 8)).toMatchObject({
      x: 100,
      y: 80,
      width: 150,
      height: 170,
    });
  });

  it("stretches arrow endpoints proportionally", () => {
    const arrow: Annotation = { ...base, id: "a", type: "arrow", from: { x: 0, y: 0 }, to: { x: 100, y: 50 } };
    expect(resizeAnnotation(arrow, { x: 0, y: 0, width: 100, height: 50 }, "se", { x: 200, y: 100 }, 8)).toMatchObject({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 100 },
    });
  });

  it("stretches stroke points, keeping a flat stroke flat", () => {
    const stroke = freehand([
      { x: 0, y: 10 },
      { x: 50, y: 10 },
    ]);
    expect(resizeAnnotation(stroke, { x: 0, y: 10, width: 50, height: 0 }, "e", { x: 100, y: 10 }, 8)).toMatchObject({
      points: [
        { x: 0, y: 10 },
        { x: 100, y: 10 },
      ],
    });
  });

  it("does not scale a stroke that has no extent", () => {
    const dot = freehand([{ x: 10, y: 10 }]);
    expect(resizeAnnotation(dot, { x: 10, y: 10, width: 0, height: 0 }, "se", { x: 30, y: 30 }, 4)).toMatchObject({
      points: [{ x: 10, y: 10 }],
    });
  });

  describe("text", () => {
    const at = { x: 100, y: 100 };
    const bounds: Rect = { x: 100, y: 100, width: 20, height: 25 };

    it("scales from the corner opposite the handle", () => {
      expect(resizeAnnotation(text(), bounds, "se", { x: 180, y: 150 }, 8)).toMatchObject({ at, fontSize: 80 });
      expect(resizeAnnotation(text(), bounds, "nw", { x: 60, y: 50 }, 8)).toMatchObject({ at: { x: 60, y: 50 }, fontSize: 60 });
      expect(resizeAnnotation(text(), bounds, "ne", { x: 160, y: 60 }, 8)).toMatchObject({ at: { x: 100, y: 50 }, fontSize: 60 });
      expect(resizeAnnotation(text(), bounds, "sw", { x: 60, y: 140 }, 8)).toMatchObject({ at: { x: 60, y: 100 }, fontSize: 60 });
    });

    it("never shrinks below the minimum font size", () => {
      expect(resizeAnnotation(text(), bounds, "se", { x: 100, y: 100 }, 8)).toMatchObject({ at, fontSize: 8 });
    });

    it("keeps the minimum font size when the text has no width or height", () => {
      expect(resizeAnnotation(text(), { x: 100, y: 100, width: 0, height: 0 }, "se", { x: 150, y: 150 }, 8)).toMatchObject({
        fontSize: 8,
      });
    });
  });
});
