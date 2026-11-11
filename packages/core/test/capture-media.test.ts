import { afterEach, describe, expect, it, vi } from "vitest";
import { suspendOffscreenMedia } from "../src/capture/media";

const VIEWPORT = { width: 1000, height: 800 };

function rect(top: number, height = 100): DOMRect {
  return { x: 0, y: top, left: 0, top, right: 100, bottom: top + height, width: 100, height, toJSON: () => ({}) } as DOMRect;
}

function img(src: string, opts: { complete: boolean; top: number; height?: number }): HTMLImageElement {
  const el = document.createElement("img");
  el.setAttribute("src", src);
  Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get() { return this.dataset.complete === "1"; } });
  el.dataset.complete = opts.complete ? "1" : "0";
  el.getBoundingClientRect = () => rect(opts.top, opts.height);
  document.body.append(el);
  return el;
}

function video(opts: { readyState: number; top: number; src?: string; stream?: boolean }): HTMLVideoElement {
  const el = document.createElement("video");
  el.setAttribute("src", opts.src ?? "https://cdn.example.net/v.mp4");
  if (opts.stream) Object.defineProperty(el, "srcObject", { configurable: true, value: {} });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get() { return Number(this.dataset.ready); } });
  el.dataset.ready = String(opts.readyState);
  el.getBoundingClientRect = () => rect(opts.top);
  document.body.append(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("suspendOffscreenMedia", () => {
  it("settles unloaded off-screen images and videos, and restores them", () => {
    const lazy = img("https://cdn.example.net/lazy.png", { complete: false, top: 5000 });
    const hidden = img("https://cdn.example.net/hidden.png", { complete: false, top: 0, height: 0 });
    const offVideo = video({ readyState: 0, top: 3000 });
    const srcBefore = lazy.src;

    const restore = suspendOffscreenMedia(document, VIEWPORT);
    expect(lazy.currentSrc).toBe("");
    expect(lazy.src).toBe("");
    expect(hidden.src).toBe("");
    expect(offVideo.tagName).toBe("DIV");
    expect(offVideo.src).toBe("");
    expect(lazy.getAttribute("src")).toBe("https://cdn.example.net/lazy.png");

    restore();
    expect(lazy.src).toBe(srcBefore);
    expect(Object.prototype.hasOwnProperty.call(lazy, "src")).toBe(false);
    expect(offVideo.tagName).toBe("VIDEO");
    expect(offVideo.src).toContain("v.mp4");
  });

  it("leaves visible, loaded and already-overridden media alone", () => {
    const visibleLoading = img("https://cdn.example.net/hero.png", { complete: false, top: 100 });
    const offscreenLoaded = img("https://cdn.example.net/done.png", { complete: true, top: 5000 });
    const playingVideo = video({ readyState: 4, top: 200 });
    const custom = img("https://cdn.example.net/custom.png", { complete: false, top: 5000 });
    Object.defineProperty(custom, "src", { configurable: true, value: "own" });
    Object.defineProperty(custom, "currentSrc", { configurable: true, value: "own" });

    const restore = suspendOffscreenMedia(document, VIEWPORT);
    expect(visibleLoading.src).toContain("hero.png");
    expect(offscreenLoaded.src).toContain("done.png");
    expect(playingVideo.tagName).toBe("VIDEO");
    expect(custom.src).toBe("own");
    restore();
    expect(custom.src).toBe("own");
  });

  it("guards visible videos that can't be cloned to a frame", () => {
    const unloaded = video({ readyState: 0, top: 100 });
    const camera = video({ readyState: 4, top: 100, src: "", stream: true });
    const hls = video({ readyState: 4, top: 100, src: "blob:https://app.example/123" });
    const restore = suspendOffscreenMedia(document, VIEWPORT);
    for (const v of [unloaded, camera, hls]) expect(v.tagName).toBe("DIV");
    restore();
    for (const v of [unloaded, camera, hls]) expect(v.tagName).toBe("VIDEO");
  });

  it("restore is idempotent", () => {
    img("https://cdn.example.net/lazy.png", { complete: false, top: 5000 });
    const restore = suspendOffscreenMedia(document, VIEWPORT);
    restore();
    expect(() => restore()).not.toThrow();
  });
});
