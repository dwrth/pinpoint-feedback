import { domToBlob, type Options as RenderOptions } from "modern-screenshot";
import type { ScreenshotCapturer } from "../interfaces";
import type { CaptureOptions, CaptureWarning, CapturedScreenshot, Point, Size } from "../types";
import { blobToDataUrl, raceCapture } from "./async";
import { CaptureError, isCaptureError, throwIfAborted } from "./errors";
import { createCaptureFilter } from "./exclusion";
import { scanCaptureLimitations, type CaptureLimitations, type ScannedImage } from "./limitations";
import { captureTranslator, type CaptureLocaleOptions, type CaptureTranslate } from "./messages";
import { PLACEHOLDER_IMAGE_DATA_URL, replaceWithPlaceholder, type PlaceholderKind } from "./placeholder";
import { computeCaptureScale } from "./scale";

export interface DomScreenshotCapturerOptions extends CaptureLocaleOptions {
  /** Replace uncapturable content (cross-origin iframes, tainted canvases, failed images...) with labelled hatched placeholders. Default true. */
  placeholders?: boolean;
  /** Timeout per image/media request in ms. Default 10000. */
  fetchTimeoutMs?: number;
  /** Overall capture timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Embed web fonts into the capture. Falls back to system fonts (with a warning) if embedding fails. Default true. */
  embedFonts?: boolean;
  /** Canvas background. Defaults to the page's (html, then body) background colour, else white. */
  backgroundColor?: string;
  /** Fetch implementation used to inline images. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** Temporary attribute that links live elements to their clones during a capture. */
export const CAPTURE_MARK_ATTRIBUTE = "data-pinpoint-capture-ref";

const TRANSPARENT_PIXEL_DATA_URL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 30_000;

interface MarkInfo {
  placeholder?: PlaceholderKind;
  size?: Size;
  sticky?: Point;
}

interface RenderState {
  failedImages: Set<string>;
  videosNotCaptured: number;
}

interface RenderContext {
  viewport: Size;
  scroll: Point;
  scale: number;
  options: CaptureOptions;
  marks: Map<string, MarkInfo>;
  bodyTransform: string;
  shiftRoot: boolean;
  backgroundColor: string;
  state: RenderState;
  t: CaptureTranslate;
  isCancelled: () => boolean;
}

export function getLayoutViewport(doc: Document): Size {
  const win = doc.defaultView;
  const html = doc.documentElement;
  const width = html.clientWidth || win?.innerWidth || 0;
  const height = Math.min(win?.innerHeight || Infinity, html.clientHeight || Infinity);
  return { width, height: Number.isFinite(height) ? height : 0 };
}

export function getScrollPosition(win: Window): Point {
  return { x: win.scrollX || win.pageXOffset || 0, y: win.scrollY || win.pageYOffset || 0 };
}

function isTransparent(color: string): boolean {
  return !color || color === "transparent" || /[,/]\s*0(\.0+)?\s*\)$/.test(color);
}

function resolveBackgroundColor(doc: Document): string {
  for (const element of [doc.documentElement, doc.body]) {
    if (!element) continue;
    const color = doc.defaultView?.getComputedStyle(element).backgroundColor ?? "";
    if (!isTransparent(color)) return color;
  }
  return "#ffffff";
}

