import {
  ALLOWED_IMAGE_TYPES,
  FORM_FIELDS,
  LIMITS,
  resolveCategories,
  validateSubmission,
  type CategoryList,
  type FeedbackBackend,
  type FeedbackRecord,
  type FeedbackSubmission,
  type SubmissionErrorCode,
  type SubmissionResult,
  type UploadableFile,
} from "@pinpoint-feedback/core";
import { resolveNotionConfigFromEnv } from "./env";
import { PinpointServerError } from "./errors";
import { TtlLruCache } from "./lru";
import { extensionFor, sniffImageType } from "./magic";
import { NotionFeedbackBackend, type NotionBackendOptions } from "./notion/backend";
import { MemoryRateLimiter, type RateLimitOptions } from "./rate-limit";

export type HandlerLogger = Pick<Console, "info" | "warn" | "error">;

export interface FeedbackHandlerOptions {
  /** Custom persistence. Either this or `notion` is required; when both are absent, Notion is configured from env. */
  backend?: FeedbackBackend;
  notion?: NotionBackendOptions;
  /**
   * Accepted feedback categories; must match the widget's `categories`. Default: the built-in categories.
   * Also used by the Notion backend unless `notion.categories` is set. Invalid lists throw a
   * CategoryConfigError when the handler is created.
   */
  categories?: CategoryList;
  /** Overrides the projectId sent by the client. */
  projectId?: string;
  /** Cross-origin callers allowed to submit. Default: same-origin only. */
  allowedOrigins?: string[] | "*";
  /** Per-client-IP limit. Default 10 submissions / 10 minutes. `false` disables it. */
  rateLimit?: RateLimitOptions | false;
  /** Max bytes per screenshot. Default LIMITS.fileMaxBytes. */
  maxFileBytes?: number;
  /** Submissions sooner than this after the widget opened are rejected as spam. Default LIMITS.minFillTimeMs; 0 disables. */
  minFillTimeMs?: number;
  /**
   * Trust X-Forwarded-For / X-Real-IP / X-Forwarded-Host. Default true, which suits platforms that set
   * these headers (Vercel, Netlify, Cloudflare, most reverse proxies). Set false when the app is exposed directly.
   */
  trustProxy?: boolean;
  getClientIp?(request: Request): string | undefined;
  /** Called after a record is created (not for duplicates). Errors are logged, never surfaced. */
  onSubmission?(submission: FeedbackSubmission, record: FeedbackRecord): void | Promise<void>;
  logger?: HandlerLogger;
}

export type FeedbackRequestHandler = (request: Request) => Promise<Response>;

const STATUS_BY_CODE: Record<SubmissionErrorCode, number> = {
  network: 502,
  timeout: 504,
  validation: 400,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  spam: 400,
  notion_unauthorized: 502,
  notion_not_found: 502,
  notion_error: 502,
  server_error: 500,
  misconfigured: 500,
};

const MULTIPART_SLACK_BYTES = 64 * 1024;
const FUTURE_TOLERANCE_MS = 60_000;

function fail(
  code: SubmissionErrorCode,
  message: string,
  opts: { retryable?: boolean; retryAfter?: number; details?: unknown; status?: number; submissionId?: string } = {},
): PinpointServerError {
  return new PinpointServerError({
    code,
    message,
    status: opts.status ?? STATUS_BY_CODE[code],
    retryable: opts.retryable ?? false,
    retryAfter: opts.retryAfter,
    details: opts.details,
  });
}

