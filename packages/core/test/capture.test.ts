import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Options as RenderOptions } from "modern-screenshot";

vi.mock("modern-screenshot", () => ({ domToBlob: vi.fn() }));

import { domToBlob } from "modern-screenshot";
import {
  CAPTURE_MARK_ATTRIBUTE,
  CaptureError,
  DisplayMediaScreenshotCapturer,
  DomScreenshotCapturer,
  PINPOINT_IGNORE_ATTRIBUTE,
  PLACEHOLDER_ATTRIBUTE,
  PLACEHOLDER_IMAGE_DATA_URL,
  collectExcludedElements,
  computeCaptureScale,
  createCaptureFilter,
  createDefaultCapturer,
  hideExcludedElements,
  isCanvasBlank,
  isExcludedElement,
  scanCaptureLimitations,
  toDisplayMediaError,
} from "../src/capture/index";

const domToBlobMock = vi.mocked(domToBlob);

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

/** Elements are visible at (0,0,100,100) unless they carry data-offscreen. */
function stubLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.hasAttribute("data-offscreen") ? rect(0, 5000, 100, 100) : rect(0, 0, 100, 100);
  });
}

function stubCrossOrigin(iframe: HTMLIFrameElement) {
  Object.defineProperty(iframe, "contentDocument", { configurable: true, get: () => null });
}

