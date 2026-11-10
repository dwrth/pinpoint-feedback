import type { ScreenshotCapturer } from "../interfaces";
import type { CaptureOptions, CaptureWarning, CapturedScreenshot, Size } from "../types";
import { canvasToPngBlob, delay, raceCapture, waitForAnimationFrames } from "./async";
import { CaptureError, abortError, isCaptureError, throwIfAborted } from "./errors";
import { hideExcludedElements } from "./exclusion";
import { captureTranslator, type CaptureLocaleOptions } from "./messages";
import { computeCaptureScale } from "./scale";

export interface DisplayMediaScreenshotCapturerOptions extends CaptureLocaleOptions {
  /** Extra wait after hiding excluded elements (lets the "sharing this tab" bar and layout settle). Default 150. */
  settleDelayMs?: number;
  /** Timeout for obtaining a frame once the stream is live. Default 5000. */
  frameTimeoutMs?: number;
}

interface GrabbedFrame {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

interface ImageCaptureLike {
  grabFrame(): Promise<ImageBitmap>;
}
type ImageCaptureConstructor = new (track: MediaStreamTrack) => ImageCaptureLike;

type ExtendedDisplayMediaOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
  systemAudio?: "include" | "exclude";
  monitorTypeSurfaces?: "include" | "exclude";
};

const DISPLAY_MEDIA_OPTIONS: ExtendedDisplayMediaOptions = {
  video: { displaySurface: "browser" } as MediaTrackConstraints,
  audio: false,
  preferCurrentTab: true,
  selfBrowserSurface: "include",
  surfaceSwitching: "exclude",
  systemAudio: "exclude",
  monitorTypeSurfaces: "exclude",
};

/** Maps a getDisplayMedia rejection to a CaptureError. */
export function toDisplayMediaError(error: unknown): CaptureError {
  if (isCaptureError(error)) return error;
  const name = (error as { name?: unknown } | null)?.name;
  const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
  switch (name) {
    case "NotAllowedError":
      return new CaptureError("cancelled", `Screen capture was cancelled or not permitted${detail}.`, { cause: error });
    case "NotSupportedError":
    case "NotFoundError":
    case "TypeError":
      return new CaptureError("unsupported", `Screen capture is not supported here${detail}.`, { cause: error });
    case "InvalidStateError":
      return new CaptureError("failed", `Screen capture must be started from a user gesture${detail}.`, { cause: error });
    default:
      return new CaptureError("failed", `Screen capture failed${detail}.`, { cause: error });
  }
}

async function grabWithImageCapture(track: MediaStreamTrack): Promise<GrabbedFrame | null> {
  const ImageCaptureImpl = (globalThis as unknown as { ImageCapture?: ImageCaptureConstructor }).ImageCapture;
  if (typeof ImageCaptureImpl !== "function") return null;
  try {
    const bitmap = await new ImageCaptureImpl(track).grabFrame();
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    return null;
  }
}

async function grabWithVideoElement(stream: MediaStream): Promise<GrabbedFrame> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  const release = () => {
    video.pause();
    video.srcObject = null;
  };
  try {
    if (video.readyState < 2 || video.videoWidth === 0) {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener("loadeddata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error("Video element failed to load the stream")), { once: true });
        void video.play().catch(reject);
      });
    }
    const withFrameCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };
    if (typeof withFrameCallback.requestVideoFrameCallback === "function") {
      await new Promise<void>((resolve) => {
        const fallback = setTimeout(resolve, 200);
        withFrameCallback.requestVideoFrameCallback?.(() => {
          clearTimeout(fallback);
          resolve();
        });
      });
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) throw new Error("The captured stream has no video frames");
    return { source: video, width: video.videoWidth, height: video.videoHeight, release };
  } catch (error) {
    release();
    throw error;
  }
}

/** Grabs one frame: ImageCapture when available, otherwise a <video> element. */
export async function grabVideoFrame(track: MediaStreamTrack, stream: MediaStream): Promise<GrabbedFrame> {
  return (await grabWithImageCapture(track)) ?? (await grabWithVideoElement(stream));
}

