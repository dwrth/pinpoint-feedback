import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationEditor, AnnotationEditorOptions, AnnotationEditorState } from "../src/interfaces";
import type { Annotation, PinAnnotation, TextAnnotation } from "../src/types";
import { createAnnotationEditor, screenToImage } from "../src/annotation/index";
import { type RecordingContext, createRecordingContext } from "./annotation-helpers";

const IMAGE_W = 1000;
const IMAGE_H = 500;
const CONTAINER_W = 500;
const CONTAINER_H = 250;

let contexts: RecordingContext[];
let container: HTMLElement;
let editor: AnnotationEditor | undefined;
const restorers: (() => void)[] = [];

function stubProperty(proto: object, key: string, descriptor: PropertyDescriptor): void {
  const original = Object.getOwnPropertyDescriptor(proto, key);
  Object.defineProperty(proto, key, { configurable: true, ...descriptor });
  restorers.push(() => {
    if (original) Object.defineProperty(proto, key, original);
    else delete (proto as Record<string, unknown>)[key];
  });
}

beforeEach(() => {
  contexts = [];
  stubProperty(HTMLCanvasElement.prototype, "getContext", {
    value(this: HTMLCanvasElement) {
      const rec = createRecordingContext(this);
      contexts.push(rec);
      return rec.ctx;
    },
  });
  stubProperty(HTMLCanvasElement.prototype, "toBlob", {
    value(this: HTMLCanvasElement, cb: (b: Blob | null) => void, type?: string) {
      cb(new Blob([`${this.width}x${this.height}`], { type: type ?? "image/png" }));
    },
  });
  stubProperty(HTMLElement.prototype, "clientWidth", { get: () => CONTAINER_W });
  stubProperty(HTMLElement.prototype, "clientHeight", { get: () => CONTAINER_H });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: IMAGE_W, height: IMAGE_H, close: vi.fn() })),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  container.remove();
  for (const restore of restorers.splice(0).reverse()) restore();
  vi.unstubAllGlobals();
});

async function setup(options: Partial<AnnotationEditorOptions> = {}) {
  const onChange = vi.fn<(a: Annotation[]) => void>();
  editor = createAnnotationEditor({
    container,
    image: new Blob(["png"], { type: "image/png" }),
    onChange,
    ...options,
  });
  await editor.ready;
  const wrapper = container.firstElementChild as HTMLElement;
  return { editor, wrapper, onChange };
}

function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  init: Partial<PointerEventInit> = {},
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      clientX: x,
      clientY: y,
      pointerId: 1,
      button: type === "pointermove" ? -1 : 0,
      pointerType: "mouse",
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

function drag(target: Element, points: [number, number][], init: Partial<PointerEventInit> = {}): void {
  const [first, ...rest] = points;
  pointer(target, "pointerdown", first![0], first![1], init);
  for (const [x, y] of rest) pointer(target, "pointermove", x, y, init);
  const last = points[points.length - 1]!;
  pointer(target, "pointerup", last[0], last[1], init);
}

function click(target: Element, x: number, y: number): void {
  drag(target, [[x, y]]);
}

function wheel(target: Element, init: { deltaX?: number; deltaY?: number; ctrlKey?: boolean; clientX: number; clientY: number }): void {
  const e = new WheelEvent("wheel", { deltaX: init.deltaX, deltaY: init.deltaY, bubbles: true, cancelable: true });
  for (const k of ["ctrlKey", "clientX", "clientY"] as const) {
    Object.defineProperty(e, k, { value: init[k] ?? false });
  }
  target.dispatchEvent(e);
}

function key(target: Element, k: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
}