function json(body: SubmissionResult, status: number, headers: Headers): Response {
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function originOf(value: string | null): string | undefined {
  if (!value || value === "null") return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

async function readBodyLimited(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const body = request.body;
  if (!body) return new Uint8Array(new ArrayBuffer(0));
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      reader.releaseLock();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Creates a Web-standard `(Request) => Promise<Response>` handler that validates feedback submissions
 * and stores them via the configured backend (Notion by default).
 */
export function createFeedbackRequestHandler(options: FeedbackHandlerOptions = {}): FeedbackRequestHandler {
  const logger = options.logger ?? console;
  const categories = resolveCategories(options.categories);
  const categoryIds = categories.map((c) => c.id);
  const notionCategories = options.notion?.categories ? resolveCategories(options.notion.categories) : categories;
  const maxFileBytes = options.maxFileBytes ?? LIMITS.fileMaxBytes;
  const minFillTimeMs = options.minFillTimeMs ?? LIMITS.minFillTimeMs;
  const trustProxy = options.trustProxy ?? true;
  const limiter = options.rateLimit === false ? undefined : new MemoryRateLimiter(options.rateLimit ?? {});
  const completed = new TtlLruCache<FeedbackRecord>(1000, 24 * 60 * 60 * 1000);
  const inFlight = new Map<string, Promise<FeedbackRecord>>();
  const allowed = options.allowedOrigins;
  const allowedSet = new Set(Array.isArray(allowed) ? allowed.map((o) => originOf(o) ?? o) : []);

  let backend: FeedbackBackend | undefined = options.backend;
  const getBackend = (): FeedbackBackend => {
    if (backend) return backend;
    if (options.notion) {
      backend = new NotionFeedbackBackend({ logger, ...options.notion, categories: notionCategories });
      return backend;
    }
    const env = resolveNotionConfigFromEnv();
    backend = new NotionFeedbackBackend({ ...env, logger, categories, projectId: options.projectId ?? env.projectId });
    return backend;
  };
  const checksDuplicatesItself = () => backend instanceof NotionFeedbackBackend;

  const isAllowedCrossOrigin = (origin: string) => allowed === "*" || allowedSet.has(origin);

  const isSameOrigin = (request: Request, origin: string): boolean => {
    const url = new URL(request.url);
    if (origin === url.origin) return true;
    const host = new URL(origin).host;
    if (host === request.headers.get("host")) return true;
    if (trustProxy) {
      const fwd = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
      if (fwd && host === fwd) return true;
    }
    return false;
  };

  const clientIp = (request: Request): string => {
    const custom = options.getClientIp?.(request);
    if (custom) return custom;
    if (trustProxy) {
      const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      if (xff) return xff;
      const real = request.headers.get("x-real-ip")?.trim();
      if (real) return real;
    }
    return "unknown";
  };

  const persist = async (
    submission: FeedbackSubmission,
    files: { screenshot?: UploadableFile; annotatedScreenshot?: UploadableFile },
  ): Promise<FeedbackRecord> => {
    const b = getBackend();
    if (!checksDuplicatesItself() && b.findBySubmissionId) {
      const found = await b.findBySubmissionId(submission.submissionId);
      if (found) return { ...found, duplicate: true };
    }
    return b.createRecord({ submission, ...files });
  };

  async function handle(request: Request, ctx: { submissionId?: string }): Promise<{ result: SubmissionResult; status: number }> {
    const ip = clientIp(request);
    if (limiter) {
      const decision = limiter.check(ip);
      if (!decision.allowed) {
        throw fail("rate_limited", "Too many feedback submissions. Please try again later.", {
          retryable: true,
          retryAfter: decision.retryAfter,
        });
      }
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(contentType) && contentType.toLowerCase() !== "multipart/form-data") {
      throw fail("unsupported_media_type", "Expected a multipart/form-data request.");
    }

    const maxBody = LIMITS.payloadMaxBytes + 2 * maxFileBytes + MULTIPART_SLACK_BYTES;
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBody) {
      throw fail("payload_too_large", "The submission is too large.");
    }
    const bytes = await readBodyLimited(request, maxBody);
    if (!bytes) throw fail("payload_too_large", "The submission is too large.");

    let form: FormData;
    try {
      form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
    } catch {
      throw fail("validation", "Malformed multipart body.");
    }

    const payloadField = form.get(FORM_FIELDS.payload);
    const payloadText = typeof payloadField === "string" ? payloadField : payloadField ? await payloadField.text() : undefined;
    if (payloadText === undefined) throw fail("validation", `Missing "${FORM_FIELDS.payload}" field.`);
    if (new TextEncoder().encode(payloadText).byteLength > LIMITS.payloadMaxBytes) {
      throw fail("payload_too_large", "The submission data is too large.");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(payloadText);
    } catch {
      throw fail("validation", "The submission data is not valid JSON.");
    }
    const validated = validateSubmission(raw, { categories: categoryIds });
    if (!validated.ok) {
      throw fail("validation", "The submission is invalid.", { details: { issues: validated.issues } });
    }
    const submission = validated.value;
    const submissionId = submission.submissionId;
    ctx.submissionId = submissionId;

    if (submission.website && submission.website.trim() !== "") {
      throw fail("spam", "The submission was rejected.");
    }
    if (submission.openedAt !== undefined) {
      const now = Date.now();
      if (submission.openedAt > now + FUTURE_TOLERANCE_MS) throw fail("spam", "The submission was rejected.");
      if (minFillTimeMs > 0 && now - submission.openedAt < minFillTimeMs) {
        throw fail("spam", "The submission was sent too quickly. Please try again.");
      }
    }

    const files: { screenshot?: UploadableFile; annotatedScreenshot?: UploadableFile } = {};
    for (const [field, suffix] of [
      [FORM_FIELDS.screenshot, "original"],
      [FORM_FIELDS.annotatedScreenshot, "annotated"],
    ] as const) {
      const value = form.get(field);
      if (value === null) continue;
      if (typeof value === "string") {
        if (value === "") continue;
        throw fail("validation", `"${field}" must be a file.`);
      }
      if (value.size === 0) throw fail("validation", `"${field}" is empty.`);
      if (value.size > maxFileBytes) {
        throw fail("payload_too_large", `"${field}" exceeds the ${Math.floor(maxFileBytes / 1024)} KB limit.`);
      }
      const declaredType = value.type.split(";")[0]?.trim().toLowerCase() ?? "";
      if (declaredType && declaredType !== "application/octet-stream" && !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(declaredType)) {
        throw fail("unsupported_media_type", `"${field}" must be a PNG, JPEG or WebP image.`);
      }
      const sniffed = await sniffImageType(value);
      if (!sniffed) throw fail("unsupported_media_type", `"${field}" is not a valid PNG, JPEG or WebP image.`);
      const key = field === FORM_FIELDS.screenshot ? "screenshot" : "annotatedScreenshot";
      files[key] = {
        data: value,
        contentType: sniffed,
        filename: `pinpoint-${submissionId.slice(0, 8)}-${suffix}.${extensionFor(sniffed)}`,
      };
    }

    if (options.projectId !== undefined) submission.projectId = options.projectId;

    const cached = completed.get(submissionId);
    if (cached) return { result: success(submissionId, cached, true), status: 200 };

    const pending = inFlight.get(submissionId);
    if (pending) {
      const record = await pending;
      return { result: success(submissionId, record, true), status: 200 };
    }

    const promise = persist(submission, files);
    inFlight.set(submissionId, promise);
    let record: FeedbackRecord;
    try {
      record = await promise;
    } finally {
      inFlight.delete(submissionId);
    }
    if (!record.id) throw fail("server_error", "The backend did not confirm the record.", { retryable: true });
    completed.set(submissionId, record);

    if (record.duplicate) return { result: success(submissionId, record, true), status: 200 };
    if (options.onSubmission) {
      try {
        await options.onSubmission(submission, record);
      } catch (error) {
        logger.error("[pinpoint] onSubmission hook failed:", error instanceof Error ? error.message : error);
      }
    }
    return { result: success(submissionId, record, false), status: 201 };
  }

  return async function feedbackHandler(request: Request): Promise<Response> {
    const headers = new Headers();
    const origin = originOf(request.headers.get("origin"));
    const crossOrigin = origin !== undefined && !isSameOrigin(request, origin);

    if (crossOrigin && origin && allowed && isAllowedCrossOrigin(origin)) {
      headers.set("access-control-allow-origin", allowed === "*" ? "*" : origin);
      headers.set("vary", "Origin");
    }

    const method = request.method.toUpperCase();
    if (method === "OPTIONS") {
      if (!allowed) {
        headers.set("allow", "POST");
        return new Response(null, { status: 405, headers });
      }
      if (crossOrigin && !(origin && isAllowedCrossOrigin(origin))) return new Response(null, { status: 403, headers });
      headers.set("access-control-allow-methods", "POST, OPTIONS");
      const requested = request.headers.get("access-control-request-headers");
      headers.set("access-control-allow-headers", requested && /^[\w\-, ]{1,500}$/.test(requested) ? requested : "content-type");
      headers.set("access-control-max-age", "86400");
      return new Response(null, { status: 204, headers });
    }

    if (method !== "POST") {
      headers.set("allow", allowed ? "POST, OPTIONS" : "POST");
      return json(
        { ok: false, error: { code: "validation", message: "Method not allowed.", retryable: false } },
        405,
        headers,
      );
    }

    const forbidden =
      (crossOrigin && !(origin && isAllowedCrossOrigin(origin))) ||
      (!origin && request.headers.get("sec-fetch-site") === "cross-site" && !allowed);
    if (forbidden) {
      return json(
        { ok: false, error: { code: "validation", message: "Cross-origin submissions are not allowed.", retryable: false } },
        403,
        headers,
      );
    }

    const ctx: { submissionId?: string } = {};
    try {
      const { result, status } = await handle(request, ctx);
      return json(result, status, headers);
    } catch (raw) {
      const error = asServerError(raw, logger);
      if (error.retryAfter !== undefined) headers.set("retry-after", String(error.retryAfter));
      const submissionId = ctx.submissionId;
      return json(
        {
          ok: false,
          ...(submissionId ? { submissionId } : {}),
          error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            ...(error.retryAfter !== undefined ? { retryAfter: error.retryAfter } : {}),
            ...(error.details !== undefined ? { details: error.details } : {}),
          },
        },
        error.status,
        headers,
      );
    }
  };
}

function success(submissionId: string, record: FeedbackRecord, duplicate: boolean): SubmissionResult {
  return {
    ok: true,
    submissionId,
    pageId: record.id,
    ...(record.url ? { pageUrl: record.url } : {}),
    duplicate: duplicate || record.duplicate,
  };
}

function asServerError(error: unknown, logger: HandlerLogger): PinpointServerError {
  if (error instanceof PinpointServerError) {
    if (error.status >= 500) logger.error(`[pinpoint] ${error.code}: ${error.message}`);
    return error;
  }
  logger.error("[pinpoint] Unexpected error while handling feedback:", error instanceof Error ? error.message : error);
  return fail("server_error", "Something went wrong while saving your feedback. Please try again.", { retryable: true });
}
