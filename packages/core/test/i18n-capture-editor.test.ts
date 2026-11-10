import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Options as RenderOptions } from "modern-screenshot";

vi.mock("modern-screenshot", () => ({ domToBlob: vi.fn() }));

import { domToBlob } from "modern-screenshot";
import { createAnnotationEditor } from "../src/annotation/index";
import {
  DomScreenshotCapturer,
  PLACEHOLDER_ATTRIBUTE,
  buildDomWarnings,
  formatCaptureWarning,
} from "../src/capture/index";
import { enCapture, type CaptureMessages } from "../src/i18n/capture";
import { enEditor, type EditorMessages } from "../src/i18n/editor";
import de from "../src/locales/de";
import type { AnnotationEditor } from "../src/interfaces";
import { createRecordingContext } from "./annotation-helpers";

const deCapture: CaptureMessages = {
  ...enCapture,
  "placeholder.iframe": "Fremder iframe — nicht erfasst",
  "warning.crossOriginIframe": { one: "# fremder iframe fehlt.", other: "# fremde iframes fehlen." },
  "warning.unknown": { one: "# Element fehlt.", other: "# Elemente fehlen." },
  "warning.labelledPlaceholders": "Platzhalter.",
};

const deEditor: EditorMessages = {
  ...enEditor,
  "pin.added": "Pin {number} hinzugefügt",
  "history.undone": "Rückgängig",
  "zoom.changed": "Zoom {percent}",
  "editor.label": "Screenshot-Editor",
};

const noLimitations = {
  crossOriginIframes: [],
  embeddedObjects: [],
  taintedCanvases: [],
  blankCanvases: [],
  videos: [],
  stickyElements: [],
  images: [],
};

describe("capture warnings", () => {
  it("formats warnings from code and count with plural rules", () => {
    expect(formatCaptureWarning({ code: "cross-origin-iframe", count: 1 })).toMatch(/^1 cross-origin iframe could/);
    expect(formatCaptureWarning({ code: "cross-origin-iframe", count: 3 })).toMatch(/^3 cross-origin iframes could/);
    expect(formatCaptureWarning({ code: "cross-origin-iframe", count: 2 }, { messages: deCapture, locale: "de" })).toBe(
      "2 fremde iframes fehlen.",
    );
    expect(formatCaptureWarning({ code: "unknown", count: 1234 }, { messages: deCapture, locale: "de" })).toBe(
      "1.234 Elemente fehlen.",
    );
    expect(formatCaptureWarning({ code: "unknown" })).toBe(enCapture["warning.unknownGeneric"]);
    expect(formatCaptureWarning({ code: "font" })).toBe(enCapture["warning.font"]);
    expect(formatCaptureWarning({ code: "blank-canvas", count: 2 })).toMatch(/^2 canvases appeared empty/);
    expect(formatCaptureWarning({ code: "blank-canvas", count: 1 }, { messages: de.capture, locale: "de" })).toMatch(/^1 Canvas-Element war/);
  });

  it("builds warning messages in the requested locale", () => {
    const iframe = document.createElement("iframe");
    const warnings = buildDomWarnings(
      { ...noLimitations, crossOriginIframes: [iframe, iframe] },
      { failedImages: new Set(), videosNotCaptured: 0 },
      { downscaled: true, fontFallback: false, placeholders: true },
      { messages: deCapture, locale: "de" },
    );
    expect(warnings).toEqual([
      { code: "cross-origin-iframe", count: 2, message: "2 fremde iframes fehlen. Platzhalter." },
      { code: "downscaled", message: enCapture["warning.downscaled"] },
    ]);
  });

  it("defaults to English", () => {
    const video = document.createElement("video");
    const [warning] = buildDomWarnings(
      { ...noLimitations, videos: [video, video] },
      { failedImages: new Set(), videosNotCaptured: 1 },
      { downscaled: false, fontFallback: false, placeholders: false },
    );
    expect(warning).toMatchObject({ code: "video", count: 2 });
    expect(warning!.message).toBe(
      "1 video could not be captured. Affected areas are left blank. 1 video was captured as a still image (current frame or poster), which may not match what was playing.",
    );
  });
});