describe("createAnnotationEditor: mounting", () => {
  it("mounts an accessible wrapper with canvas and live region", async () => {
    const { wrapper, editor } = await setup();
    expect(wrapper.getAttribute("role")).toBe("application");
    expect(wrapper.getAttribute("aria-label")).toBeTruthy();
    expect(wrapper.tabIndex).toBe(0);
    expect(wrapper.style.touchAction).toBe("none");
    const canvas = wrapper.querySelector("canvas")!;
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper.querySelector("[aria-live='polite']")).not.toBeNull();
    expect(canvas.width).toBe(CONTAINER_W * (window.devicePixelRatio || 1));

    const state = editor.getState();
    expect(state.fitZoom).toBe(0.5);
    expect(state.zoom).toBe(0.5);
    expect(state.tool).toBe("pin");
    expect(state.editingText).toBe(false);
  });

  it("draws the image then annotations on the first frame", async () => {
    await setup({
      initialAnnotations: [
        { id: "x", type: "pin", color: "#ef4444", strokeWidth: 4, at: { x: 1, y: 1 }, number: 9 },
      ],
    });
    const rec = contexts[0]!;
    const drawImage = rec.named("drawImage");
    expect(drawImage).toHaveLength(1);
    expect(drawImage[0]!.args.slice(1)).toEqual([0, 0, IMAGE_W, IMAGE_H]);
    const drawIdx = rec.calls.findIndex((c) => c.name === "drawImage");
    const pinText = rec.calls.findIndex((c) => c.name === "fillText" && c.args[0] === "1");
    expect(pinText).toBeGreaterThan(drawIdx);
  });

  it("accepts an HTMLCanvasElement source", async () => {
    const source = document.createElement("canvas");
    source.width = 300;
    source.height = 150;
    const { editor } = await setup({ image: source });
    expect(editor.getState().fitZoom).toBeCloseTo(Math.min(500 / 300, 250 / 150));
  });
});

describe("createAnnotationEditor: tools", () => {
  it("places pins in image space at fit zoom", async () => {
    const { editor, wrapper, onChange } = await setup();
    click(wrapper, 100, 50);
    click(wrapper, 300, 200);
    const list = editor.getAnnotations() as PinAnnotation[];
    expect(list.map((p) => [p.type, p.at, p.number])).toEqual([
      ["pin", { x: 200, y: 100 }, 1],
      ["pin", { x: 600, y: 400 }, 2],
    ]);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(editor.getState().annotationCount).toBe(2);
    expect(wrapper.querySelector("[aria-live]")!.textContent).toContain("Pin 2 added");
  });

  it("maps pointer positions through zoom and pan", async () => {
    const { editor, wrapper } = await setup();
    editor.setZoom(2, { x: 100, y: 100 });
    const expected = screenToImage({ x: 260, y: 140 }, { zoom: 2, panX: 100 - 100 * 4, panY: 100 - 100 * 4 });
    click(wrapper, 260, 140);
    expect((editor.getAnnotations()[0] as PinAnnotation).at).toEqual(expected);
    expect(editor.getState().zoom).toBe(2);
  });

  it("ignores pin clicks outside the screenshot", async () => {
    const { editor, wrapper } = await setup();
    editor.setZoom(0.25);
    click(wrapper, 5, 5);
    expect(editor.getAnnotations()).toHaveLength(0);
  });

  it("draws freehand strokes, simplified, in image space", async () => {
    const { editor, wrapper } = await setup();
    editor.setTool("freehand");
    drag(wrapper, [
      [10, 10],
      [20, 10],
      [30, 10],
      [40, 10],
      [40, 20],
      [40, 30],
    ]);
    const [stroke] = editor.getAnnotations();
    expect(stroke?.type).toBe("freehand");
    expect(stroke && stroke.type === "freehand" && stroke.points).toEqual([
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: 60 },
    ]);
    expect(stroke?.strokeWidth).toBe(editor.getState().strokeWidth);
  });

  it("draws arrows and ignores zero-length drags", async () => {
    const { editor, wrapper } = await setup();
    editor.setTool("arrow");
    drag(wrapper, [
      [10, 10],
      [11, 11],
    ]);
    expect(editor.getAnnotations()).toHaveLength(0);
    drag(wrapper, [
      [10, 10],
      [60, 35],
    ]);
    expect(editor.getAnnotations()[0]).toMatchObject({ type: "arrow", from: { x: 20, y: 20 }, to: { x: 120, y: 70 } });
  });

  it("normalises rectangles drawn backwards and ignores tiny ones", async () => {
    const { editor, wrapper } = await setup();
    editor.setTool("rectangle");
    drag(wrapper, [
      [100, 100],
      [101, 140],
    ]);
    expect(editor.getAnnotations()).toHaveLength(0);
    drag(wrapper, [
      [100, 100],
      [50, 40],
    ]);
    expect(editor.getAnnotations()[0]).toMatchObject({ type: "rectangle", x: 100, y: 80, width: 100, height: 120 });
  });

  it("creates, edits and cancels text via the textarea overlay", async () => {
    const { editor, wrapper } = await setup();
    const states: AnnotationEditorState[] = [];
    editor.subscribe((s) => states.push(s));
    editor.setTool("text");
    click(wrapper, 50, 25);
    let ta = wrapper.querySelector("textarea")!;
    expect(ta).not.toBeNull();
    expect(editor.getState().editingText).toBe(true);
    expect(ta.style.left).toBe("50px");
    ta.value = "Hello\nworld";
    key(ta, "Enter", { shiftKey: true });
    expect(wrapper.querySelector("textarea")).not.toBeNull();
    key(ta, "Enter");
    expect(wrapper.querySelector("textarea")).toBeNull();
    expect(editor.getState().editingText).toBe(false);
    expect(states.some((s) => s.editingText)).toBe(true);
    const [text] = editor.getAnnotations() as TextAnnotation[];
    expect(text).toMatchObject({ type: "text", at: { x: 100, y: 50 }, text: "Hello\nworld" });
    expect(text!.fontSize).toBeGreaterThan(0);

    click(wrapper, 300, 200);
    ta = wrapper.querySelector("textarea")!;
    ta.value = "discard me";
    key(ta, "Escape");
    expect(editor.getAnnotations()).toHaveLength(1);

    click(wrapper, 300, 200);
    key(wrapper.querySelector("textarea")!, "Enter");
    expect(editor.getAnnotations()).toHaveLength(1);

    click(wrapper, 52, 27);
    ta = wrapper.querySelector("textarea")!;
    expect(ta.value).toBe("Hello\nworld");
    ta.value = "Changed";
    key(ta, "Enter");
    expect((editor.getAnnotations()[0] as TextAnnotation).text).toBe("Changed");
    editor.undo();
    expect((editor.getAnnotations()[0] as TextAnnotation).text).toBe("Hello\nworld");
  });

  it("commits pending text on blur and when switching tools", async () => {
    const { editor, wrapper } = await setup({ tool: "text" });
    click(wrapper, 50, 25);
    const ta = wrapper.querySelector("textarea")!;
    ta.value = "via blur";
    ta.dispatchEvent(new Event("blur"));
    expect(editor.getAnnotations()).toHaveLength(1);

    click(wrapper, 100, 100);
    wrapper.querySelector("textarea")!.value = "via tool";
    editor.setTool("pin");
    expect(editor.getAnnotations()).toHaveLength(2);
  });
});

