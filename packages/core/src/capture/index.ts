import type { ScreenshotCapturer } from "../interfaces";
import { DomScreenshotCapturer } from "./dom-capturer";

export { CaptureError, isCaptureError, type CaptureErrorCode } from "./errors";
export {
  PINPOINT_IGNORE_ATTRIBUTE,
  isExcludedElement,
  createCaptureFilter,
  collectExcludedElements,
  hideExcludedElements,
  type ExcludePredicate,
} from "./exclusion";
export { computeCaptureScale, DEFAULT_MAX_SCALE, type CaptureScaleInput, type CaptureScaleResult } from "./scale";
export {
  scanCaptureLimitations,
  isCanvasTainted,
  getAccessibleFrameDocument,
  type CaptureLimitations,
  type ScannedImage,
  type ScanOptions,
} from "./limitations";
export { PLACEHOLDER_IMAGE_DATA_URL, PLACEHOLDER_LABELS, PLACEHOLDER_ATTRIBUTE, type PlaceholderKind } from "./placeholder";
export {
  formatCaptureWarning,
  captureTranslator,
  type CaptureLocaleOptions,
  type CaptureTranslate,
} from "./messages";
export {
  DomScreenshotCapturer,
  CAPTURE_MARK_ATTRIBUTE,
  buildDomWarnings,
  type DomScreenshotCapturerOptions,
} from "./dom-capturer";
export {
  DisplayMediaScreenshotCapturer,
  toDisplayMediaError,
  type DisplayMediaScreenshotCapturerOptions,
} from "./display-media-capturer";

export function createDefaultCapturer(): ScreenshotCapturer {
  return new DomScreenshotCapturer();
}
