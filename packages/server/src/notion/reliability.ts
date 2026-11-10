import { NotionBackendError } from "../errors";

export interface NotionThrottleOptions {
  /** Max Notion requests in flight per backend instance. Default 3. */
  maxConcurrent?: number;
  /** Sustained request rate (token bucket refill). Default 3/s, Notion's documented average limit. */
  requestsPerSecond?: number;
  /** Token bucket capacity (burst). Default 5. */
  burst?: number;
}

export interface NotionRetryOptions {
  /** Retries after the first attempt. Default 3. */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Retry-After values above this give up immediately and surface the wait to the client. Default 30000. */
  maxRetryAfterMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** In-process concurrency + throughput limiter for Notion calls. */
export class NotionRequestQueue {
  private readonly maxConcurrent: number;
  private readonly ratePerMs: number;
  private readonly burst: number;
  private tokens: number;
  private lastRefill = Date.now();
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: NotionThrottleOptions = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 3);
    const rps = options.requestsPerSecond ?? 3;
    this.ratePerMs = rps === Infinity ? Infinity : Math.max(0.001, rps) / 1000;
    this.burst = Math.max(1, options.burst ?? 5);
    this.tokens = this.burst;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
      this.pump();
    });
    try {
      return await fn();
    } finally {
      this.active--;
      this.pump();
    }
  }

  private refill(): void {
    const now = Date.now();
    if (this.ratePerMs === Infinity) this.tokens = this.burst;
    else this.tokens = Math.min(this.burst, this.tokens + (now - this.lastRefill) * this.ratePerMs);
    this.lastRefill = now;
  }

  private pump(): void {
    this.refill();
    while (this.waiting.length > 0 && this.active < this.maxConcurrent && this.tokens >= 1) {
      this.tokens -= 1;
      this.active++;
      this.waiting.shift()?.();
    }
    if (this.waiting.length > 0 && this.active < this.maxConcurrent && this.timer === undefined) {
      const wait = Math.ceil((1 - this.tokens) / this.ratePerMs);
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, Math.max(1, wait));
    }
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

function header(headers: unknown, name: string): string | undefined {
  if (!isObj(headers)) return undefined;
  if (typeof headers.get === "function") {
    const v = (headers.get as (n: string) => unknown).call(headers, name);
    return typeof v === "string" ? v : undefined;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) return Array.isArray(v) ? String(v[0]) : String(v);
  }
  return undefined;
}

function parseRetryAfterSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - Date.now()) / 1000);
}

function retryAfterOf(headers: unknown): number | undefined {
  const secs = parseRetryAfterSeconds(header(headers, "retry-after"));
  return secs === undefined ? undefined : Math.ceil(secs);
}

const RETRYABLE_NOTION_CODES = new Set([
  "rate_limited",
  "internal_server_error",
  "service_unavailable",
  "service_overload",
  "gateway_timeout",
  "conflict_error",
  "notionhq_client_request_timeout",
]);

/** Converts any error thrown while talking to Notion into a NotionBackendError. */
export function toNotionBackendError(error: unknown): NotionBackendError {
  if (error instanceof NotionBackendError) return error;
  const e = isObj(error) ? error : {};
  const code = typeof e.code === "string" ? e.code : undefined;
  const status = typeof e.status === "number" ? e.status : undefined;
  const notionMessage = typeof e.message === "string" ? e.message.slice(0, 500) : "";

  if (code === "unauthorized" || status === 401) {
    return new NotionBackendError({
      code: "notion_unauthorized",
      status: 502,
      retryable: false,
      notionCode: code,
      message: "Notion rejected the API key. Check NOTION_API_KEY is the integration's internal secret.",
      cause: error,
    });
  }
  if (code === "restricted_resource" || status === 403) {
    return new NotionBackendError({
      code: "notion_unauthorized",
      status: 502,
      retryable: false,
      notionCode: code,
      message:
        "The Notion integration lacks permission. Share the database with your integration (••• → Connections) and enable read, insert and update content capabilities.",
      cause: error,
    });
  }
  if (code === "object_not_found" || status === 404) {
    return new NotionBackendError({
      code: "notion_not_found",
      status: 502,
      retryable: false,
      notionCode: code,
      message:
        "Notion database not found. Share the database with your integration (••• → Connections) and check NOTION_FEEDBACK_DATABASE_ID.",
      cause: error,
    });
  }
  if (code === "rate_limited" || status === 429) {
    return new NotionBackendError({
      code: "notion_error",
      status: 503,
      retryable: true,
      notionCode: code,
      retryAfter: retryAfterOf(e.headers),
      message: "Notion is rate limiting requests. Please try again shortly.",
      cause: error,
    });
  }
  const isNetwork =
    error instanceof TypeError ||
    (isObj(error) && (e.name === "AbortError" || e.name === "TimeoutError" || e.name === "RequestTimeoutError"));
  if (
    (code !== undefined && RETRYABLE_NOTION_CODES.has(code)) ||
    (status !== undefined && status >= 500) ||
    isNetwork
  ) {
    return new NotionBackendError({
      code: "notion_error",
      status: status === 503 || code === "service_unavailable" ? 503 : 502,
      retryable: true,
      notionCode: code,
      message: "Notion is temporarily unavailable. Please try again.",
      cause: error,
    });
  }
  if (code === "validation_error" || code === "invalid_request" || code === "invalid_json" || status === 400) {
    return new NotionBackendError({
      code: "notion_error",
      status: 502,
      retryable: false,
      notionCode: code,
      message: `Notion rejected the request${notionMessage ? `: ${notionMessage}` : "."}`,
      cause: error,
    });
  }
  return new NotionBackendError({
    code: "server_error",
    status: 500,
    retryable: true,
    notionCode: code,
    message: "Unexpected error while saving feedback to Notion.",
    cause: error,
  });
}

/** Retries retryable Notion failures with exponential back-off, honouring Retry-After. */
export async function withNotionRetry<T>(
  op: (attempt: number) => Promise<T>,
  options: NotionRetryOptions & { beforeRetry?: (attempt: number, error: NotionBackendError) => Promise<T | undefined> } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const base = options.baseDelayMs ?? 500;
  const maxDelay = options.maxDelayMs ?? 8000;
  const maxRetryAfter = options.maxRetryAfterMs ?? 30_000;
  for (let attempt = 0; ; attempt++) {
    try {
      return await op(attempt);
    } catch (raw) {
      const error = toNotionBackendError(raw);
      if (!error.retryable || attempt >= maxRetries) throw error;
      let delay: number;
      if (error.retryAfter !== undefined) {
        const ra = error.retryAfter * 1000;
        if (ra > maxRetryAfter) throw error;
        delay = Math.max(ra, base);
      } else {
        delay = Math.min(maxDelay, base * 2 ** attempt) * (0.5 + Math.random() / 2);
      }
      await sleep(delay);
      if (options.beforeRetry) {
        const settled = await options.beforeRetry(attempt + 1, error);
        if (settled !== undefined) return settled;
      }
    }
  }
}
