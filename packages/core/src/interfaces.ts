import type {
  Annotation,
  AnnotationTool,
  BrowserMetadata,
  CaptureOptions,
  CapturedScreenshot,
  FeedbackSubmission,
  SubmissionFiles,
  SubmissionResult,
  Size,
} from "./types";

/** Captures the current page. Implementations: DOM rasterisation, getDisplayMedia, test fakes. */
export interface ScreenshotCapturer {
  readonly id: string;
  isSupported(): boolean;
  capture(options?: CaptureOptions): Promise<CapturedScreenshot>;
}

export interface MetadataCollector {
  collect(): BrowserMetadata;
}

/** Minimal subset of CanvasRenderingContext2D used by renderers (lets tests pass a fake). */
export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface AnnotationRenderOptions {
  /** Multiplier from screenshot pixels to target canvas pixels. Default 1. */
  scale?: number;
  /** Annotation id to draw with a selection outline. */
  selectedId?: string;
  /** Screenshot size in pixels; lets renderers size pins and text relative to the image. */
  imageSize?: Size;
}

/** Draws annotations onto a 2D canvas context. */
export interface AnnotationRenderer {
  render(ctx: Canvas2D, annotations: readonly Annotation[], options?: AnnotationRenderOptions): void;
}

/** Sends a submission to a backend. Default implementation: HTTP multipart POST. */
export interface FeedbackTransport {
  submit(
    submission: FeedbackSubmission,
    files: SubmissionFiles,
    options?: { signal?: AbortSignal },
  ): Promise<SubmissionResult>;
}

export interface OutboxEntry {
  submission: FeedbackSubmission;
  files: SubmissionFiles;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: number;
  /** Epoch ms after which a retry may be attempted. */
  nextAttemptAt?: number;
}

/**
 * Client-side durable queue for submissions not yet confirmed by the server.
 * Default implementation: IndexedDB, with in-memory fallback.
 */
export interface FeedbackOutbox {
  put(entry: OutboxEntry): Promise<void>;
  get(submissionId: string): Promise<OutboxEntry | undefined>;
  list(): Promise<OutboxEntry[]>;
  remove(submissionId: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Annotation editor (framework-independent, DOM + canvas)             */
/* ------------------------------------------------------------------ */

export interface AnnotationEditorState {
  tool: AnnotationTool;
  color: string;
  strokeWidth: number;
  /** Current zoom where 1 = screenshot pixel : CSS pixel. */
  zoom: number;
  /** Zoom at which the screenshot exactly fits the container. */
  fitZoom: number;
  canUndo: boolean;
  canRedo: boolean;
  annotationCount: number;
  selectedId?: string;
  /** True while a text annotation is being typed. */
  editingText: boolean;
}

export interface AnnotationEditorOptions {
  /** Element the editor mounts into. It will be filled (100% width/height). */
  container: HTMLElement;
  /** The original screenshot. Never modified. */
  image: Blob | HTMLImageElement | ImageBitmap | HTMLCanvasElement;
  initialAnnotations?: Annotation[];
  tool?: AnnotationTool;
  color?: string;
  strokeWidth?: number;
  minZoom?: number;
  maxZoom?: number;
  renderer?: AnnotationRenderer;
  onChange?: (annotations: Annotation[]) => void;
  onStateChange?: (state: AnnotationEditorState) => void;
}

export interface AnnotationEditor {
  /** Resolves once the image is decoded and the first frame is drawn. */
  readonly ready: Promise<void>;
  getState(): AnnotationEditorState;
  subscribe(listener: (state: AnnotationEditorState) => void): () => void;

  setTool(tool: AnnotationTool): void;
  setColor(color: string): void;
  setStrokeWidth(width: number): void;

  getAnnotations(): Annotation[];
  setAnnotations(annotations: Annotation[]): void;
  deleteSelected(): void;

  undo(): void;
  redo(): void;
  /** Removes all annotations (undoable). */
  clear(): void;
  /** Removes all annotations, clears history and resets zoom/pan: back to the original screenshot. */
  reset(): void;

  zoomIn(): void;
  zoomOut(): void;
  /** Sets zoom, keeping `anchor` (container CSS px) fixed. */
  setZoom(zoom: number, anchor?: { x: number; y: number }): void;
  /** Fit screenshot to container and center it. */
  fitToView(): void;

  /** Original screenshot with annotations burned in, at full screenshot resolution. */
  exportAnnotated(type?: "image/png" | "image/jpeg" | "image/webp", quality?: number): Promise<Blob>;
  /** Re-measure container (call after layout changes; also handled via ResizeObserver). */
  resize(): void;
  destroy(): void;
}

/* ------------------------------------------------------------------ */
/* Server-side contracts (implemented in @pinpoint-feedback/server)    */
/* ------------------------------------------------------------------ */

export interface UploadableFile {
  data: Blob;
  filename: string;
  contentType: string;
}

export interface UploadedFile {
  /** Backend-specific reference (Notion: file_upload id). */
  id: string;
  filename: string;
}

export interface FileUploader {
  upload(file: UploadableFile): Promise<UploadedFile>;
}

export interface FeedbackRecordInput {
  submission: FeedbackSubmission;
  screenshot?: UploadableFile;
  annotatedScreenshot?: UploadableFile;
}

export interface FeedbackRecord {
  id: string;
  url?: string;
  duplicate: boolean;
}

/** Persists a validated submission (Notion is the reference backend). */
export interface FeedbackBackend {
  createRecord(input: FeedbackRecordInput): Promise<FeedbackRecord>;
  /** Looks up an existing record by submissionId for idempotency. */
  findBySubmissionId?(submissionId: string): Promise<FeedbackRecord | undefined>;
}

/* ------------------------------------------------------------------ */
/* Client (implemented in core/src/client)                             */
/* ------------------------------------------------------------------ */

export type SubmitPhase = "preparing" | "queued" | "sending" | "retrying" | "done" | "failed";

export interface SubmitProgress {
  phase: SubmitPhase;
  attempt: number;
  maxAttempts: number;
  /** Present while waiting before the next retry. */
  retryInMs?: number;
  error?: string;
}

export interface FeedbackClientOptions {
  /** URL of the server handler, e.g. "/api/feedback". */
  endpoint: string;
  transport?: FeedbackTransport;
  outbox?: FeedbackOutbox;
  /** Attempts per submit() call for retryable errors. Default 3. */
  maxAttempts?: number;
  /** Per-request timeout in ms. Default 60000. */
  timeoutMs?: number;
  /** Max bytes per screenshot; larger images are re-encoded/downscaled. */
  maxFileBytes?: number;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export interface FeedbackClient {
  /**
   * Persists the submission to the outbox, then sends it with retry/backoff.
   * The outbox entry is removed only after the server confirms creation.
   * Resolves with the final result (never throws for transport errors).
   */
  submit(
    submission: FeedbackSubmission,
    files: SubmissionFiles,
    options?: { signal?: AbortSignal; onProgress?: (p: SubmitProgress) => void },
  ): Promise<SubmissionResult>;
  /** Re-sends everything left in the outbox (e.g. after a reload or coming back online). */
  retryPending(options?: { signal?: AbortSignal; force?: boolean }): Promise<SubmissionResult[]>;
  pending(): Promise<OutboxEntry[]>;
  discard(submissionId: string): Promise<void>;
}
