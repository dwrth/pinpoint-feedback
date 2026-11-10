import type { FeedbackTransport } from "../interfaces";
import { FORM_FIELDS } from "../limits";
import type {
  FeedbackSubmission,
  SubmissionErrorCode,
  SubmissionFailure,
  SubmissionFiles,
  SubmissionResult,
} from "../types";

export interface HttpFeedbackTransportOptions {
  endpoint: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  /** Per-request timeout in ms, covering the response body as well. Default 60000; 0 disables. */
  timeoutMs?: number;
  credentials?: RequestCredentials;
}

const ERROR_CODES: ReadonlySet<string> = new Set<SubmissionErrorCode>([
  "network",
  "timeout",
  "validation",
  "rate_limited",
  "payload_too_large",
  "unsupported_media_type",
  "spam",
  "notion_unauthorized",
  "notion_not_found",
  "notion_error",
  "server_error",
  "misconfigured",
]);

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function fileExtensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType.split(";")[0]!.trim().toLowerCase()] ?? "png";
}

export function failure(
  submissionId: string | undefined,
  code: SubmissionErrorCode,
  message: string,
  retryable: boolean,
  extra: { retryAfter?: number; details?: unknown } = {},
): SubmissionFailure {
  const error: SubmissionFailure["error"] = { code, message, retryable };
  if (extra.retryAfter !== undefined) error.retryAfter = extra.retryAfter;
  if (extra.details !== undefined) error.details = extra.details;
  return submissionId === undefined ? { ok: false, error } : { ok: false, submissionId, error };
}

/** Result returned when the caller's AbortSignal fires: non-retryable, `details.aborted === true`. */
export function abortedFailure(submissionId: string | undefined): SubmissionFailure {
  return failure(submissionId, "network", "Submission aborted", false, { details: { aborted: true } });
}

export function isAbortFailure(result: SubmissionResult): boolean {
  if (result.ok) return false;
  const d = result.error.details;
  return typeof d === "object" && d !== null && (d as { aborted?: unknown }).aborted === true;
}

export function buildFormData(submission: FeedbackSubmission, files: SubmissionFiles): FormData {
  const form = new FormData();
  form.append(FORM_FIELDS.payload, JSON.stringify(submission));
  const id = submission.submissionId;
  if (files.screenshot) {
    appendFile(form, FORM_FIELDS.screenshot, files.screenshot, `screenshot-${id}.${fileExtensionFor(files.screenshot.type)}`);
  }
  if (files.annotatedScreenshot) {
    const ext = fileExtensionFor(files.annotatedScreenshot.type);
    appendFile(form, FORM_FIELDS.annotatedScreenshot, files.annotatedScreenshot, `annotated-screenshot-${id}.${ext}`);
  }
  return form;
}

function appendFile(form: FormData, field: string, blob: Blob, filename: string): void {
  if (typeof File === "function" && !(blob instanceof File && blob.name === filename)) {
    form.append(field, new File([blob], filename, { type: blob.type }), filename);
  } else {
    form.append(field, blob, filename);
  }
}

/** Parses a Retry-After header (delta-seconds or HTTP date) into seconds. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.max(0, Math.ceil(Number(trimmed)));
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

function defaultForStatus(status: number): { code: SubmissionErrorCode; retryable: boolean } {
  if (status >= 200 && status < 300) return { code: "server_error", retryable: true };
  switch (status) {
    case 408:
      return { code: "timeout", retryable: true };
    case 409:
      // Another request with the same idempotency key is still being processed.
      return { code: "server_error", retryable: true };
    case 413:
      return { code: "payload_too_large", retryable: false };
    case 415:
      return { code: "unsupported_media_type", retryable: false };
    case 429:
      return { code: "rate_limited", retryable: true };
    case 401:
    case 403:
    case 404:
    case 405:
      return { code: "misconfigured", retryable: false };
  }
  if (status >= 400 && status < 500) return { code: "validation", retryable: false };
  return { code: "server_error", retryable: true };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Maps an HTTP response (status, headers, raw body) to a SubmissionResult. */
