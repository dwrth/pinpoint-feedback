import { isExcludedElement, type ExcludePredicate } from "./exclusion";

export interface ScannedImage {
  /** Absolute URL. */
  url: string;
  crossOrigin: boolean;
  /** Whether at least one element using this URL intersects the viewport. */
  visible: boolean;
}

/** Content in the page that DOM rasterisation cannot (or may not) reproduce faithfully. */
export interface CaptureLimitations {
  /** Iframes whose document cannot be read (cross-origin or sandboxed). */
  crossOriginIframes: HTMLIFrameElement[];
  /** `<object>` / `<embed>` elements; their content is never rasterised. */
  embeddedObjects: HTMLElement[];
  /** Canvases whose pixels cannot be read (toDataURL throws SecurityError). */
  taintedCanvases: HTMLCanvasElement[];
  videos: HTMLVideoElement[];
  /** `position: sticky` elements; their stuck position must be reproduced explicitly. */
  stickyElements: HTMLElement[];
  /** Images referenced by `<img>` or `background-image`, deduplicated by URL. */
  images: ScannedImage[];
}

export interface ScanOptions {
  exclude?: ExcludePredicate;
  /** Only report elements intersecting the viewport. Default true. */
  viewportOnly?: boolean;
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const CSS_URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/g;

function intersects(rect: DOMRect, bounds: Bounds | null): boolean {
  if (rect.width <= 0 && rect.height <= 0) return false;
  if (!bounds) return true;
  return rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom;
}

function viewportBounds(doc: Document): Bounds {
  const win = doc.defaultView;
  const html = doc.documentElement;
  return {
    left: 0,
    top: 0,
    right: html.clientWidth || win?.innerWidth || 0,
    bottom: Math.min(win?.innerHeight || Infinity, html.clientHeight || Infinity),
  };
}

function frameBounds(iframe: HTMLIFrameElement): Bounds {
  return { left: 0, top: 0, right: iframe.clientWidth, bottom: iframe.clientHeight };
}

/** Returns the iframe's document if it can be read from this realm, otherwise null. */
export function getAccessibleFrameDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    const doc = iframe.contentDocument;
    if (!doc) return null;
    void doc.documentElement;
    return doc;
  } catch {
    return null;
  }
}

export function isCanvasTainted(canvas: HTMLCanvasElement): boolean {
  if (canvas.width === 0 || canvas.height === 0) return false;
  try {
    canvas.toDataURL();
    return false;
  } catch (error) {
    return (error as { name?: unknown } | null)?.name === "SecurityError";
  }
}

function toAbsoluteUrl(raw: string, base: string): string | null {
  if (!raw || raw.startsWith("data:")) return null;
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

function isCrossOrigin(url: string, origin: string | undefined): boolean {
  if (url.startsWith("blob:")) return false;
  try {
    return new URL(url).origin !== origin;
  } catch {
    return false;
  }
}

/** Extracts absolute URLs from a CSS value such as `background-image`. */
export function parseCssUrls(value: string, base: string): string[] {
  if (!value || value === "none") return [];
  const urls: string[] = [];
  for (const match of value.matchAll(CSS_URL_RE)) {
    const url = toAbsoluteUrl(match[2] ?? "", base);
    if (url) urls.push(url);
  }
  return urls;
}

/**
 * Walks the DOM (including open shadow roots and same-origin iframes), skipping excluded
 * and `display: none` subtrees, and reports content that DOM rasterisation cannot reproduce.
 */
export function scanCaptureLimitations(root: Element | Document, options: ScanOptions = {}): CaptureLimitations {
  const rootElement = "documentElement" in root ? root.documentElement : root;
  const topDoc = rootElement.ownerDocument;
  const origin = topDoc.defaultView?.location.origin;
  const viewportOnly = options.viewportOnly ?? true;

  const result: CaptureLimitations = {
    crossOriginIframes: [],
    embeddedObjects: [],
    taintedCanvases: [],
    videos: [],
    stickyElements: [],
    images: [],
  };
  const images = new Map<string, ScannedImage>();
  const addImage = (url: string, visible: () => boolean) => {
    const existing = images.get(url);
    if (existing) {
      if (!existing.visible && visible()) existing.visible = true;
      return;
    }
    images.set(url, { url, crossOrigin: isCrossOrigin(url, origin), visible: visible() });
  };

  const stack: Array<{ element: Element; bounds: Bounds | null }> = [
    { element: rootElement, bounds: viewportOnly ? viewportBounds(topDoc) : null },
  ];

  while (stack.length > 0) {
    const { element, bounds } = stack.pop() as { element: Element; bounds: Bounds | null };
    if (isExcludedElement(element, options.exclude)) continue;

    const doc = element.ownerDocument;
    const style = doc.defaultView?.getComputedStyle(element);
    if (style?.display === "none") continue;

    let visibleCache: boolean | undefined;
    const visible = () => (visibleCache ??= intersects(element.getBoundingClientRect(), bounds));
    const base = doc.baseURI;

    switch (element.localName) {
      case "iframe": {
        const iframe = element as HTMLIFrameElement;
        const frameDoc = getAccessibleFrameDocument(iframe);
        if (!frameDoc) {
          if (visible()) result.crossOriginIframes.push(iframe);
        } else if (visible() || !viewportOnly) {
          stack.push({ element: frameDoc.documentElement, bounds: viewportOnly ? frameBounds(iframe) : null });
        }
        break;
      }
      case "object":
      case "embed":
        if (visible()) result.embeddedObjects.push(element as HTMLElement);
        break;
      case "canvas":
        if (visible() && isCanvasTainted(element as HTMLCanvasElement)) {
          result.taintedCanvases.push(element as HTMLCanvasElement);
        }
        break;
      case "video":
        if (visible()) result.videos.push(element as HTMLVideoElement);
        break;
      case "img": {
        const img = element as HTMLImageElement;
        const url = toAbsoluteUrl(img.currentSrc || img.getAttribute("src") || "", base);
        if (url) addImage(url, visible);
        break;
      }
    }

    if (style) {
      if (style.position === "sticky" && visible()) result.stickyElements.push(element as HTMLElement);
      for (const url of parseCssUrls(style.backgroundImage, base)) addImage(url, visible);
    }

    for (const child of Array.from(element.children)) stack.push({ element: child, bounds });
    if (element.shadowRoot) {
      for (const child of Array.from(element.shadowRoot.children)) stack.push({ element: child, bounds });
    }
  }

  result.images = [...images.values()];
  return result;
}