function elementSize(element: Element): Size {
  const html = element as Partial<HTMLElement>;
  if (typeof html.offsetWidth === "number" && (html.offsetWidth > 0 || (html.offsetHeight ?? 0) > 0)) {
    return { width: html.offsetWidth, height: html.offsetHeight ?? 0 };
  }
  const rect = element.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

/** Offset between where a sticky element currently is (stuck) and its in-flow position. */
function measureStickyOffset(element: HTMLElement): Point {
  const stuck = element.getBoundingClientRect();
  const style = element.style;
  const value = style.getPropertyValue("position");
  const priority = style.getPropertyPriority("position");
  style.setProperty("position", "static", "important");
  const natural = element.getBoundingClientRect();
  if (value) style.setProperty("position", value, priority);
  else style.removeProperty("position");
  return { x: stuck.left - natural.left, y: stuck.top - natural.top };
}

function normalizeUrl(url: string): string {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

/** Rasterises the current viewport (at the current scroll position) via modern-screenshot. */
export class DomScreenshotCapturer implements ScreenshotCapturer {
  readonly id = "dom";
  private readonly config: DomScreenshotCapturerOptions;

  constructor(options: DomScreenshotCapturerOptions = {}) {
    this.config = options;
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && typeof document !== "undefined" && Boolean(document.documentElement);
  }

  async capture(options: CaptureOptions = {}): Promise<CapturedScreenshot> {
    const { signal } = options;
    throwIfAborted(signal);
    if (!this.isSupported()) {
      throw new CaptureError("unsupported", "DOM screenshot capture requires a browser environment.");
    }

    const doc = document;
    const win = window;
    const viewport = getLayoutViewport(doc);
    if (viewport.width <= 0 || viewport.height <= 0) {
      throw new CaptureError("failed", "The viewport has no visible area to capture.");
    }
    const scroll = getScrollPosition(win);
    const sizing = computeCaptureScale({
      width: viewport.width,
      height: viewport.height,
      devicePixelRatio: win.devicePixelRatio,
      maxScale: options.maxScale,
      maxPixels: options.maxPixels,
    });

    const limitations = scanCaptureLimitations(doc, { exclude: options.exclude });
    const marked: Element[] = [];
    const marks = new Map<string, MarkInfo>();
    const mark = (element: Element, info: MarkInfo) => {
      const id = String(marks.size + 1);
      element.setAttribute(CAPTURE_MARK_ATTRIBUTE, id);
      marks.set(id, info);
      marked.push(element);
    };

    const i18n: CaptureLocaleOptions = {
      messages: options.messages ?? this.config.messages,
      locale: options.locale ?? this.config.locale,
    };
    const t = captureTranslator(i18n);
    let cancelled = false;
    const state: RenderState = { failedImages: new Set(), videosNotCaptured: 0 };

    try {
      const stickyOffsets = new Map<Element, Point>(
        limitations.stickyElements.map((element) => [element, measureStickyOffset(element)]),
      );
      const withSticky = (element: Element, info: MarkInfo): MarkInfo => {
        const sticky = stickyOffsets.get(element);
        stickyOffsets.delete(element);
        return sticky ? { ...info, sticky } : info;
      };
      for (const iframe of limitations.crossOriginIframes) {
        mark(iframe, withSticky(iframe, { placeholder: "iframe", size: elementSize(iframe) }));
      }
      for (const object of limitations.embeddedObjects) {
        mark(object, withSticky(object, { placeholder: "object", size: elementSize(object) }));
      }
      for (const canvas of limitations.taintedCanvases) {
        mark(canvas, withSticky(canvas, { placeholder: "canvas", size: elementSize(canvas) }));
      }
      for (const video of limitations.videos) {
        mark(video, withSticky(video, { placeholder: "video", size: elementSize(video) }));
      }
      for (const [element, sticky] of stickyOffsets) mark(element, { sticky });

      const context: RenderContext = {
        viewport,
        scroll,
        scale: sizing.scale,
        options,
        marks,
        bodyTransform: doc.body ? (win.getComputedStyle(doc.body).transform || "none") : "none",
        shiftRoot: doc.compatMode !== "BackCompat",
        backgroundColor: this.config.backgroundColor ?? resolveBackgroundColor(doc),
        state,
        t,
        isCancelled: () => cancelled || Boolean(signal?.aborted),
      };

      const { blob, fontFallback } = await raceCapture(
        this.renderWithFontFallback(doc.documentElement, context),
        signal,
        this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        "Screenshot capture",
      );

      return {
        blob,
        width: sizing.width,
        height: sizing.height,
        scale: sizing.scale,
        viewport,
        scroll,
        method: "dom",
        warnings: buildDomWarnings(limitations, state, {
          downscaled: sizing.downscaled,
          fontFallback,
          placeholders: this.placeholders,
        }, i18n),
        capturedAt: new Date().toISOString(),
      };
    } catch (error) {
      cancelled = true;
      if (isCaptureError(error)) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new CaptureError("failed", `Screenshot capture failed: ${reason}`, { cause: error });
    } finally {
      for (const element of marked) element.removeAttribute(CAPTURE_MARK_ATTRIBUTE);
    }
  }

  private get placeholders(): boolean {
    return this.config.placeholders ?? true;
  }

  private get failedImageSource(): string {
    return this.placeholders ? PLACEHOLDER_IMAGE_DATA_URL : TRANSPARENT_PIXEL_DATA_URL;
  }

  private async renderWithFontFallback(root: HTMLElement, context: RenderContext): Promise<{ blob: Blob; fontFallback: boolean }> {
    const embedFonts = this.config.embedFonts ?? true;
    try {
      return { blob: await domToBlob(root, this.renderOptions(context, embedFonts)), fontFallback: false };
    } catch (error) {
      if (!embedFonts || context.isCancelled()) throw error;
      context.state.failedImages.clear();
      context.state.videosNotCaptured = 0;
      return { blob: await domToBlob(root, this.renderOptions(context, false)), fontFallback: true };
    }
  }

  private renderOptions(context: RenderContext, embedFonts: boolean): RenderOptions {
    const fetchTimeoutMs = this.config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    return {
      width: context.viewport.width,
      height: context.viewport.height,
      scale: context.scale,
      type: "image/png",
      backgroundColor: context.backgroundColor,
      filter: createCaptureFilter(context.options.exclude),
      timeout: fetchTimeoutMs,
      font: embedFonts ? {} : false,
      features: { restoreScrollPosition: true },
      fetch: { placeholderImage: this.failedImageSource },
      fetchFn: (url) => this.fetchImage(url, context, fetchTimeoutMs),
      onCloneNode: (clone) => this.fixupClone(clone, context),
    };
  }

  private async fetchImage(url: string, context: RenderContext, timeoutMs: number): Promise<string | false> {
    if (url.startsWith("data:")) return false;
    const fetchImpl = this.config.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = context.options.signal;
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetchImpl(url, { mode: "cors", cache: "force-cache", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await blobToDataUrl(await response.blob());
    } catch {
      context.state.failedImages.add(normalizeUrl(url));
      return this.failedImageSource;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private fixupClone(clone: Node, context: RenderContext): void {
    if (clone.nodeType !== 1) return;
    const root = clone as HTMLElement;
    const { scroll } = context;

    root.style.setProperty("overflow", "visible", "important");
    if (context.shiftRoot) {
      root.style.setProperty("position", "relative", "important");
      root.style.setProperty("top", `${-scroll.y}px`, "important");
      root.style.setProperty("left", `${-scroll.x}px`, "important");
      if (scroll.x !== 0 || scroll.y !== 0) {
        const body = Array.from(root.children).find((child) => child.localName === "body") as HTMLElement | undefined;
        if (body?.style) {
          if (context.bodyTransform === "none") body.style.removeProperty("transform");
          else body.style.setProperty("transform", context.bodyTransform);
        }
      }
    }

    for (const element of Array.from(root.querySelectorAll(`[${CAPTURE_MARK_ATTRIBUTE}]`))) {
      const info = context.marks.get(element.getAttribute(CAPTURE_MARK_ATTRIBUTE) ?? "");
      element.removeAttribute(CAPTURE_MARK_ATTRIBUTE);
      if (!info) continue;

      let target: Element = element;
      const stillVideo = info.placeholder === "video" && element.localName === "video";
      if (stillVideo) context.state.videosNotCaptured++;
      if (info.placeholder && this.placeholders && (info.placeholder !== "video" || stillVideo)) {
        target = replaceWithPlaceholder(
          element,
          info.placeholder,
          info.size ?? elementSize(element),
          context.t(`placeholder.${info.placeholder}`),
        );
      }

      const style = (target as Partial<ElementCSSInlineStyle>).style;
      if (info.sticky && style) {
        style.setProperty("position", "relative", "important");
        style.setProperty("top", `${info.sticky.y}px`, "important");
        style.setProperty("left", `${info.sticky.x}px`, "important");
        style.setProperty("bottom", "auto", "important");
        style.setProperty("right", "auto", "important");
      }
    }
  }
}

export interface DomWarningFlags {
  downscaled: boolean;
  fontFallback: boolean;
  placeholders: boolean;
}

/** Translates scan results and render outcomes into warnings (messages in the given locale, English by default). */
export function buildDomWarnings(
  limitations: CaptureLimitations,
  state: { failedImages: ReadonlySet<string>; videosNotCaptured: number },
  flags: DomWarningFlags,
  i18n: CaptureLocaleOptions = {},
): CaptureWarning[] {
  const t = captureTranslator(i18n);
  const warnings: CaptureWarning[] = [];
  const labelled = flags.placeholders ? t("warning.labelledPlaceholders") : t("warning.leftBlank");
  const hatched = flags.placeholders ? t("warning.hatchedPlaceholders") : t("warning.leftBlank");

  const iframes = limitations.crossOriginIframes.length;
  if (iframes > 0) {
    warnings.push({
      code: "cross-origin-iframe",
      count: iframes,
      message: `${t("warning.crossOriginIframe", { count: iframes })} ${labelled}`,
    });
  }

  const canvases = limitations.taintedCanvases.length;
  if (canvases > 0) {
    warnings.push({
      code: "tainted-canvas",
      count: canvases,
      message: `${t("warning.taintedCanvas", { count: canvases })} ${labelled}`,
    });
  }

  const videos = limitations.videos.length;
  if (videos > 0) {
    const missing = Math.min(videos, state.videosNotCaptured);
    const stills = videos - missing;
    const parts: string[] = [];
    if (missing > 0) parts.push(`${t("warning.videoNotCaptured", { count: missing })} ${labelled}`);
    if (stills > 0) parts.push(t("warning.videoStill", { count: stills }));
    warnings.push({ code: "video", count: videos, message: parts.join(" ") });
  }

  const objects = limitations.embeddedObjects.length;
  if (objects > 0) {
    warnings.push({
      code: "unknown",
      count: objects,
      message: `${t("warning.embeddedObject", { count: objects })} ${labelled}`,
    });
  }

  const scanned = new Map<string, ScannedImage>(limitations.images.map((image) => [image.url, image]));
  let crossOriginFailed = 0;
  let otherFailed = 0;
  for (const url of state.failedImages) {
    const image = scanned.get(url);
    if (image && !image.visible) continue;
    if (image ? image.crossOrigin : !url.startsWith(location.origin)) crossOriginFailed++;
    else otherFailed++;
  }
  if (crossOriginFailed > 0) {
    warnings.push({
      code: "cross-origin-image",
      count: crossOriginFailed,
      message: `${t("warning.crossOriginImage", { count: crossOriginFailed })} ${hatched}`,
    });
  }
  if (otherFailed > 0) {
    warnings.push({
      code: "unknown",
      count: otherFailed,
      message: `${t("warning.imageFailed", { count: otherFailed })} ${hatched}`,
    });
  }

  if (flags.fontFallback) warnings.push({ code: "font", message: t("warning.font") });
  if (flags.downscaled) warnings.push({ code: "downscaled", message: t("warning.downscaled") });

  return warnings;
}
