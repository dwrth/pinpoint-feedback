import type {
  AnnotationEditor,
  AnnotationEditorOptions,
  AnnotationEditorState,
  BrowserMetadata,
  CapturedScreenshot,
  FeedbackClient,
  ScreenshotCapturer,
  SubmissionResult,
} from "@pinpoint-feedback/core";
import { within } from "@testing-library/react";
import { vi } from "vitest";

export const metadata: BrowserMetadata = {
  url: "https://example.com/pricing",
  pageTitle: "Pricing",
  userAgent: "test",
  browser: { name: "Test" },
  os: { name: "TestOS" },
  viewport: { width: 1280, height: 800 },
  screen: { width: 1920, height: 1080 },
  devicePixelRatio: 1,
};

export function makeScreenshot(overrides: Partial<CapturedScreenshot> = {}): CapturedScreenshot {
  return {
    blob: new Blob(["png"], { type: "image/png" }),
    width: 1280,
    height: 800,
    scale: 1,
    viewport: { width: 1280, height: 800 },
    scroll: { x: 0, y: 0 },
    method: "dom",
    warnings: [],
    capturedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeCapturer(impl?: () => Promise<CapturedScreenshot>) {
  const capture = vi.fn<ScreenshotCapturer["capture"]>(impl ?? (async () => makeScreenshot()));
  const capturer: ScreenshotCapturer = { id: "fake", isSupported: () => true, capture };
  return { capturer, capture };
}

export function makeClient(submitResults: Array<SubmissionResult | Promise<SubmissionResult>> = []) {
  const queue = [...submitResults];
  const submit = vi.fn<FeedbackClient["submit"]>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("no result queued");
    return next;
  });
  const pending = vi.fn<FeedbackClient["pending"]>(async () => []);
  const retryPending = vi.fn<FeedbackClient["retryPending"]>(async () => []);
  const client: FeedbackClient = { submit, pending, retryPending, discard: vi.fn(async () => {}) };
  return { client, submit, pending, retryPending };
}

export const editors: Array<{ options: AnnotationEditorOptions; editor: AnnotationEditor & Record<string, unknown> }> = [];

export const fakeAnnotations = [
  { id: "a1", type: "pin" as const, at: { x: 10, y: 20 }, number: 1, color: "#ef4444", strokeWidth: 6 },
];

export function createFakeEditor(options: AnnotationEditorOptions): AnnotationEditor {
  let state: AnnotationEditorState = {
    tool: "select",
    color: "#ef4444",
    strokeWidth: 6,
    zoom: 1,
    fitZoom: 1,
    canUndo: false,
    canRedo: false,
    annotationCount: 0,
    editingText: false,
  };
  const listeners = new Set<(s: AnnotationEditorState) => void>();
  const set = (patch: Partial<AnnotationEditorState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l(state));
  };
  const editor = {
    ready: Promise.resolve(),
    getState: () => state,
    subscribe: (l: (s: AnnotationEditorState) => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    setTool: vi.fn((tool: AnnotationEditorState["tool"]) => set({ tool })),
    setColor: vi.fn((color: string) => set({ color })),
    setStrokeWidth: vi.fn((strokeWidth: number) => set({ strokeWidth })),
    getAnnotations: vi.fn(() => fakeAnnotations),
    setAnnotations: vi.fn(),
    deleteSelected: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    clear: vi.fn(),
    reset: vi.fn(),
    zoomIn: vi.fn(() => set({ zoom: state.zoom * 1.25 })),
    zoomOut: vi.fn(),
    setZoom: vi.fn(),
    fitToView: vi.fn(),
    exportAnnotated: vi.fn(async () => new Blob(["annotated"], { type: "image/png" })),
    resize: vi.fn(),
    destroy: vi.fn(),
    _set: set,
  };
  editors.push({ options, editor });
  return editor;
}

export function shadow() {
  const host = document.body.querySelector("[data-pinpoint-ignore]");
  if (!host?.shadowRoot) throw new Error("widget host not mounted");
  return within(host.shadowRoot as unknown as HTMLElement);
}

export function shadowRoot(): ShadowRoot {
  const root = document.body.querySelector("[data-pinpoint-ignore]")?.shadowRoot;
  if (!root) throw new Error("widget host not mounted");
  return root;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