describe("DomScreenshotCapturer localization", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.mocked(domToBlob).mockReset();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
  });

  afterEach(() => vi.restoreAllMocks());

  async function captureIframe(capturer: DomScreenshotCapturer, options = {}) {
    document.body.innerHTML = `<iframe id="xo" srcdoc="<p>x</p>"></iframe>`;
    Object.defineProperty(document.getElementById("xo"), "contentDocument", { configurable: true, get: () => null });
    let clone: HTMLElement | undefined;
    vi.mocked(domToBlob).mockImplementation(async (node: unknown, opts?: RenderOptions) => {
      clone = (node as HTMLElement).cloneNode(true) as HTMLElement;
      await opts?.onCloneNode?.(clone);
      return new Blob(["png"], { type: "image/png" });
    });
    const result = await capturer.capture(options);
    const label = clone?.querySelector(`[${PLACEHOLDER_ATTRIBUTE}="iframe"]`)?.textContent;
    return { result, label };
  }

  it("draws placeholder labels and writes warnings with constructor messages", async () => {
    const { result, label } = await captureIframe(new DomScreenshotCapturer({ messages: deCapture, locale: "de" }));
    expect(label).toBe("Fremder iframe — nicht erfasst");
    expect(result.warnings[0]?.message).toBe("1 fremder iframe fehlt. Platzhalter.");
  });

  it("lets per-capture options override the constructor", async () => {
    const { result, label } = await captureIframe(new DomScreenshotCapturer({ messages: deCapture, locale: "de" }), {
      messages: enCapture,
      locale: "en",
    });
    expect(label).toBe(enCapture["placeholder.iframe"]);
    expect(result.warnings[0]?.message).toMatch(/^1 cross-origin iframe could not be captured/);
  });
});

describe("annotation editor localization", () => {
  let editor: AnnotationEditor | undefined;
  let container: HTMLElement;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      return createRecordingContext(this).ctx as never;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(250);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1000, height: 500, close: vi.fn() })));
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    editor?.destroy();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function setup(messages?: EditorMessages, locale?: string) {
    editor = createAnnotationEditor({
      container,
      image: new Blob(["png"], { type: "image/png" }),
      initialAnnotations: [{ id: "p1", type: "pin", at: { x: 10, y: 10 }, number: 1, color: "#ef4444", strokeWidth: 6 }],
      messages,
      locale,
    });
    await editor.ready;
    const wrapper = container.firstElementChild as HTMLElement;
    const live = () => wrapper.querySelector("[aria-live]")!.textContent!.trim();
    return { editor, wrapper, live };
  }

  it("announces in English by default", async () => {
    const { editor, wrapper, live } = await setup();
    expect(wrapper.getAttribute("aria-label")).toBe(enEditor["editor.label"]);
    editor.setAnnotations([]);
    editor.undo();
    expect(live()).toBe("Undone");
  });

  it("uses the given messages and locale for labels and announcements", async () => {
    const { editor, wrapper, live } = await setup(deEditor, "de");
    expect(wrapper.getAttribute("aria-label")).toBe("Screenshot-Editor");
    expect(wrapper.style.direction).toBe("ltr");
    editor.setAnnotations([]);
    editor.undo();
    expect(live()).toBe("Rückgängig");
    editor.setZoom(1.25);
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    expect(live()).toMatch(/^Zoom \d+\s%$/);
  });

  it("announces pins with their number", async () => {
    const { wrapper, live } = await setup(deEditor, "de");
    const at = { clientX: 100, clientY: 50, pointerId: 1, button: 0, pointerType: "mouse", bubbles: true, cancelable: true };
    wrapper.dispatchEvent(new PointerEvent("pointerdown", at));
    wrapper.dispatchEvent(new PointerEvent("pointerup", at));
    expect(live()).toBe("Pin 2 hinzugefügt");
  });
});