function stubTainted(canvas: HTMLCanvasElement) {
  canvas.width = 10;
  canvas.height = 10;
  canvas.toDataURL = () => {
    throw new DOMException("Tainted canvases may not be exported.", "SecurityError");
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  domToBlobMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("computeCaptureScale", () => {
  it("caps the device pixel ratio at maxScale (default 2)", () => {
    expect(computeCaptureScale({ width: 100, height: 50, devicePixelRatio: 3 })).toEqual({
      scale: 2,
      width: 200,
      height: 100,
      downscaled: false,
    });
    expect(computeCaptureScale({ width: 100, height: 50, devicePixelRatio: 3, maxScale: 1.5 }).scale).toBe(1.5);
    expect(computeCaptureScale({ width: 100, height: 50, devicePixelRatio: 1 }).scale).toBe(1);
  });

  it("treats a missing or invalid devicePixelRatio as 1", () => {
    expect(computeCaptureScale({ width: 10, height: 10 }).scale).toBe(1);
    expect(computeCaptureScale({ width: 10, height: 10, devicePixelRatio: Number.NaN }).scale).toBe(1);
    expect(computeCaptureScale({ width: 10, height: 10, devicePixelRatio: 0 }).scale).toBe(1);
  });

  it("downscales to fit maxPixels and flags it", () => {
    const result = computeCaptureScale({ width: 1000, height: 500, devicePixelRatio: 2, maxPixels: 500_000 });
    expect(result.downscaled).toBe(true);
    expect(result.scale).toBeCloseTo(1, 10);
    expect(result.width * result.height).toBeLessThanOrEqual(500_000);
  });

  it("does not flag downscaling when maxPixels is already satisfied", () => {
    const result = computeCaptureScale({ width: 100, height: 100, devicePixelRatio: 2, maxPixels: 1_000_000 });
    expect(result).toMatchObject({ scale: 2, downscaled: false, width: 200, height: 200 });
  });
});

describe("exclusion", () => {
  it("excludes elements with the ignore attribute or matching the predicate", () => {
    const ignored = document.createElement("div");
    ignored.setAttribute(PINPOINT_IGNORE_ATTRIBUTE, "");
    const custom = document.createElement("aside");
    const normal = document.createElement("p");
    const exclude = (el: Element) => el.localName === "aside";

    expect(isExcludedElement(ignored)).toBe(true);
    expect(isExcludedElement(custom, exclude)).toBe(true);
    expect(isExcludedElement(normal, exclude)).toBe(false);
    expect(
      isExcludedElement(normal, () => {
        throw new Error("boom");
      }),
    ).toBe(false);
  });

  it("filter always keeps non-element nodes", () => {
    const filter = createCaptureFilter(() => true);
    expect(filter(document.createTextNode("hi"))).toBe(true);
    expect(filter(document.createElement("div"))).toBe(false);
  });

  it("collects top-most excluded elements, including inside shadow roots", () => {
    document.body.innerHTML = `
      <div id="widget" ${PINPOINT_IGNORE_ATTRIBUTE}><span ${PINPOINT_IGNORE_ATTRIBUTE}></span></div>
      <section><aside id="custom"></aside><div id="host"></div></section>`;
    const host = document.getElementById("host") as HTMLElement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<div id="inner" ${PINPOINT_IGNORE_ATTRIBUTE}></div>`;

    const found = collectExcludedElements(document.documentElement, (el) => el.localName === "aside").map((el) => el.id);
    expect(found.sort()).toEqual(["custom", "inner", "widget"]);
  });

  it("hides excluded elements and restores previous inline styles", () => {
    document.body.innerHTML = `<div id="w" ${PINPOINT_IGNORE_ATTRIBUTE} style="opacity: 0.5"></div>`;
    const widget = document.getElementById("w") as HTMLElement;
    const restore = hideExcludedElements(document.documentElement);
    expect(widget.style.getPropertyValue("visibility")).toBe("hidden");
    expect(widget.style.getPropertyValue("opacity")).toBe("0");
    restore();
    expect(widget.style.getPropertyValue("visibility")).toBe("");
    expect(widget.style.getPropertyValue("opacity")).toBe("0.5");
  });
});

/**
 * Stubs 2D contexts of scratch canvases: drawImage records the source, getImageData returns pixels
 * whose alpha is taken from `alphaOf(source)`. Returns the canvases getContext was called on.
 */
function stubScratchContext(alphaOf: (source: HTMLCanvasElement) => number) {
  const contextOwners: HTMLCanvasElement[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    contextOwners.push(this);
    let source: HTMLCanvasElement | undefined;
    return {
      drawImage: (img: HTMLCanvasElement) => {
        source = img;
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4);
        if (source) data[data.length - 1] = alphaOf(source);
        return { data };
      },
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  return contextOwners;
}

function readableCanvas(id: string): HTMLCanvasElement {
  const canvas = document.getElementById(id) as HTMLCanvasElement;
  canvas.width = 300;
  canvas.height = 150;
  canvas.toDataURL = () => "data:image/png;base64,AAAA";
  return canvas;
}

describe("blank canvas detection", () => {
  it("flags readable, visible canvases whose sampled pixels are all transparent", () => {
    stubLayout();
    document.body.innerHTML = `
      <canvas id="webgl"></canvas>
      <canvas id="drawn"></canvas>
      <canvas id="empty-size"></canvas>
      <canvas id="tainted"></canvas>
      <canvas id="off" data-offscreen></canvas>
      <div ${PINPOINT_IGNORE_ATTRIBUTE}><canvas id="ignored"></canvas></div>`;
    const webgl = readableCanvas("webgl");
    const drawn = readableCanvas("drawn");
    readableCanvas("off");
    readableCanvas("ignored");
    const emptySize = document.getElementById("empty-size") as HTMLCanvasElement;
    emptySize.width = 0;
    stubTainted(document.getElementById("tainted") as HTMLCanvasElement);
    const owners = stubScratchContext((source) => (source === drawn ? 255 : 0));

    const result = scanCaptureLimitations(document);
    expect(result.blankCanvases).toEqual([webgl]);
    expect(result.taintedCanvases.map((el) => el.id)).toEqual(["tainted"]);
    const pageCanvases = new Set(document.querySelectorAll("canvas"));
    expect(owners.length).toBeGreaterThan(0);
    expect(owners.some((c) => pageCanvases.has(c))).toBe(false);
  });

  it("returns false when sampling is impossible", () => {
    document.body.innerHTML = `<canvas id="c"></canvas>`;
    const canvas = readableCanvas("c");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(isCanvasBlank(canvas)).toBe(false);
  });

  it("emits a blank-canvas warning without a placeholder", async () => {
    stubLayout();
    document.body.innerHTML = `<canvas id="webgl"></canvas>`;
    readableCanvas("webgl");
    stubScratchContext(() => 0);
    let clone: HTMLElement | undefined;
    domToBlobMock.mockImplementation(async (node: unknown, options?: RenderOptions) => {
      clone = (node as HTMLElement).cloneNode(true) as HTMLElement;
      await options?.onCloneNode?.(clone);
      return new Blob(["png"], { type: "image/png" });
    });
    const result = await new DomScreenshotCapturer().capture();
    expect(result.warnings.find((w) => w.code === "blank-canvas")).toMatchObject({
      count: 1,
      message: expect.stringMatching(/^1 canvas appeared empty/),
    });
    expect(clone?.querySelector(`[${PLACEHOLDER_ATTRIBUTE}]`)).toBeNull();
    expect(clone?.querySelector("canvas")).not.toBeNull();
  });
});

describe("scanCaptureLimitations", () => {
  it("detects cross-origin iframes, videos and tainted canvases in view", () => {
    stubLayout();
    document.body.innerHTML = `
      <iframe id="xo" srcdoc="<p>frame</p>"></iframe>
      <iframe id="same" srcdoc="<p>frame</p>"></iframe>
      <video id="v"></video>
      <canvas id="tainted"></canvas>
      <canvas id="clean"></canvas>`;
    stubCrossOrigin(document.getElementById("xo") as HTMLIFrameElement);
    stubTainted(document.getElementById("tainted") as HTMLCanvasElement);
    const clean = document.getElementById("clean") as HTMLCanvasElement;
    clean.width = 10;
    clean.height = 10;
    clean.toDataURL = () => "data:image/png;base64,AAAA";

    const result = scanCaptureLimitations(document);
    expect(result.crossOriginIframes.map((el) => el.id)).toEqual(["xo"]);
    expect(result.videos.map((el) => el.id)).toEqual(["v"]);
    expect(result.taintedCanvases.map((el) => el.id)).toEqual(["tainted"]);
  });

  it("treats an iframe whose contentDocument access throws as cross-origin", () => {
    stubLayout();
    document.body.innerHTML = `<iframe id="xo" srcdoc="<p>frame</p>"></iframe>`;
    Object.defineProperty(document.getElementById("xo"), "contentDocument", {
      get: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    expect(scanCaptureLimitations(document).crossOriginIframes).toHaveLength(1);
  });

  it("ignores excluded subtrees and content outside the viewport", () => {
    stubLayout();
    document.body.innerHTML = `
      <div ${PINPOINT_IGNORE_ATTRIBUTE}><video></video><iframe id="a" srcdoc="<p>frame</p>"></iframe></div>
      <aside><video></video></aside>
      <video data-offscreen></video>
      <iframe id="b" data-offscreen srcdoc="<p>frame</p>"></iframe>`;
    for (const iframe of Array.from(document.querySelectorAll("iframe"))) stubCrossOrigin(iframe);

    const result = scanCaptureLimitations(document, { exclude: (el) => el.localName === "aside" });
    expect(result.videos).toHaveLength(0);
    expect(result.crossOriginIframes).toHaveLength(0);

    const everything = scanCaptureLimitations(document, { viewportOnly: false });
    expect(everything.videos).toHaveLength(2);
    expect(everything.crossOriginIframes.map((el) => el.id)).toEqual(["b"]);
  });

  it("classifies image URLs by origin and visibility", () => {
    stubLayout();
    document.body.innerHTML = `
      <img src="https://cdn.example.net/a.png">
      <img src="/local.png">
      <img src="https://cdn.example.net/off.png" data-offscreen>
      <div style="background-image: url('https://img.example.org/bg.jpg')"></div>
      <img src="data:image/png;base64,AAAA">`;
    const images = scanCaptureLimitations(document).images;
    const byUrl = Object.fromEntries(images.map((i) => [i.url, i]));
    expect(byUrl["https://cdn.example.net/a.png"]).toMatchObject({ crossOrigin: true, visible: true });
    expect(byUrl[new URL("/local.png", document.baseURI).href]).toMatchObject({ crossOrigin: false, visible: true });
    expect(byUrl["https://cdn.example.net/off.png"]).toMatchObject({ visible: false });
    expect(byUrl["https://img.example.org/bg.jpg"]).toMatchObject({ crossOrigin: true, visible: true });
    expect(images.some((i) => i.url.startsWith("data:"))).toBe(false);
  });
});

describe("DomScreenshotCapturer", () => {
  const pngBlob = () => new Blob(["png"], { type: "image/png" });

  it("is the default capturer", () => {
    const capturer = createDefaultCapturer();
    expect(capturer).toBeInstanceOf(DomScreenshotCapturer);
    expect(capturer.id).toBe("dom");
    expect(capturer.isSupported()).toBe(true);
  });

  it("renders the viewport with computed scale and excludes ignored elements", async () => {
    stubLayout();
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(3);
    document.body.innerHTML = `<div id="w" ${PINPOINT_IGNORE_ATTRIBUTE}></div><aside></aside><p>hi</p>`;
    let received: RenderOptions | undefined;
    domToBlobMock.mockImplementation(async (_node: unknown, options?: RenderOptions) => {
      received = options;
      return pngBlob();
    });

    const result = await new DomScreenshotCapturer().capture({ exclude: (el) => el.localName === "aside" });

    expect(received?.scale).toBe(2);
    expect(received?.width).toBe(window.innerWidth);
    expect(received?.height).toBe(window.innerHeight);
    expect(received?.filter?.(document.getElementById("w") as Element)).toBe(false);
    expect(received?.filter?.(document.querySelector("aside") as Element)).toBe(false);
    expect(received?.filter?.(document.querySelector("p") as Element)).toBe(true);
    expect(result).toMatchObject({
      method: "dom",
      scale: 2,
      width: window.innerWidth * 2,
      height: window.innerHeight * 2,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      warnings: [],
    });
    expect(result.blob.type).toBe("image/png");
    expect(typeof result.capturedAt).toBe("string");
  });

  it("replaces inaccessible content with labelled placeholders in the clone and reports it", async () => {
    stubLayout();
    document.body.innerHTML = `<iframe id="xo" style="margin: 4px" srcdoc="<p>frame</p>"></iframe><canvas id="c"></canvas><video id="v"></video><p>text</p>`;
    stubCrossOrigin(document.getElementById("xo") as HTMLIFrameElement);
    stubTainted(document.getElementById("c") as HTMLCanvasElement);

    let clone: HTMLElement | undefined;
    domToBlobMock.mockImplementation(async (node: unknown, options?: RenderOptions) => {
      clone = (node as HTMLElement).cloneNode(true) as HTMLElement;
      await options?.onCloneNode?.(clone);
      return pngBlob();
    });

    const result = await new DomScreenshotCapturer().capture();

    const placeholders = Array.from(clone?.querySelectorAll(`[${PLACEHOLDER_ATTRIBUTE}]`) ?? []);
    expect(placeholders.map((el) => el.getAttribute(PLACEHOLDER_ATTRIBUTE)).sort()).toEqual(["canvas", "iframe", "video"]);
    expect(clone?.querySelector("iframe")).toBeNull();
    const iframePlaceholder = clone?.querySelector(`[${PLACEHOLDER_ATTRIBUTE}="iframe"]`) as HTMLElement;
    expect(iframePlaceholder.textContent).toContain("Cross-origin iframe");
    expect(iframePlaceholder.style.getPropertyValue("margin")).toBe("4px");
    expect(clone?.querySelector(`[${CAPTURE_MARK_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector(`[${CAPTURE_MARK_ATTRIBUTE}]`)).toBeNull();

    const codes = Object.fromEntries(result.warnings.map((w) => [w.code, w]));
    expect(codes["cross-origin-iframe"]).toMatchObject({ count: 1 });
    expect(codes["tainted-canvas"]).toMatchObject({ count: 1 });
    expect(codes["video"]?.message).toMatch(/could not be captured/);
  });

  it("shifts the cloned root to the current scroll position", async () => {
    vi.spyOn(window, "scrollY", "get").mockReturnValue(400);
    let clone: HTMLElement | undefined;
    domToBlobMock.mockImplementation(async (node: unknown, options?: RenderOptions) => {
      clone = (node as HTMLElement).cloneNode(true) as HTMLElement;
      await options?.onCloneNode?.(clone);
      return pngBlob();
    });
    const result = await new DomScreenshotCapturer().capture();
    expect(result.scroll).toEqual({ x: 0, y: 400 });
    expect(clone?.style.getPropertyValue("top")).toBe("-400px");
    expect(clone?.style.getPropertyValue("position")).toBe("relative");
  });

  it("reports visible images that fail to load and skips downloading off-screen ones", async () => {
    stubLayout();
    document.body.innerHTML = `<img src="https://cdn.example.net/a.png"><img src="https://cdn.example.net/off.png" data-offscreen>`;
    const fetchStub = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const sources: Array<string | false> = [];
    domToBlobMock.mockImplementation(async (_node: unknown, options?: RenderOptions) => {
      sources.push((await options?.fetchFn?.("https://cdn.example.net/a.png")) ?? false);
      sources.push((await options?.fetchFn?.("https://cdn.example.net/off.png")) ?? false);
      return pngBlob();
    });

    const result = await new DomScreenshotCapturer({ fetch: fetchStub as unknown as typeof fetch }).capture();
    expect(sources[0]).toBe(PLACEHOLDER_IMAGE_DATA_URL);
    expect(sources[1]).toMatch(/^data:image\/gif;base64,/);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(result.warnings).toEqual([expect.objectContaining({ code: "cross-origin-image", count: 1 })]);
  });

  it("adds a downscaled warning when maxPixels forces it", async () => {
    domToBlobMock.mockResolvedValue(pngBlob());
    const result = await new DomScreenshotCapturer().capture({ maxPixels: 10_000 });
    expect(result.width * result.height).toBeLessThanOrEqual(10_000);
    expect(result.warnings.map((w) => w.code)).toContain("downscaled");
  });

  it("retries without web fonts when rendering fails", async () => {
    domToBlobMock.mockRejectedValueOnce(new Error("font embed failed")).mockResolvedValueOnce(pngBlob());
    const result = await new DomScreenshotCapturer().capture();
    expect(domToBlobMock).toHaveBeenCalledTimes(2);
    expect((domToBlobMock.mock.calls[1] as unknown[] | undefined)?.[1]).toMatchObject({ font: false });
    expect(result.warnings.map((w) => w.code)).toContain("font");
  });

  it("wraps render failures in CaptureError('failed')", async () => {
    domToBlobMock.mockRejectedValue(new Error("nope"));
    await expect(new DomScreenshotCapturer().capture()).rejects.toMatchObject({ name: "CaptureError", code: "failed" });
  });

  it("throws CaptureError('aborted') for an already aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new DomScreenshotCapturer().capture({ signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(domToBlobMock).not.toHaveBeenCalled();
  });

  it("throws CaptureError('aborted') when aborted mid-capture and cleans up marks", async () => {
    stubLayout();
    document.body.innerHTML = `<iframe id="xo" srcdoc="<p>frame</p>"></iframe>`;
    stubCrossOrigin(document.getElementById("xo") as HTMLIFrameElement);
    const controller = new AbortController();
    domToBlobMock.mockImplementation(() => {
      queueMicrotask(() => controller.abort());
      return new Promise<Blob>(() => {});
    });
    const error = await new DomScreenshotCapturer().capture({ signal: controller.signal }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaptureError);
    expect((error as CaptureError).code).toBe("aborted");
    expect(document.querySelector(`[${CAPTURE_MARK_ATTRIBUTE}]`)).toBeNull();
  });

  it("fails with a timeout error when rendering hangs", async () => {
    domToBlobMock.mockImplementation(() => new Promise<Blob>(() => {}));
    await expect(new DomScreenshotCapturer({ timeoutMs: 20 }).capture()).rejects.toMatchObject({
      code: "failed",
      message: expect.stringMatching(/timed out/),
    });
  });
});

describe("DisplayMediaScreenshotCapturer", () => {
  interface FakeTrack {
    stop: ReturnType<typeof vi.fn>;
    readyState: string;
    getSettings: () => { displaySurface?: string };
  }

  function fakeStream(displaySurface = "browser") {
    const track: FakeTrack = { stop: vi.fn(), readyState: "live", getSettings: () => ({ displaySurface }) };
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
    return { stream, track };
  }

  function installMediaDevices(getDisplayMedia: () => Promise<MediaStream>) {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getDisplayMedia: vi.fn(getDisplayMedia) } });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    return (navigator.mediaDevices as unknown as { getDisplayMedia: ReturnType<typeof vi.fn> }).getDisplayMedia;
  }

  function installFrameGrabbing(grabFrame: () => Promise<unknown> = async () => ({ width: 2048, height: 1536, close: vi.fn() })) {
    vi.stubGlobal(
      "ImageCapture",
      class {
        grabFrame = grabFrame;
      },
    );
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as RenderingContext);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback: BlobCallback) {
      callback(new Blob(["png"], { type: "image/png" }));
    });
    return { drawImage };
  }

  const fast = () => new DisplayMediaScreenshotCapturer({ settleDelayMs: 0 });

  it("reports support only with the API in a secure context", () => {
    installMediaDevices(async () => fakeStream().stream);
    expect(fast().isSupported()).toBe(true);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    expect(fast().isSupported()).toBe(false);
  });

  it("requests the current tab, grabs a frame and stops all tracks", async () => {
    const { stream, track } = fakeStream();
    const getDisplayMedia = installMediaDevices(async () => stream);
    const { drawImage } = installFrameGrabbing();

    const result = await fast().capture();

    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ preferCurrentTab: true, selfBrowserSurface: "include" }));
    expect(track.stop).toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalled();
    expect(result.method).toBe("display-media");
    expect(result.blob.type).toBe("image/png");
    expect(result.viewport).toEqual({ width: window.innerWidth, height: window.innerHeight });
    expect(result.scale).toBeCloseTo(2048 / window.innerWidth, 5);
    expect(result.warnings).toEqual([]);
  });

  it("hides excluded elements while grabbing and restores them afterwards", async () => {
    document.body.innerHTML = `<div id="w" ${PINPOINT_IGNORE_ATTRIBUTE}></div>`;
    const widget = document.getElementById("w") as HTMLElement;
    installMediaDevices(async () => fakeStream().stream);
    let visibilityDuringGrab = "";
    installFrameGrabbing(async () => {
      visibilityDuringGrab = widget.style.getPropertyValue("visibility");
      return { width: 100, height: 100, close: vi.fn() };
    });

    await fast().capture();
    expect(visibilityDuringGrab).toBe("hidden");
    expect(widget.style.getPropertyValue("visibility")).toBe("");
  });

  it("stops tracks and restores excluded elements when grabbing fails", async () => {
    document.body.innerHTML = `<div id="w" ${PINPOINT_IGNORE_ATTRIBUTE}></div>`;
    const { stream, track } = fakeStream();
    installMediaDevices(async () => stream);
    installFrameGrabbing();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    await expect(fast().capture()).rejects.toMatchObject({ code: "failed" });
    expect(track.stop).toHaveBeenCalled();
    expect((document.getElementById("w") as HTMLElement).style.getPropertyValue("visibility")).toBe("");
  });

  it("maps a user cancel (NotAllowedError) to CaptureError('cancelled')", async () => {
    installMediaDevices(async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    });
    const error = await fast().capture().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaptureError);
    expect((error as CaptureError).code).toBe("cancelled");
  });

  it("maps other getDisplayMedia errors", () => {
    expect(toDisplayMediaError(new DOMException("x", "NotSupportedError")).code).toBe("unsupported");
    expect(toDisplayMediaError(new DOMException("x", "AbortError")).code).toBe("failed");
  });

  it("stops tracks and throws 'aborted' when aborted while the picker is open", async () => {
    const { stream, track } = fakeStream();
    const controller = new AbortController();
    installMediaDevices(async () => {
      controller.abort();
      return stream;
    });
    installFrameGrabbing();
    await expect(fast().capture({ signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(track.stop).toHaveBeenCalled();
  });

  it("warns when a surface other than the tab was shared", async () => {
    installMediaDevices(async () => fakeStream("monitor").stream);
    installFrameGrabbing();
    const result = await fast().capture();
    expect(result.warnings).toEqual([expect.objectContaining({ code: "unknown" })]);
  });

  it("throws 'unsupported' when the API is missing", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    await expect(fast().capture()).rejects.toMatchObject({ code: "unsupported" });
  });
});