/**
 * Captures real pixels via the Screen Capture API (requires a user gesture and permission prompt).
 * Unlike DOM rasterisation this includes cross-origin iframes, canvases and video as displayed.
 */
export class DisplayMediaScreenshotCapturer implements ScreenshotCapturer {
  readonly id = "display-media";
  private readonly config: DisplayMediaScreenshotCapturerOptions;

  constructor(options: DisplayMediaScreenshotCapturerOptions = {}) {
    this.config = options;
  }

  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof navigator !== "undefined" &&
      window.isSecureContext === true &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function"
    );
  }

  async capture(options: CaptureOptions = {}): Promise<CapturedScreenshot> {
    const { signal } = options;
    throwIfAborted(signal);
    if (!this.isSupported()) {
      throw new CaptureError("unsupported", "Screen capture (getDisplayMedia) is not available in this browser or context.");
    }

    let stream: MediaStream | undefined;
    let restoreExcluded: (() => void) | undefined;
    let frame: GrabbedFrame | undefined;
    try {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia(DISPLAY_MEDIA_OPTIONS);
      } catch (error) {
        throw toDisplayMediaError(error);
      }
      if (signal?.aborted) throw abortError(signal);

      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === "ended") {
        throw new CaptureError("failed", "The screen capture stream contains no video track.");
      }

      restoreExcluded = hideExcludedElements(document.documentElement, options.exclude);
      await waitForAnimationFrames(2, signal);
      await delay(this.config.settleDelayMs ?? 150, signal);

      const viewport: Size = { width: window.innerWidth, height: window.innerHeight };
      const scroll = { x: window.scrollX || 0, y: window.scrollY || 0 };
      const capturedAt = new Date().toISOString();

      const activeStream = stream;
      frame = await raceCapture(
        grabVideoFrame(track, activeStream),
        signal,
        this.config.frameTimeoutMs ?? 5_000,
        "Grabbing a screen frame",
      );
      restoreExcluded();
      restoreExcluded = undefined;

      const t = captureTranslator({
        messages: options.messages ?? this.config.messages,
        locale: options.locale ?? this.config.locale,
      });
      const warnings: CaptureWarning[] = [];
      const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
      const isTab = surface === undefined || surface === "browser";
      if (!isTab) {
        warnings.push({
          code: "unknown",
          message: surface === "monitor" ? t("warning.sharedScreen") : t("warning.sharedWindow"),
        });
      }

      const cssWidth = isTab && viewport.width > 0 ? viewport.width : frame.width / (window.devicePixelRatio || 1);
      const cssHeight = isTab && viewport.height > 0 ? viewport.height : frame.height / (window.devicePixelRatio || 1);
      const sizing = computeCaptureScale({
        width: cssWidth,
        height: cssHeight,
        devicePixelRatio: frame.width / cssWidth,
        maxScale: options.maxScale,
        maxPixels: options.maxPixels,
      });
      if (sizing.downscaled) {
        warnings.push({ code: "downscaled", message: t("warning.downscaled") });
      }

      const canvas = document.createElement("canvas");
      canvas.width = sizing.width;
      canvas.height = sizing.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new CaptureError("failed", "A 2D canvas is not available to encode the screenshot.");
      ctx.drawImage(frame.source, 0, 0, sizing.width, sizing.height);
      const blob = await canvasToPngBlob(canvas);

      return {
        blob,
        width: sizing.width,
        height: sizing.height,
        scale: sizing.width / cssWidth,
        viewport: isTab ? viewport : { width: cssWidth, height: cssHeight },
        scroll,
        method: "display-media",
        warnings,
        capturedAt,
      };
    } catch (error) {
      if (isCaptureError(error)) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new CaptureError("failed", `Screen capture failed: ${reason}`, { cause: error });
    } finally {
      restoreExcluded?.();
      frame?.release();
      stream?.getTracks().forEach((t) => t.stop());
    }
  }
}