export function interpretResponse(
  submissionId: string,
  status: number,
  headers: Pick<Headers, "get">,
  bodyText: string,
): SubmissionResult {
  let body: unknown;
  try {
    body = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    body = undefined;
  }
  const ok2xx = status >= 200 && status < 300;
  const headerRetryAfter = parseRetryAfter(headers.get("retry-after"));

  if (ok2xx && isObj(body) && body.ok === true && typeof body.pageId === "string") {
    return {
      ok: true,
      submissionId: typeof body.submissionId === "string" ? body.submissionId : submissionId,
      pageId: body.pageId,
      ...(typeof body.pageUrl === "string" ? { pageUrl: body.pageUrl } : {}),
      duplicate: body.duplicate === true,
    };
  }

  const fallback = defaultForStatus(status);
  const err = isObj(body) && isObj(body.error) ? body.error : undefined;
  const code = err && typeof err.code === "string" && ERROR_CODES.has(err.code) ? (err.code as SubmissionErrorCode) : fallback.code;
  const retryable = err && typeof err.retryable === "boolean" ? err.retryable : fallback.retryable;

  let message: string | undefined;
  if (err && typeof err.message === "string") message = err.message;
  else if (isObj(body) && typeof body.message === "string") message = body.message;
  else if (body === undefined && bodyText.trim() && !/^\s*</.test(bodyText)) message = bodyText.trim().slice(0, 200);
  if (!message) message = ok2xx ? "Unexpected response from server" : `Request failed with HTTP ${status}`;

  const bodyRetryAfter = err && typeof err.retryAfter === "number" && Number.isFinite(err.retryAfter) ? err.retryAfter : undefined;
  return failure(submissionId, code, message, retryable, {
    retryAfter: bodyRetryAfter ?? headerRetryAfter,
    details: err?.details,
  });
}

/**
 * Multipart POST transport. Never throws.
 * - network error → `network` (retryable); timeout → `timeout` (retryable)
 * - caller abort → `network`, non-retryable, `details.aborted === true` (see `isAbortFailure`)
 */
export class HttpFeedbackTransport implements FeedbackTransport {
  constructor(private readonly options: HttpFeedbackTransportOptions) {}

  async submit(
    submission: FeedbackSubmission,
    files: SubmissionFiles,
    options: { signal?: AbortSignal } = {},
  ): Promise<SubmissionResult> {
    const id = submission.submissionId;
    const external = options.signal;
    if (external?.aborted) return abortedFailure(id);

    const fetchImpl = this.options.fetch ?? (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);
    if (!fetchImpl) return failure(id, "misconfigured", "fetch is not available in this environment", false);

    let body: FormData;
    try {
      body = buildFormData(submission, files);
    } catch (err) {
      return failure(id, "validation", `Could not encode submission: ${errorMessage(err)}`, false);
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    for (const [k, v] of Object.entries(this.options.headers ?? {})) {
      if (k.toLowerCase() !== "content-type") headers[k] = v;
    }
    headers["Idempotency-Key"] = id;

    const timeoutMs = this.options.timeoutMs ?? 60_000;
    const controller = new AbortController();
    let timedOut = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;
    const onAbort = () => controller.abort();
    external?.addEventListener("abort", onAbort, { once: true });

    try {
      const init: RequestInit = { method: "POST", body, headers, signal: controller.signal };
      if (this.options.credentials) init.credentials = this.options.credentials;
      const response = await fetchImpl(this.options.endpoint, init);
      const text = await response.text();
      return interpretResponse(id, response.status, response.headers, text);
    } catch (err) {
      if (timedOut) return failure(id, "timeout", `Request timed out after ${timeoutMs} ms`, true);
      if (external?.aborted) return abortedFailure(id);
      return failure(id, "network", `Network error: ${errorMessage(err)}`, true);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    }
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return typeof err === "string" ? err : "Unknown error";
}