describe("getAccessibleFrameDocument (declared src)", () => {
  it("treats a cross-origin src as inaccessible even before it navigates", async () => {
    const { getAccessibleFrameDocument } = await import("../src/capture/index");
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", "https://third-party.example/embed");
    Object.defineProperty(iframe, "contentDocument", { value: document.implementation.createHTMLDocument("") });
    expect(getAccessibleFrameDocument(iframe)).toBeNull();
  });
});

describe("DomScreenshotCapturer off-screen media", () => {
  it("hides unloaded off-screen images from the load wait only while capturing", async () => {
    const { DomScreenshotCapturer } = await import("../src/capture/index");
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const top = this.hasAttribute("data-offscreen") ? 5000 : 0;
      return { x: 0, y: top, left: 0, top, right: 100, bottom: top + 100, width: 100, height: 100, toJSON: () => ({}) } as DOMRect;
    });
    document.body.innerHTML = `<img src="https://cdn.example.net/lazy.png" loading="lazy" data-offscreen>`;
    const lazy = document.querySelector("img")!;
    Object.defineProperty(lazy, "complete", { configurable: true, value: false });
    let srcDuringCapture: string | undefined;
    vi.mocked(domToBlob).mockImplementation(async () => {
      srcDuringCapture = lazy.currentSrc;
      return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    });

    await new DomScreenshotCapturer().capture();
    expect(srcDuringCapture).toBe("");
    expect(Object.prototype.hasOwnProperty.call(lazy, "currentSrc")).toBe(false);
    expect(lazy.getAttribute("src")).toBe("https://cdn.example.net/lazy.png");
  });
});
