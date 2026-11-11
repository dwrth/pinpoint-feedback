import type { Size } from "../types";

const HAVE_CURRENT_DATA = 2;

function intersectsViewport(rect: DOMRect, viewport: Size): boolean {
  if (rect.width <= 0 && rect.height <= 0) return false;
  return rect.right > 0 && rect.left < viewport.width && rect.bottom > 0 && rect.top < viewport.height;
}

/**
 * Only visible, loaded videos played from an http(s) URL can be cloned to a still frame.
 * Everything else would hang modern-screenshot's video cloning, which waits for the copy's
 * `loadeddata` and `seeked` events without a timeout: unloaded or `preload="none"` videos,
 * MediaStream sources (`srcObject`, e.g. WebRTC camera tiles) and MediaSource/blob URLs (HLS/DASH players).
 */
function canCloneVideo(video: HTMLVideoElement, visible: boolean): boolean {
  if (!visible || video.readyState < HAVE_CURRENT_DATA || video.srcObject) return false;
  const source = video.currentSrc || video.src;
  return /^https?:/i.test(source);
}

function override(element: Element, values: Record<string, unknown>): string[] {
  const keys = Object.keys(values).filter((key) => !Object.prototype.hasOwnProperty.call(element, key));
  for (const key of keys) {
    Object.defineProperty(element, key, { configurable: true, enumerable: false, get: () => values[key] });
  }
  return keys;
}

/**
 * Keeps modern-screenshot from stalling on media that isn't part of the screenshot:
 *
 * - It waits for every `<img>` and `<video>` in the document to load, up to its timeout per
 *   element. Off-screen lazy images never load on their own, so each stalls the capture.
 * - It clones videos by waiting for the copy to load and seek, without any timeout.
 *
 * For the duration of a capture, unloaded off-screen images report an empty source and videos
 * that can't be cloned to a frame report themselves as plain elements. These are instance-level
 * property overrides only: no attributes change, no loads start or stop and no events fire.
 * Off-screen clones render empty (outside the captured viewport); visible videos that can't be
 * cloned stay `<video>` clones, which the capturer replaces with a labelled placeholder.
 *
 * Returns a function that removes all overrides.
 */
export function suspendOffscreenMedia(root: ParentNode, viewport: Size): () => void {
  const overridden: Array<{ element: Element; keys: string[] }> = [];
  const track = (element: Element, values: Record<string, unknown>) => {
    const keys = override(element, values);
    if (keys.length > 0) overridden.push({ element, keys });
  };

  for (const element of Array.from(root.querySelectorAll<HTMLImageElement | HTMLVideoElement>("img, video"))) {
    const visible = intersectsViewport(element.getBoundingClientRect(), viewport);
    if (element.localName === "img") {
      if (!visible && !(element as HTMLImageElement).complete) track(element, { currentSrc: "", src: "" });
    } else if (!canCloneVideo(element as HTMLVideoElement, visible)) {
      track(element, { tagName: "DIV", currentSrc: "", src: "" });
    }
  }

  return () => {
    for (const { element, keys } of overridden.splice(0)) {
      for (const key of keys) delete (element as unknown as Record<string, unknown>)[key];
    }
  };
}