describe("createAnnotationEditor: select, move, delete", () => {
  it("selects, moves (one undo step) and deletes with renumbering", async () => {
    const { editor, wrapper } = await setup();
    click(wrapper, 50, 50);
    click(wrapper, 150, 50);
    click(wrapper, 250, 50);
    editor.setTool("select");

    drag(wrapper, [
      [150, 50],
      [160, 60],
      [170, 70],
    ]);
    const second = editor.getAnnotations()[1] as PinAnnotation;
    expect(editor.getState().selectedId).toBe(second.id);
    expect(second.at).toEqual({ x: 340, y: 140 });

    editor.undo();
    expect((editor.getAnnotations()[1] as PinAnnotation).at).toEqual({ x: 300, y: 100 });
    editor.redo();
    expect((editor.getAnnotations()[1] as PinAnnotation).at).toEqual({ x: 340, y: 140 });

    key(wrapper, "Delete");
    const pins = editor.getAnnotations() as PinAnnotation[];
    expect(pins.map((p) => p.number)).toEqual([1, 2]);
    expect(pins.map((p) => p.at.x)).toEqual([100, 500]);
    expect(editor.getState().selectedId).toBeUndefined();

    editor.undo();
    expect((editor.getAnnotations() as PinAnnotation[]).map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("pans when dragging empty space in select mode", async () => {
    const { editor, wrapper } = await setup();
    editor.setZoom(2, { x: 0, y: 0 });
    editor.setTool("select");
    drag(wrapper, [
      [200, 200],
      [150, 120],
    ]);
    click(wrapper, 0, 0);
    expect(editor.getAnnotations()).toHaveLength(0);
    editor.setTool("pin");
    click(wrapper, 0, 0);
    expect((editor.getAnnotations()[0] as PinAnnotation).at).toEqual({ x: 25, y: 40 });
  });

  it("pans with space+drag in any tool", async () => {
    const { editor, wrapper } = await setup();
    editor.setZoom(2, { x: 0, y: 0 });
    key(wrapper, " ");
    drag(wrapper, [
      [200, 200],
      [100, 100],
    ]);
    wrapper.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    expect(editor.getAnnotations()).toHaveLength(0);
    click(wrapper, 0, 0);
    expect((editor.getAnnotations()[0] as PinAnnotation).at).toEqual({ x: 50, y: 50 });
  });

  it("re-edits text on double-click in select mode", async () => {
    const { editor, wrapper } = await setup({
      tool: "select",
      initialAnnotations: [
        { id: "t", type: "text", color: "#000", strokeWidth: 4, at: { x: 100, y: 100 }, text: "Hi", fontSize: 20 },
      ],
    });
    click(wrapper, 52, 52);
    click(wrapper, 52, 52);
    const ta = wrapper.querySelector("textarea");
    expect(ta?.value).toBe("Hi");
  });

  it("applies colour changes to the selected annotation", async () => {
    const { editor, wrapper } = await setup();
    click(wrapper, 50, 50);
    editor.setTool("select");
    click(wrapper, 50, 50);
    editor.setColor("#3b82f6");
    expect(editor.getAnnotations()[0]!.color).toBe("#3b82f6");
    editor.undo();
    expect(editor.getAnnotations()[0]!.color).toBe("#ef4444");
  });
});

describe("createAnnotationEditor: history, zoom and keyboard", () => {
  it("supports undo/redo shortcuts, clear and reset", async () => {
    const { editor, wrapper, onChange } = await setup();
    click(wrapper, 50, 50);
    click(wrapper, 60, 60);
    key(wrapper, "z", { ctrlKey: true });
    expect(editor.getAnnotations()).toHaveLength(1);
    key(wrapper, "z", { metaKey: true, shiftKey: true });
    expect(editor.getAnnotations()).toHaveLength(2);
    key(wrapper, "z", { ctrlKey: true });
    key(wrapper, "y", { ctrlKey: true });
    expect(editor.getAnnotations()).toHaveLength(2);

    editor.clear();
    expect(editor.getAnnotations()).toHaveLength(0);
    editor.undo();
    expect(editor.getAnnotations()).toHaveLength(2);
    expect(editor.getState().canUndo).toBe(true);

    editor.setZoom(3);
    editor.reset();
    const state = editor.getState();
    expect(state).toMatchObject({ annotationCount: 0, canUndo: false, canRedo: false, zoom: 0.5 });
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("makes setAnnotations undoable and returns copies", async () => {
    const { editor } = await setup();
    const input: Annotation[] = [
      { id: "a", type: "pin", color: "#000", strokeWidth: 4, at: { x: 1, y: 1 }, number: 5 },
    ];
    editor.setAnnotations(input);
    const out = editor.getAnnotations();
    expect((out[0] as PinAnnotation).number).toBe(1);
    (out[0] as PinAnnotation).at.x = 999;
    input[0]!.color = "#fff";
    expect(editor.getAnnotations()[0]).toMatchObject({ color: "#000", at: { x: 1, y: 1 } });
    editor.undo();
    expect(editor.getAnnotations()).toHaveLength(0);
  });

  it("zooms with ctrl+wheel around the cursor and pans with plain wheel", async () => {
    const { editor, wrapper } = await setup();
    const before = screenToImage({ x: 200, y: 100 }, { zoom: 0.5, panX: 0, panY: 0 });
    wheel(wrapper, { deltaY: -100, ctrlKey: true, clientX: 200, clientY: 100 });
    const zoom = editor.getState().zoom;
    expect(zoom).toBeGreaterThan(0.5);
    click(wrapper, 200, 100);
    const at = (editor.getAnnotations()[0] as PinAnnotation).at;
    expect(at.x).toBeCloseTo(before.x, 6);
    expect(at.y).toBeCloseTo(before.y, 6);

    editor.undo();
    wheel(wrapper, { deltaX: 20, deltaY: 10, clientX: 0, clientY: 0 });
    click(wrapper, 200, 100);
    const panned = (editor.getAnnotations()[0] as PinAnnotation).at;
    expect(panned.x).toBeCloseTo(before.x + 20 / zoom, 6);
    expect(panned.y).toBeCloseTo(before.y + 10 / zoom, 6);
  });

  it("clamps zoom and supports keyboard zoom", async () => {
    const { editor, wrapper } = await setup({ maxZoom: 4 });
    editor.setZoom(100);
    expect(editor.getState().zoom).toBe(4);
    editor.setZoom(0.0001);
    expect(editor.getState().zoom).toBeCloseTo(0.1);
    key(wrapper, "0");
    expect(editor.getState().zoom).toBe(0.5);
    key(wrapper, "+");
    expect(editor.getState().zoom).toBeCloseTo(0.625);
    editor.zoomOut();
    expect(editor.getState().zoom).toBeCloseTo(0.5);
    editor.zoomIn();
    editor.fitToView();
    expect(editor.getState().zoom).toBe(0.5);
  });

  it("does not handle shortcuts while typing in the textarea", async () => {
    const { editor, wrapper } = await setup();
    click(wrapper, 50, 50);
    editor.setTool("text");
    click(wrapper, 100, 100);
    const ta = wrapper.querySelector("textarea")!;
    key(ta, "z", { ctrlKey: true });
    key(ta, "0");
    expect(editor.getAnnotations()).toHaveLength(1);
    expect(wrapper.querySelector("textarea")).not.toBeNull();
  });

  it("cancels an in-progress stroke on Escape", async () => {
    const { editor, wrapper } = await setup({ tool: "rectangle" });
    pointer(wrapper, "pointerdown", 10, 10);
    pointer(wrapper, "pointermove", 100, 100);
    key(wrapper, "Escape");
    pointer(wrapper, "pointerup", 100, 100);
    expect(editor.getAnnotations()).toHaveLength(0);
  });

  it("pinch-zooms with two touch pointers", async () => {
    const { editor, wrapper } = await setup();
    const touch = { pointerType: "touch" };
    pointer(wrapper, "pointerdown", 100, 100, { ...touch, pointerId: 1 });
    pointer(wrapper, "pointerdown", 200, 100, { ...touch, pointerId: 2 });
    pointer(wrapper, "pointermove", 250, 100, { ...touch, pointerId: 2 });
    pointer(wrapper, "pointerup", 250, 100, { ...touch, pointerId: 2 });
    pointer(wrapper, "pointerup", 100, 100, { ...touch, pointerId: 1 });
    expect(editor.getState().zoom).toBeCloseTo(0.75);
    expect(editor.getAnnotations()).toHaveLength(0);
  });
});

describe("createAnnotationEditor: export and lifecycle", () => {
  it("exports at full screenshot resolution without touching the source", async () => {
    const { editor, wrapper } = await setup();
    click(wrapper, 50, 50);
    const blob = await editor.exportAnnotated();
    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe(`${IMAGE_W}x${IMAGE_H}`);
    const exportCtx = contexts[contexts.length - 1]!;
    expect(exportCtx.named("drawImage")[0]!.args.slice(1)).toEqual([0, 0, IMAGE_W, IMAGE_H]);
    expect(exportCtx.named("scale")).toHaveLength(0);
    expect(exportCtx.named("arc")[0]!.args.slice(0, 2)).toEqual([100, 100]);
    const jpeg = await editor.exportAnnotated("image/jpeg", 0.8);
    expect(jpeg.type).toBe("image/jpeg");
  });

  it("emits state changes to subscribers and onStateChange", async () => {
    const onStateChange = vi.fn();
    const { editor } = await setup({ onStateChange });
    const listener = vi.fn();
    const off = editor.subscribe(listener);
    editor.setTool("arrow");
    editor.setColor("#22c55e");
    editor.setStrokeWidth(10);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.lastCall![0]).toMatchObject({ tool: "arrow", color: "#22c55e", strokeWidth: 10 });
    off();
    editor.setTool("pin");
    expect(listener).toHaveBeenCalledTimes(3);
    expect(onStateChange).toHaveBeenCalled();
  });

  it("destroys idempotently and removes DOM", async () => {
    const { editor } = await setup();
    const close = (await (globalThis.createImageBitmap as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value) as {
      close: ReturnType<typeof vi.fn>;
    };
    editor.destroy();
    editor.destroy();
    expect(container.children).toHaveLength(0);
    expect(close.close).toHaveBeenCalledTimes(1);
    await expect(editor.exportAnnotated()).rejects.toThrow();
  });

  it("refits on container resize when at fit zoom", async () => {
    let width = CONTAINER_W;
    stubProperty(HTMLElement.prototype, "clientWidth", { get: () => width });
    const { editor } = await setup();
    width = 250;
    editor.resize();
    expect(editor.getState().fitZoom).toBe(0.25);
    expect(editor.getState().zoom).toBe(0.25);
    editor.setZoom(0.5);
    width = 500;
    editor.resize();
    expect(editor.getState().zoom).toBe(1);
  });
});
