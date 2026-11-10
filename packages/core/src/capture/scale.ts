export interface CaptureScaleInput {
  /** Area to capture in CSS px. */
  width: number;
  height: number;
  devicePixelRatio?: number;
  maxScale?: number;
  maxPixels?: number;
}

export interface CaptureScaleResult {
  scale: number;
  /** Output size in screenshot pixels: floor(css size * scale), at least 1. */
  width: number;
  height: number;
  /** True when `maxPixels` forced a scale below min(devicePixelRatio, maxScale). */
  downscaled: boolean;
}

export const DEFAULT_MAX_SCALE = 2;

const positive = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** scale = min(devicePixelRatio, maxScale ?? 2), further reduced so width*height fits `maxPixels`. */
export function computeCaptureScale(input: CaptureScaleInput): CaptureScaleResult {
  const cssWidth = Math.max(0, input.width);
  const cssHeight = Math.max(0, input.height);
  const dpr = positive(input.devicePixelRatio) ? input.devicePixelRatio : 1;
  const maxScale = positive(input.maxScale) ? input.maxScale : DEFAULT_MAX_SCALE;

  let scale = Math.min(dpr, maxScale);
  let downscaled = false;

  if (positive(input.maxPixels) && cssWidth > 0 && cssHeight > 0) {
    const fit = Math.sqrt(input.maxPixels / (cssWidth * cssHeight));
    if (fit < scale) {
      scale = fit;
      downscaled = true;
    }
  }

  return {
    scale,
    width: Math.max(1, Math.floor(cssWidth * scale)),
    height: Math.max(1, Math.floor(cssHeight * scale)),
    downscaled,
  };
}
