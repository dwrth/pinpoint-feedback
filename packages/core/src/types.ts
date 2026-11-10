import type { BuiltinCategoryId } from "./categories";
import type { CaptureMessages } from "./i18n/capture";

/** Ids of the built-in categories. Custom categories are configured via `defineCategories`. */
export const FEEDBACK_CATEGORIES = ["bug", "design", "content", "feature", "other"] as const satisfies readonly BuiltinCategoryId[];
export type FeedbackCategory = BuiltinCategoryId;

export const FEEDBACK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* Annotations                                                         */
/* All coordinates are in the ORIGINAL screenshot's pixel space         */
/* (0..CapturedScreenshot.width, 0..CapturedScreenshot.height),         */
/* independent of zoom, pan or the size of the editor on screen.        */
/* ------------------------------------------------------------------ */

export const ANNOTATION_TOOLS = ["select", "pin", "freehand", "arrow", "rectangle", "text"] as const;
export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];
export type DrawingAnnotationType = Exclude<AnnotationTool, "select">;

interface AnnotationBase {
  id: string;
  color: string;
  /** Stroke width in screenshot pixels. */
  strokeWidth: number;
}

export interface PinAnnotation extends AnnotationBase {
  type: "pin";
  at: Point;
  /** 1-based, sequential in creation order. Renumbered when pins are removed. */
  number: number;
  /** Optional note attached to the pin. */
  note?: string;
}

export interface FreehandAnnotation extends AnnotationBase {
  type: "freehand";
  points: Point[];
}

export interface ArrowAnnotation extends AnnotationBase {
  type: "arrow";
  from: Point;
  to: Point;
}

export interface RectangleAnnotation extends AnnotationBase {
  type: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextAnnotation extends AnnotationBase {
  type: "text";
  at: Point;
  text: string;
  /** Font size in screenshot pixels. */
  fontSize: number;
}

export type Annotation =
  | PinAnnotation
  | FreehandAnnotation
  | ArrowAnnotation
  | RectangleAnnotation
  | TextAnnotation;

/* ------------------------------------------------------------------ */
/* Screenshot capture                                                  */
/* ------------------------------------------------------------------ */

export type CaptureMethod = "dom" | "display-media";

export type CaptureWarningCode =
  | "cross-origin-iframe"
  | "cross-origin-image"
  | "tainted-canvas"
  | "blank-canvas"
  | "video"
  | "font"
  | "downscaled"
  | "unknown";

/**
 * Describes content that could NOT be faithfully captured.
 * Capturers must report these rather than silently omitting content.
 */
export interface CaptureWarning {
  code: CaptureWarningCode;
  message: string;
  count?: number;
}

export interface CapturedScreenshot {
  /** Encoded image (PNG unless stated otherwise). */
  blob: Blob;
  /** Pixel dimensions of `blob`. Annotation coordinates are relative to these. */
  width: number;
  height: number;
  /** Ratio of screenshot pixels to CSS pixels. */
  scale: number;
  /** CSS viewport size at capture time. */
  viewport: Size;
  /** Scroll offset (CSS px) at capture time. */
  scroll: Point;
  method: CaptureMethod;
  warnings: CaptureWarning[];
  capturedAt: string;
}

export interface CaptureOptions {
  /** Elements for which this returns true are excluded from the capture (e.g. the widget itself). */
  exclude?: (element: Element) => boolean;
  /** Upper bound for screenshot pixel ratio. Defaults to min(devicePixelRatio, 2). */
  maxScale?: number;
  /** Upper bound on width*height in screenshot pixels; the capture is downscaled to fit. */
  maxPixels?: number;
  signal?: AbortSignal;
  /** Texts for placeholders drawn into the screenshot and for warnings. Overrides the capturer's own. */
  messages?: CaptureMessages;
  /** BCP 47 tag for plural rules and number formatting in capture texts. */
  locale?: string;
}

/* ------------------------------------------------------------------ */
/* Metadata                                                            */
/* ------------------------------------------------------------------ */

export interface NameVersion {
  name: string;
  version?: string;
}

export interface BrowserMetadata {
  url: string;
  pageTitle: string;
  referrer?: string;
  userAgent: string;
  browser: NameVersion;
  os: NameVersion;
  viewport: Size;
  screen: Size;
  devicePixelRatio: number;
  language?: string;
  timezone?: string;
}

/* ------------------------------------------------------------------ */
/* Submission (wire format between browser and server)                 */
/* ------------------------------------------------------------------ */

export interface Reporter {
  name?: string;
  email?: string;
}

export interface CaptureSummary {
  method: CaptureMethod;
  width: number;
  height: number;
  warnings: CaptureWarning[];
}

/**
 * JSON part of a submission. Sent as the `payload` field of a multipart/form-data
 * request alongside the optional `screenshot` and `annotatedScreenshot` file fields.
 */
export interface FeedbackSubmission {
  /** Client-generated UUID; used as idempotency key. */
  submissionId: string;
  title: string;
  description: string;
  /** Category id; must be one of the categories configured on the server handler. */
  category: string;
  priority: FeedbackPriority;
  reporter?: Reporter;
  metadata: BrowserMetadata;
  annotations: Annotation[];
  capture?: CaptureSummary;
  projectId?: string;
  /** ISO timestamp of when the user submitted (first attempt). */
  createdAt: string;
  /** Epoch ms when the widget was opened; used for basic bot detection. */
  openedAt?: number;
  /** Honeypot field; must be empty. */
  website?: string;
}

export interface SubmissionFiles {
  screenshot?: Blob;
  annotatedScreenshot?: Blob;
}

export type SubmissionErrorCode =
  | "network"
  | "timeout"
  | "validation"
  | "rate_limited"
  | "payload_too_large"
  | "unsupported_media_type"
  | "spam"
  | "notion_unauthorized"
  | "notion_not_found"
  | "notion_error"
  | "server_error"
  | "misconfigured";

export interface SubmissionSuccess {
  ok: true;
  submissionId: string;
  pageId: string;
  pageUrl?: string;
  /** True when the server recognised this submissionId as already created. */
  duplicate: boolean;
}

export interface SubmissionFailure {
  ok: false;
  submissionId?: string;
  error: {
    code: SubmissionErrorCode;
    message: string;
    retryable: boolean;
    /** Seconds the client should wait before retrying, if known. */
    retryAfter?: number;
    details?: unknown;
  };
}

export type SubmissionResult = SubmissionSuccess | SubmissionFailure;
