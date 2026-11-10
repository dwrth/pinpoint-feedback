import type { Size } from "../types";

export interface EncodeRequest {
  type: string;
  quality: number;
  width: number;
  height: number;
}

/** Encodes the source image at the requested size/format. Resolves null if encoding failed. */
export type ImageEncodeFn = (request: EncodeRequest) => Promise<Blob | null>;

export interface EncodingSearchOptions {
  /** Formats to try, in order of preference. Default webp, then jpeg. */
  types?: readonly string[];
  /** Qualities tried at full resolution, highest first. */
  qualities?: readonly number[];
  /** Quality used while downscaling. */
  downscaleQuality?: number;
  /** Give up once the longer side would drop below this many pixels. Default 64. */
  minDimension?: number;
  /** Max downscale iterations. Default 12. */
  maxScaleSteps?: number;
}

export interface EncodingSearchResult {
  blob: Blob;
  type: string;
  quality: number;
  width: number;
  height: number;
  scale: number;
}

const DEFAULT_TYPES = ["image/webp", "image/jpeg"] as const;
const DEFAULT_QUALITIES = [0.92, 0.85, 0.75, 0.6, 0.45] as const;

export class ImageTooLargeError extends Error {
  constructor(maxBytes: number, reason?: string) {
    super(`Image could not be reduced to ${maxBytes} bytes${reason ? `: ${reason}` : ""}`);
    this.name = "ImageTooLargeError";
  }
}

/**
 * Pure search for an encoding that fits `maxBytes`: first lower quality at full size for each
 * format (a format whose encoder returns a different MIME type is treated as unsupported), then
 * progressively smaller dimensions with the most compact format.
 */
export async function searchImageEncoding(
  source: Size,
  maxBytes: number,
  encode: ImageEncodeFn,
  options: EncodingSearchOptions = {},
): Promise<EncodingSearchResult> {
  const types = options.types ?? DEFAULT_TYPES;
  const qualities = options.qualities ?? DEFAULT_QUALITIES;
  const downscaleQuality = options.downscaleQuality ?? 0.75;
  const minDimension = options.minDimension ?? 64;
  const maxSteps = options.maxScaleSteps ?? 12;
  const { width, height } = source;

  let best: { type: string; size: number } | undefined;
  for (const type of types) {
    let downscaleSize: number | undefined;
    let smallest = Number.POSITIVE_INFINITY;
    for (const quality of qualities) {
      const blob = await encode({ type, quality, width, height });
      if (!blob || (blob.type && blob.type !== type)) break;
      if (blob.size <= maxBytes) return { blob, type, quality, width, height, scale: 1 };
      smallest = Math.min(smallest, blob.size);
      if (quality <= downscaleQuality && downscaleSize === undefined) downscaleSize = blob.size;
    }
    if (smallest === Number.POSITIVE_INFINITY) continue;
    const size = downscaleSize ?? smallest;
    if (!best || size < best.size) best = { type, size };
  }
  if (!best) throw new ImageTooLargeError(maxBytes, "no supported image encoder");

  let scale = 1;
  let lastSize = best.size;
  for (let step = 0; step < maxSteps; step++) {
    const factor = Math.min(0.9, Math.max(0.5, Math.sqrt(maxBytes / lastSize) * 0.95));
    scale *= factor;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    if (Math.max(w, h) < minDimension) break;
    const blob = await encode({ type: best.type, quality: downscaleQuality, width: w, height: h });
    if (!blob) break;
    if (blob.size <= maxBytes) {
      return { blob, type: best.type, quality: downscaleQuality, width: w, height: h, scale };
    }
    lastSize = blob.size;
  }
  throw new ImageTooLargeError(maxBytes);
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }
  if (typeof Image === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("No image decoder available in this environment");
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasEncoder(source: CanvasImageSource): ImageEncodeFn {
  return async ({ type, quality, width, height }) => {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      draw(ctx, source, type, width, height);
      return canvas.convertToBlob({ type, quality });
    }
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    draw(ctx, source, type, width, height);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  };
}

function draw(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  type: string,
  width: number,
  height: number,
): void {
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
}

export interface FitImageResult {
  blob: Blob;
  /** True when pixel dimensions were reduced. */
  downscaled: boolean;
  /** True when the returned blob differs from the input. */
  reencoded: boolean;
}

/**
 * Returns `blob` unchanged if it fits, otherwise re-encodes (webp, then jpeg, decreasing quality)
 * and downscales as needed. The result is never larger than `maxBytes`; throws
 * `ImageTooLargeError` when no acceptable encoding exists.
 */
export async function fitImageToSize(
  blob: Blob,
  maxBytes: number,
  options: EncodingSearchOptions & { encoder?: (source: CanvasImageSource) => ImageEncodeFn } = {},
): Promise<FitImageResult> {
  if (blob.size <= maxBytes) return { blob, downscaled: false, reencoded: false };
  if (!(maxBytes > 0)) throw new ImageTooLargeError(maxBytes, "limit must be positive");

  let decoded: DecodedImage;
  try {
    decoded = await decodeImage(blob);
  } catch (err) {
    throw new ImageTooLargeError(maxBytes, `image could not be decoded (${err instanceof Error ? err.message : String(err)})`);
  }
  try {
    const encode = (options.encoder ?? canvasEncoder)(decoded.source);
    const result = await searchImageEncoding({ width: decoded.width, height: decoded.height }, maxBytes, encode, options);
    if (result.blob.size > maxBytes) throw new ImageTooLargeError(maxBytes);
    return { blob: result.blob, downscaled: result.scale < 1, reencoded: true };
  } finally {
    decoded.release();
  }
}
