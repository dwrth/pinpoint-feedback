import { createId } from "../ids";
import type { AnnotationEditor, AnnotationEditorOptions, AnnotationEditorState } from "../interfaces";
import type { Annotation, AnnotationTool, Point, Size, TextAnnotation } from "../types";
import {
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_STROKE_WIDTH,
  SELECTION_COLOR,
  TEXT_FONT_FAMILY,
  TEXT_FONT_WEIGHT,
  TEXT_LINE_HEIGHT,
  ZOOM_STEP,
  pinRadiusFor,
  textSizeFor,
} from "./constants";
import {
  type GeometryOptions,
  type ViewTransform,
  clampPan,
  clampZoom,
  cloneAnnotations,
  computeFitZoom,
  distance,
  findAnnotationAt,
  fitView,
  imageToScreen,
  nextPinNumber,
  normalizeRect,
  renumberPins,
  resolveZoomLimits,
  screenToImage,
  simplifyPath,
  translateAnnotation,
  zoomAround,
} from "./geometry";
import { AnnotationHistory } from "./history";
import { type LoadedImage, loadImage } from "./image";
import { type RenderAnnotationsOptions, contrastColor, defaultAnnotationRenderer } from "./render";

type Gesture =
  | { kind: "draw"; pointerId: number; start: Point; draft: Annotation }
  | { kind: "click"; pointerId: number; startScreen: Point; startImage: Point; hadEditor: boolean }
  | { kind: "move"; pointerId: number; startImage: Point; startScreen: Point; original: Annotation; before: Annotation[]; moved: boolean }
  | { kind: "pan"; pointerId: number; last: Point }
  | { kind: "pinch"; ids: [number, number]; startDist: number; startZoom: number; anchor: Point };

interface TextEditorState {
  el: HTMLTextAreaElement;
  at: Point;
  fontSize: number;
  color: string;
  editing?: TextAnnotation;
  cleanup: () => void;
}

const DOUBLE_CLICK_MS = 400;

function describe(a: Annotation): string {
  switch (a.type) {
    case "pin":
      return `Pin ${a.number}`;
    case "freehand":
      return "Drawing";
    case "arrow":
      return "Arrow";
    case "rectangle":
      return "Rectangle";
    case "text":
      return "Text";
    default:
      return "Annotation";
  }
}

function sameState(a: AnnotationEditorState, b: AnnotationEditorState): boolean {
  return (
    a.tool === b.tool &&
    a.color === b.color &&
    a.strokeWidth === b.strokeWidth &&
    a.zoom === b.zoom &&
    a.fitZoom === b.fitZoom &&
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.annotationCount === b.annotationCount &&
    a.selectedId === b.selectedId &&
    a.editingText === b.editingText
  );
}

function snapAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

export function createAnnotationEditor(options: AnnotationEditorOptions): AnnotationEditor {
  const { container } = options;
  const renderer = options.renderer ?? defaultAnnotationRenderer;
  const doc = container.ownerDocument;
  const win: Window & typeof globalThis = (doc.defaultView ?? window) as Window & typeof globalThis;

  const wrapper = doc.createElement("div");
  wrapper.className = "pinpoint-annotation-editor";
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "application");
  wrapper.setAttribute(
    "aria-label",
    "Screenshot annotation editor. Use the toolbar to choose a tool, then click or drag on the screenshot.",
  );
  Object.assign(wrapper.style, {
    position: "relative",
    overflow: "hidden",
    width: "100%",
    height: "100%",
    touchAction: "none",
    userSelect: "none",
    webkitUserSelect: "none",
  });

  const canvas = doc.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "100%",
    height: "100%",
    display: "block",
  });

  const live = doc.createElement("div");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("role", "status");
  Object.assign(live.style, {
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: "-1px",
    padding: "0",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: "0",
  });

  wrapper.append(canvas, live);
  container.appendChild(wrapper);
  const ctx = canvas.getContext("2d");

  let image: LoadedImage | null = null;
  let annotations: Annotation[] = renumberPins(cloneAnnotations(options.initialAnnotations ?? []));
  const history = new AnnotationHistory<Annotation[]>();
  let tool: AnnotationTool = options.tool ?? "pin";
  let color = options.color ?? DEFAULT_ANNOTATION_COLOR;
  let strokeWidth = options.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  let view: ViewTransform = { zoom: 1, panX: 0, panY: 0 };
  let viewInitialized = false;
  let fitZoom = 1;
  let containerSize: Size = { width: 0, height: 0 };
  let pixelRatio = 1;
  let selectedId: string | undefined;
  let gesture: Gesture | null = null;
  const pointers = new Map<number, Point>();
  let spaceHeld = false;
  let hoverHit = false;
  let textEditor: TextEditorState | null = null;
  let lastClick: { time: number; point: Point } | null = null;
  let destroyed = false;
  let rafHandle: number | null = null;
  const stateListeners = new Set<(state: AnnotationEditorState) => void>();
  let lastState: AnnotationEditorState | null = null;
  const removers: (() => void)[] = [];

  const raf: (cb: () => void) => number =
    typeof win.requestAnimationFrame === "function"
      ? (cb) => win.requestAnimationFrame(cb)
      : (cb) => win.setTimeout(cb, 16) as unknown as number;
  const cancelRaf: (h: number) => void =
    typeof win.cancelAnimationFrame === "function" ? (h) => win.cancelAnimationFrame(h) : (h) => win.clearTimeout(h);

  function on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, opts);
    removers.push(() => target.removeEventListener(type, handler as EventListener, opts));
  }

  /* ---------------------------------------------------------------- */
  /* State                                                            */
  /* ---------------------------------------------------------------- */

  function getState(): AnnotationEditorState {
    return {
      tool,
      color,
      strokeWidth,
      zoom: view.zoom,
      fitZoom,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      annotationCount: annotations.length,
      selectedId,
      editingText: textEditor !== null,
    };
  }

  function emitState(): void {
    if (destroyed) return;
    const state = getState();
    if (lastState && sameState(lastState, state)) return;
    lastState = state;
    options.onStateChange?.({ ...state });
    for (const listener of [...stateListeners]) listener({ ...state });
  }

  function emitChange(): void {
    options.onChange?.(cloneAnnotations(annotations));
  }

  function announce(message: string): void {
    live.textContent = live.textContent === message ? `${message} ` : message;
  }

  function imageSize(): Size {
    return image ? { width: image.width, height: image.height } : { width: 0, height: 0 };
  }

  function geometryOptions(): GeometryOptions {
    return {
      pinRadius: pinRadiusFor(image?.width),
      measureText: ctx
        ? (text, font) => {
            ctx.font = font;
            return ctx.measureText(text).width;
          }
        : undefined,
    };
  }

  function zoomLimits() {
    return resolveZoomLimits(fitZoom, options.minZoom, options.maxZoom);
  }

  function ensureSelectionValid(): void {
    if (selectedId !== undefined && !annotations.some((a) => a.id === selectedId)) selectedId = undefined;
  }

  function commit(next: Annotation[], message?: string): void {
    history.record(annotations);
    annotations = renumberPins(next);
    ensureSelectionValid();
    emitChange();
    if (message) announce(message);
    scheduleRender();
    emitState();
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */

  function syncCanvasSize(): void {
    const dpr = win.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(containerSize.width * dpr));
    const h = Math.max(1, Math.round(containerSize.height * dpr));
    pixelRatio = dpr;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  function renderNow(): void {
    if (destroyed || !ctx) return;
    if ((win.devicePixelRatio || 1) !== pixelRatio) syncCanvasSize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!image || !viewInitialized) return;
    const dpr = pixelRatio;
    const { zoom, panX, panY } = view;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);

    ctx.save();
    ctx.shadowColor = "rgba(15, 23, 42, 0.18)";
    ctx.shadowBlur = 24 * dpr;
    ctx.shadowOffsetY = 4 * dpr;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, image.width, image.height);
    ctx.restore();

    ctx.imageSmoothingEnabled = zoom < 3;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image.source, 0, 0, image.width, image.height);

    ctx.setTransform(dpr, 0, 0, dpr, dpr * panX, dpr * panY);
    const editingId = textEditor?.editing?.id;
    const visible: Annotation[] = editingId ? annotations.filter((a) => a.id !== editingId) : annotations.slice();
    if (gesture?.kind === "draw") visible.push(gesture.draft);
    const renderOptions: RenderAnnotationsOptions = {
      scale: zoom,
      selectedId: gesture?.kind === "draw" ? undefined : selectedId,
      imageSize: imageSize(),
    };
    renderer.render(ctx, visible, renderOptions);
  }

  function scheduleRender(): void {
    if (destroyed || rafHandle !== null) return;
    rafHandle = raf(() => {
      rafHandle = null;
      renderNow();
    });
  }

  function afterViewChange(): void {
    positionTextEditor();
    scheduleRender();
    emitState();
  }

  function updateCursor(): void {
    let cursor: string;
    if (gesture?.kind === "pan" || gesture?.kind === "pinch") cursor = "grabbing";
    else if (gesture?.kind === "move") cursor = "move";
    else if (spaceHeld) cursor = "grab";
    else if (tool === "select") cursor = hoverHit ? "move" : "grab";
    else if (tool === "text") cursor = "text";
    else cursor = "crosshair";
    if (wrapper.style.cursor !== cursor) wrapper.style.cursor = cursor;
  }

  /* ---------------------------------------------------------------- */
  /* View                                                             */
  /* ---------------------------------------------------------------- */

  function applyView(next: ViewTransform): void {
    view = image ? clampPan(next, imageSize(), containerSize) : next;
    afterViewChange();
  }

  function setZoom(zoom: number, anchor?: { x: number; y: number }): void {
    if (!image || !viewInitialized) return;
    const z = clampZoom(zoom, zoomLimits());
    const a = anchor ?? { x: containerSize.width / 2, y: containerSize.height / 2 };
    applyView(zoomAround(view, z, a));
  }

  function fitToView(): void {
    if (!image || containerSize.width <= 0 || containerSize.height <= 0) return;
    fitZoom = computeFitZoom(imageSize(), containerSize);
    view = fitView(imageSize(), containerSize);
    viewInitialized = true;
    afterViewChange();
  }

  function resize(): void {
    if (destroyed) return;
    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight;
    if (width <= 0 || height <= 0) return;
    const prev = containerSize;
    const dprChanged = (win.devicePixelRatio || 1) !== pixelRatio;
    if (prev.width === width && prev.height === height && !dprChanged && viewInitialized) return;
    containerSize = { width, height };
    syncCanvasSize();
    if (!image) return;
    const newFit = computeFitZoom(imageSize(), containerSize);
    const atFit = Math.abs(view.zoom - fitZoom) <= fitZoom * 1e-6;
    if (!viewInitialized || atFit) {
      fitToView();
      return;
    }
    const center = screenToImage({ x: prev.width / 2, y: prev.height / 2 }, view);
    const zoom = clampZoom(view.zoom * (newFit / fitZoom), resolveZoomLimits(newFit, options.minZoom, options.maxZoom));
    fitZoom = newFit;
    applyView({ zoom, panX: width / 2 - center.x * zoom, panY: height / 2 - center.y * zoom });
  }

  /* ---------------------------------------------------------------- */
  /* Text editing                                                     */
  /* ---------------------------------------------------------------- */

  function positionTextEditor(): void {
    if (!textEditor) return;
    const s = imageToScreen(textEditor.at, view);
    const style = textEditor.el.style;
    style.left = `${s.x}px`;
    style.top = `${s.y}px`;
    style.transform = `scale(${view.zoom})`;
  }

  function autoGrow(el: HTMLTextAreaElement, fontSize: number): void {
    el.style.width = "0px";
    el.style.height = "0px";
    el.style.width = `${Math.max(fontSize, el.scrollWidth + fontSize * 0.5)}px`;
    el.style.height = `${Math.max(fontSize * TEXT_LINE_HEIGHT, el.scrollHeight)}px`;
  }

  function styleTextEditor(ed: TextEditorState): void {
    const halo = contrastColor(ed.color, 0.9);
    const h = Math.max(1, ed.fontSize * 0.09);
    Object.assign(ed.el.style, {
      color: ed.color,
      caretColor: ed.color,
      textShadow: `${halo} ${h}px 0 0, ${halo} -${h}px 0 0, ${halo} 0 ${h}px 0, ${halo} 0 -${h}px 0`,
    });
  }

  function openTextEditor(at: Point, existing?: TextAnnotation): void {
    if (textEditor) commitText(false);
    const fontSize = existing?.fontSize ?? textSizeFor(image?.width, strokeWidth);
    const el = doc.createElement("textarea");
    el.setAttribute("aria-label", "Annotation text. Enter to save, Shift+Enter for a new line, Escape to cancel.");
    el.rows = 1;
    el.wrap = "off";
    el.spellcheck = true;
    el.value = existing?.text ?? "";
    Object.assign(el.style, {
      position: "absolute",
      margin: "0",
      padding: "0",
      border: "0",
      outline: `1px dashed ${SELECTION_COLOR}`,
      outlineOffset: `${Math.max(2, fontSize * 0.2)}px`,
      background: "transparent",
      resize: "none",
      overflow: "hidden",
      whiteSpace: "pre",
      transformOrigin: "0 0",
      font: `${TEXT_FONT_WEIGHT} ${fontSize}px ${TEXT_FONT_FAMILY}`,
      lineHeight: String(TEXT_LINE_HEIGHT),
      zIndex: "1",
      boxSizing: "content-box",
      userSelect: "text",
      webkitUserSelect: "text",
    });

    const onInput = () => autoGrow(el, fontSize);
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commitText(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelText(true);
      }
    };
    const onBlur = () => commitText(false);
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("input", onInput);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("blur", onBlur);
    el.addEventListener("pointerdown", stop);
    el.addEventListener("wheel", stop);

    textEditor = {
      el,
      at: { ...at },
      fontSize,
      color: existing?.color ?? color,
      editing: existing,
      cleanup: () => {
        el.removeEventListener("input", onInput);
        el.removeEventListener("keydown", onKeyDown);
        el.removeEventListener("blur", onBlur);
        el.removeEventListener("pointerdown", stop);
        el.removeEventListener("wheel", stop);
        el.remove();
      },
    };
    styleTextEditor(textEditor);
    wrapper.appendChild(el);
    positionTextEditor();
    autoGrow(el, fontSize);
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    scheduleRender();
    emitState();
  }

  function closeTextEditor(refocus: boolean): TextEditorState | null {
    const ed = textEditor;
    if (!ed) return null;
    const hadFocus = doc.activeElement === ed.el;
    textEditor = null;
    ed.cleanup();
    if (refocus && hadFocus && !destroyed) wrapper.focus({ preventScroll: true });
    return ed;
  }

  function commitText(refocus: boolean): void {
    const ed = closeTextEditor(refocus);
    if (!ed) return;
    const text = ed.el.value.replace(/\s+$/, "");
    const existing = ed.editing;
    if (existing) {
      if (!text.trim()) {
        commit(
          annotations.filter((a) => a.id !== existing.id),
          "Text deleted",
        );
      } else if (text !== existing.text || ed.color !== existing.color) {
        commit(
          annotations.map((a) => (a.id === existing.id ? { ...existing, text, color: ed.color } : a)),
          "Text updated",
        );
      }
    } else if (text.trim()) {
      const annotation: TextAnnotation = {
        id: createId(),
        type: "text",
        color: ed.color,
        strokeWidth,
        at: ed.at,
        text,
        fontSize: ed.fontSize,
      };
      commit([...annotations, annotation], "Text added");
    }
    scheduleRender();
    emitState();
  }

  function cancelText(refocus: boolean): void {
    if (!closeTextEditor(refocus)) return;
    scheduleRender();
    emitState();
  }

  /* ---------------------------------------------------------------- */
  /* Pointer handling                                                 */
  /* ---------------------------------------------------------------- */

  function localPoint(e: { clientX: number; clientY: number }): Point {
    const rect = wrapper.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function insideImage(p: Point): boolean {
    return !!image && p.x >= 0 && p.y >= 0 && p.x <= image.width && p.y <= image.height;
  }

  function clampToImage(p: Point): Point {
    if (!image) return p;
    return { x: Math.min(image.width, Math.max(0, p.x)), y: Math.min(image.height, Math.max(0, p.y)) };
  }

  function hitTolerance(pointerType: string): number {
    return (pointerType === "touch" ? 12 : 6) / view.zoom;
  }

  function capture(pointerId: number): void {
    try {
      wrapper.setPointerCapture?.(pointerId);
    } catch {
      /* pointer may already be released */
    }
  }

  function release(pointerId: number): void {
    try {
      if (wrapper.hasPointerCapture?.(pointerId)) wrapper.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
  }

  function cancelGesture(): void {
    const g = gesture;
    if (!g) return;
    gesture = null;
    if (g.kind === "move" && g.moved) annotations = g.before;
    if (g.kind !== "pinch") release(g.pointerId);
    updateCursor();
    scheduleRender();
  }

  function startPinch(): void {
    const entries = [...pointers.entries()];
    const a = entries[0];
    const b = entries[1];
    if (!a || !b) return;
    cancelGesture();
    const mid = { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 };
    gesture = {
      kind: "pinch",
      ids: [a[0], b[0]],
      startDist: Math.max(1, distance(a[1], b[1])),
      startZoom: view.zoom,
      anchor: screenToImage(mid, view),
    };
    updateCursor();
  }

  function onPointerDown(e: PointerEvent): void {
    if (destroyed || !image || !viewInitialized) return;
    if (textEditor && e.target === textEditor.el) return;
    const p = localPoint(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2 && e.pointerType === "touch") {
      e.preventDefault();
      startPinch();
      return;
    }
    if (gesture || pointers.size > 1) return;

    const hadEditor = textEditor !== null;
    if (hadEditor) commitText(false);
    wrapper.focus({ preventScroll: true });
    e.preventDefault();

    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      gesture = { kind: "pan", pointerId: e.pointerId, last: p };
      capture(e.pointerId);
      updateCursor();
      return;
    }
    if (e.button !== 0) return;
    capture(e.pointerId);

    const ip = screenToImage(p, view);
    const base = { id: createId(), color, strokeWidth };
    switch (tool) {
      case "select": {
        const hit = findAnnotationAt(annotations, ip, hitTolerance(e.pointerType), geometryOptions());
        if (hit) {
          selectedId = hit.id;
          gesture = {
            kind: "move",
            pointerId: e.pointerId,
            startImage: ip,
            startScreen: p,
            original: hit,
            before: annotations,
            moved: false,
          };
        } else {
          selectedId = undefined;
          gesture = { kind: "pan", pointerId: e.pointerId, last: p };
        }
        break;
      }
      case "pin":
      case "text":
        gesture = { kind: "click", pointerId: e.pointerId, startScreen: p, startImage: ip, hadEditor };
        break;
      case "freehand": {
        const start = clampToImage(ip);
        gesture = { kind: "draw", pointerId: e.pointerId, start, draft: { ...base, type: "freehand", points: [start] } };
        break;
      }
      case "arrow": {
        const start = clampToImage(ip);
        gesture = { kind: "draw", pointerId: e.pointerId, start, draft: { ...base, type: "arrow", from: start, to: start } };
        break;
      }
      case "rectangle": {
        const start = clampToImage(ip);
        gesture = {
          kind: "draw",
          pointerId: e.pointerId,
          start,
          draft: { ...base, type: "rectangle", x: start.x, y: start.y, width: 0, height: 0 },
        };
        break;
      }
    }
    updateCursor();
    scheduleRender();
    emitState();
  }

  function extendDraw(g: Extract<Gesture, { kind: "draw" }>, e: PointerEvent): void {
    const draft = g.draft;
    if (draft.type === "freehand") {
      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      const samples = events.length > 0 ? events : [e];
      const minStep = 0.5 / view.zoom;
      for (const sample of samples) {
        const ip = clampToImage(screenToImage(localPoint(sample), view));
        const last = draft.points[draft.points.length - 1];
        if (!last || distance(last, ip) >= minStep) draft.points.push(ip);
      }
      return;
    }
    let ip = clampToImage(screenToImage(localPoint(e), view));
    if (draft.type === "arrow") {
      if (e.shiftKey) ip = clampToImage(snapAngle(g.start, ip));
      g.draft = { ...draft, to: ip };
    } else if (draft.type === "rectangle") {
      if (e.shiftKey) {
        const size = Math.max(Math.abs(ip.x - g.start.x), Math.abs(ip.y - g.start.y));
        ip = clampToImage({
          x: g.start.x + Math.sign(ip.x - g.start.x || 1) * size,
          y: g.start.y + Math.sign(ip.y - g.start.y || 1) * size,
        });
      }
      g.draft = { ...draft, ...normalizeRect(g.start, ip) };
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (destroyed || !image) return;
    const p = localPoint(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    const g = gesture;
    if (!g) {
      if (tool === "select" && !spaceHeld && e.target !== textEditor?.el) {
        const hit = !!findAnnotationAt(annotations, screenToImage(p, view), hitTolerance(e.pointerType), geometryOptions());
        if (hit !== hoverHit) {
          hoverHit = hit;
          updateCursor();
        }
      }
      return;
    }
    if (g.kind === "pinch") {
      if (!g.ids.includes(e.pointerId)) return;
      const a = pointers.get(g.ids[0]);
      const b = pointers.get(g.ids[1]);
      if (!a || !b) return;
      const zoom = clampZoom((g.startZoom * distance(a, b)) / g.startDist, zoomLimits());
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      applyView({ zoom, panX: mid.x - g.anchor.x * zoom, panY: mid.y - g.anchor.y * zoom });
      return;
    }
    if (e.pointerId !== g.pointerId) return;
    switch (g.kind) {
      case "pan":
        applyView({ zoom: view.zoom, panX: view.panX + p.x - g.last.x, panY: view.panY + p.y - g.last.y });
        g.last = p;
        return;
      case "draw":
        extendDraw(g, e);
        scheduleRender();
        return;
      case "move": {
        if (!g.moved && distance(p, g.startScreen) < 3) return;
        g.moved = true;
        const ip = screenToImage(p, view);
        const moved = translateAnnotation(g.original, ip.x - g.startImage.x, ip.y - g.startImage.y);
        annotations = g.before.map((a) => (a.id === g.original.id ? moved : a));
        scheduleRender();
        return;
      }
      case "click":
        return;
    }
  }

  function finishDraw(draft: Annotation): void {
    const minScreen = 4;
    switch (draft.type) {
      case "freehand": {
        const points = simplifyPath(draft.points, 0.6 / view.zoom);
        commit([...annotations, { ...draft, points }], "Drawing added");
        return;
      }
      case "arrow":
        if (distance(draft.from, draft.to) * view.zoom < minScreen) return;
        commit([...annotations, draft], "Arrow added");
        return;
      case "rectangle":
        if (draft.width * view.zoom < minScreen || draft.height * view.zoom < minScreen) return;
        commit([...annotations, draft], "Rectangle added");
        return;
      default:
        return;
    }
  }

  function isDoubleClick(p: Point): boolean {
    const now = Date.now();
    const prev = lastClick;
    lastClick = { time: now, point: p };
    if (prev && now - prev.time <= DOUBLE_CLICK_MS && distance(prev.point, p) <= 6) {
      lastClick = null;
      return true;
    }
    return false;
  }

  function onPointerUp(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    const g = gesture;
    if (destroyed || !g) return;
    if (g.kind === "pinch") {
      if (g.ids.includes(e.pointerId)) {
        gesture = null;
        updateCursor();
      }
      return;
    }
    if (e.pointerId !== g.pointerId) return;
    gesture = null;
    release(e.pointerId);
    const p = localPoint(e);

    switch (g.kind) {
      case "draw":
        finishDraw(g.draft);
        break;
      case "move":
        if (g.moved) {
          history.record(g.before);
          emitChange();
          announce(`${describe(g.original)} moved`);
        } else if (isDoubleClick(p) && g.original.type === "text") {
          openTextEditor(g.original.at, g.original);
        }
        break;
      case "click": {
        if (g.hadEditor || !insideImage(g.startImage)) break;
        if (tool === "pin") {
          const pin: Annotation = {
            id: createId(),
            type: "pin",
            color,
            strokeWidth,
            at: g.startImage,
            number: nextPinNumber(annotations),
          };
          commit([...annotations, pin], `Pin ${pin.number} added`);
        } else if (tool === "text") {
          const hit = findAnnotationAt(annotations, g.startImage, hitTolerance(e.pointerType), geometryOptions());
          if (hit?.type === "text") openTextEditor(hit.at, hit);
          else openTextEditor(g.startImage);
        }
        break;
      }
      case "pan":
        break;
    }
    updateCursor();
    scheduleRender();
    emitState();
  }

  function onPointerCancel(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    const g = gesture;
    if (!g) return;
    if (g.kind === "pinch" ? g.ids.includes(e.pointerId) : g.pointerId === e.pointerId) {
      cancelGesture();
      emitState();
    }
  }

  function onWheel(e: WheelEvent): void {
    if (destroyed || !image || !viewInitialized) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? containerSize.height : 1;
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      const clamped = Math.max(-25, Math.min(25, dy));
      setZoom(view.zoom * Math.exp(-clamped * 0.01), localPoint(e));
      return;
    }
    if (e.shiftKey && dx === 0) {
      dx = dy;
      dy = 0;
    }
    applyView({ zoom: view.zoom, panX: view.panX - dx, panY: view.panY - dy });
  }

  /* ---------------------------------------------------------------- */
  /* Keyboard                                                         */
  /* ---------------------------------------------------------------- */

  function zoomBy(factor: number): void {
    setZoom(view.zoom * factor);
    announce(`Zoom ${Math.round(view.zoom * 100)}%`);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (destroyed || e.target !== wrapper) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    if (mod && !e.altKey && (key === "z" || key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) api.redo();
      else api.undo();
      return;
    }
    if (mod && !e.altKey && (key === "y" || key === "Y")) {
      e.preventDefault();
      api.redo();
      return;
    }
    if (mod || e.altKey) return;
    switch (key) {
      case "Delete":
      case "Backspace":
        if (selectedId !== undefined) {
          e.preventDefault();
          api.deleteSelected();
        }
        return;
      case "Escape":
        if (gesture && gesture.kind !== "pinch") {
          e.preventDefault();
          cancelGesture();
          emitState();
        } else if (selectedId !== undefined) {
          e.preventDefault();
          selectedId = undefined;
          scheduleRender();
          emitState();
        }
        return;
      case "+":
      case "=":
        e.preventDefault();
        zoomBy(ZOOM_STEP);
        return;
      case "-":
      case "_":
        e.preventDefault();
        zoomBy(1 / ZOOM_STEP);
        return;
      case "0":
        e.preventDefault();
        fitToView();
        announce("Fit to view");
        return;
      case " ":
        e.preventDefault();
        if (!spaceHeld) {
          spaceHeld = true;
          updateCursor();
        }
        return;
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === " " && spaceHeld) {
      spaceHeld = false;
      updateCursor();
    }
  }

  function onBlur(): void {
    if (spaceHeld) {
      spaceHeld = false;
      updateCursor();
    }
  }

  on(wrapper, "pointerdown", onPointerDown);
  on(wrapper, "pointermove", onPointerMove);
  on(wrapper, "pointerup", onPointerUp);
  on(wrapper, "pointercancel", onPointerCancel);
  on(wrapper, "lostpointercapture", (e) => {
    if (gesture && gesture.kind !== "pinch" && gesture.pointerId === e.pointerId) onPointerUp(e);
  });
  on(wrapper, "pointerleave", () => {
    if (hoverHit) {
      hoverHit = false;
      updateCursor();
    }
  });
  on(wrapper, "wheel", onWheel, { passive: false });
  on(wrapper, "keydown", onKeyDown);
  on(wrapper, "keyup", onKeyUp);
  on(wrapper, "blur", onBlur);
  on(wrapper, "contextmenu", (e) => {
    if (gesture) e.preventDefault();
  });

  let resizeObserver: ResizeObserver | null = null;
  const RO = win.ResizeObserver ?? globalThis.ResizeObserver;
  if (typeof RO === "function") {
    resizeObserver = new RO(() => resize());
    resizeObserver.observe(wrapper);
  } else {
    const onWindowResize = () => resize();
    win.addEventListener("resize", onWindowResize);
    removers.push(() => win.removeEventListener("resize", onWindowResize));
  }

  updateCursor();

  const ready: Promise<void> = (async () => {
    const loaded = await loadImage(options.image);
    if (destroyed) {
      loaded.dispose();
      return;
    }
    image = loaded;
    containerSize = { width: 0, height: 0 };
    resize();
    renderNow();
    emitState();
  })();
  ready.catch(() => {});

  /* ---------------------------------------------------------------- */
  /* Public API                                                       */
  /* ---------------------------------------------------------------- */

  const api: AnnotationEditor = {
    ready,
    getState: () => getState(),
    subscribe(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },

    setTool(next) {
      if (next === tool) return;
      commitText(false);
      cancelGesture();
      tool = next;
      if (tool !== "select") selectedId = undefined;
      hoverHit = false;
      updateCursor();
      scheduleRender();
      emitState();
    },

    setColor(next) {
      color = next;
      if (textEditor) {
        textEditor.color = next;
        styleTextEditor(textEditor);
      } else if (selectedId !== undefined) {
        const target = annotations.find((a) => a.id === selectedId);
        if (target && target.color !== next) {
          commit(annotations.map((a) => (a === target ? { ...a, color: next } : a)));
        }
      }
      emitState();
    },

    setStrokeWidth(next) {
      if (!Number.isFinite(next) || next <= 0) return;
      strokeWidth = next;
      if (selectedId !== undefined && !textEditor) {
        const target = annotations.find((a) => a.id === selectedId);
        if (target && target.type !== "pin" && target.type !== "text" && target.strokeWidth !== next) {
          commit(annotations.map((a) => (a === target ? { ...a, strokeWidth: next } : a)));
        }
      }
      emitState();
    },

    getAnnotations: () => cloneAnnotations(annotations),

    setAnnotations(next) {
      cancelText(false);
      cancelGesture();
      commit(cloneAnnotations(next));
    },

    deleteSelected() {
      if (selectedId === undefined) return;
      const target = annotations.find((a) => a.id === selectedId);
      if (!target) return;
      cancelGesture();
      commit(
        annotations.filter((a) => a !== target),
        `${describe(target)} deleted`,
      );
    },

    undo() {
      commitText(false);
      cancelGesture();
      const previous = history.undo(annotations);
      if (!previous) return;
      annotations = previous;
      ensureSelectionValid();
      emitChange();
      announce("Undone");
      scheduleRender();
      emitState();
    },

    redo() {
      commitText(false);
      cancelGesture();
      const next = history.redo(annotations);
      if (!next) return;
      annotations = next;
      ensureSelectionValid();
      emitChange();
      announce("Redone");
      scheduleRender();
      emitState();
    },

    clear() {
      cancelText(false);
      cancelGesture();
      if (annotations.length === 0) return;
      commit([], "All annotations cleared");
    },

    reset() {
      cancelText(false);
      cancelGesture();
      const hadAnnotations = annotations.length > 0;
      annotations = [];
      history.clear();
      selectedId = undefined;
      fitToView();
      if (hadAnnotations) emitChange();
      announce("Annotations reset");
      scheduleRender();
      emitState();
    },

    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    setZoom,
    fitToView,

    async exportAnnotated(type = "image/png", quality) {
      await ready;
      if (destroyed || !image) throw new Error("Annotation editor has been destroyed");
      commitText(false);
      const out = doc.createElement("canvas");
      out.width = image.width;
      out.height = image.height;
      const outCtx = out.getContext("2d");
      if (!outCtx) throw new Error("2D canvas is not supported");
      outCtx.drawImage(image.source, 0, 0, image.width, image.height);
      const renderOptions: RenderAnnotationsOptions = { scale: 1, imageSize: imageSize() };
      renderer.render(outCtx, annotations, renderOptions);
      return new Promise<Blob>((resolve, reject) => {
        out.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode annotated screenshot"))),
          type,
          quality,
        );
      });
    },

    resize,

    destroy() {
      if (destroyed) return;
      if (textEditor) closeTextEditor(false);
      destroyed = true;
      if (rafHandle !== null) cancelRaf(rafHandle);
      rafHandle = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      for (const remove of removers.splice(0)) remove();
      stateListeners.clear();
      pointers.clear();
      gesture = null;
      image?.dispose();
      image = null;
      wrapper.remove();
    },
  };

  return api;
}
