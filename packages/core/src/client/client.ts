import type {
  FeedbackClient,
  FeedbackClientOptions,
  FeedbackOutbox,
  FeedbackTransport,
  OutboxEntry,
  SubmitProgress,
} from "../interfaces";
import { LIMITS } from "../limits";
import type { FeedbackSubmission, SubmissionErrorCode, SubmissionFiles, SubmissionResult } from "../types";
import { validateSubmission } from "../validation";
import { fitImageToSize, type FitImageResult } from "./image";
import { createOutbox } from "./outbox";
import { abortedFailure, errorMessage, failure, HttpFeedbackTransport, isAbortFailure } from "./transport";

export interface BackoffOptions {
  /** Delay after the first failure. Default 1000. */
  baseDelayMs?: number;
  /** Multiplier per failure. Default 3 (1s, 3s, 9s, …). */
  factor?: number;
  /** Cap for the exponential part. Default 30000. */
  maxDelayMs?: number;
  /** Relative jitter, 0..1. Default 0.2 (±20%). */
  jitter?: number;
}

export interface CreateFeedbackClientOptions extends FeedbackClientOptions {
  backoff?: BackoffOptions;
  /**
   * Longest delay `submit()` will wait in-line before the next attempt (e.g. a long Retry-After).
   * Longer waits end the call with the failure and leave the entry for `retryPending`. Default 60000.
   */
  maxInlineWaitMs?: number;
  /** Validate the payload with `validateSubmission` before queueing. Default true. */
  validate?: boolean;
  /** Injection points for tests. */
  random?: () => number;
  now?: () => number;
  fitImage?: (blob: Blob, maxBytes: number) => Promise<Pick<FitImageResult, "blob">>;
}

/** Codes that can never succeed on resend: the entry is dropped from the outbox. */
const PERMANENT_CODES: ReadonlySet<SubmissionErrorCode> = new Set<SubmissionErrorCode>([
  "validation",
  "payload_too_large",
  "unsupported_media_type",
  "spam",
]);

export function isRetryable(result: SubmissionResult): boolean {
  return !result.ok && result.error.retryable;
}

/** True for failures that resending the same payload can never fix. */
export function isPermanentFailure(result: SubmissionResult): boolean {
  return !result.ok && !result.error.retryable && PERMANENT_CODES.has(result.error.code);
}

export function computeBackoffDelay(
  failedAttempts: number,
  options: BackoffOptions = {},
  random: () => number = Math.random,
  retryAfterSeconds?: number,
): number {
  const base = options.baseDelayMs ?? 1000;
  const factor = options.factor ?? 3;
  const max = options.maxDelayMs ?? 30_000;
  const jitter = Math.min(1, Math.max(0, options.jitter ?? 0.2));
  const exp = Math.min(max, base * factor ** Math.max(0, failedAttempts - 1));
  const delay = Math.round(exp * (1 - jitter + 2 * jitter * random()));
  const hinted = retryAfterSeconds !== undefined && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 0;
  return Math.max(delay, hinted);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

class Client implements FeedbackClient {
  private readonly transport: FeedbackTransport;
  private readonly outbox: FeedbackOutbox;
  private readonly maxAttempts: number;
  private maxFileBytes: number;
  private readonly maxInlineWaitMs: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly inFlight = new Map<string, Promise<SubmissionResult>>();
  private retryRun?: Promise<SubmissionResult[]>;

  constructor(private readonly options: CreateFeedbackClientOptions) {
    this.transport =
      options.transport ??
      new HttpFeedbackTransport({
        endpoint: options.endpoint,
        fetch: options.fetch,
        headers: options.headers,
        timeoutMs: options.timeoutMs,
      });
    this.outbox = options.outbox ?? createOutbox();
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
    this.maxFileBytes = options.maxFileBytes ?? LIMITS.fileMaxBytes;
    this.maxInlineWaitMs = options.maxInlineWaitMs ?? 60_000;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  async submit(
    submission: FeedbackSubmission,
    files: SubmissionFiles,
    options: { signal?: AbortSignal; onProgress?: (p: SubmitProgress) => void } = {},
  ): Promise<SubmissionResult> {
    const id = submission.submissionId;
    let existing = this.inFlight.get(id);
    while (existing) {
      const result = await existing;
      if (result.ok || isPermanentFailure(result)) return result;
      const next = this.inFlight.get(id);
      existing = next === existing ? undefined : next;
    }
    const run = this.runSubmit(submission, files, options);
    this.inFlight.set(id, run);
    try {
      return await run;
    } finally {
      if (this.inFlight.get(id) === run) this.inFlight.delete(id);
    }
  }

  retryPending(options: { signal?: AbortSignal; force?: boolean } = {}): Promise<SubmissionResult[]> {
    if (!this.retryRun) {
      this.retryRun = this.runRetryPending(options).finally(() => {
        this.retryRun = undefined;
      });
    }
    return this.retryRun;
  }

  async pending(): Promise<OutboxEntry[]> {
    try {
      return await this.outbox.list();
    } catch {
      return [];
    }
  }

  async discard(submissionId: string): Promise<void> {
    await this.outbox.remove(submissionId);
  }

  private async runSubmit(
    submission: FeedbackSubmission,
    rawFiles: SubmissionFiles,
    options: { signal?: AbortSignal; onProgress?: (p: SubmitProgress) => void },
  ): Promise<SubmissionResult> {
    const id = submission.submissionId;
    const { signal } = options;
    const maxAttempts = this.maxAttempts;
    const emit = (p: Omit<SubmitProgress, "maxAttempts">) => {
      try {
        options.onProgress?.({ ...p, maxAttempts });
      } catch {
        /* listener errors must not break submission */
      }
    };
    const fail = (result: SubmissionResult, attempt: number) => {
      emit({ phase: "failed", attempt, error: result.ok ? undefined : result.error.message });
      return result;
    };

    emit({ phase: "preparing", attempt: 0 });

    const precheck = this.precheck(submission);
    if (precheck) return fail(precheck, 0);

    let files: SubmissionFiles;
    try {
      files = await this.prepareFiles(rawFiles);
    } catch (err) {
      return fail(failure(id, "payload_too_large", errorMessage(err), false), 0);
    }
    if (signal?.aborted) return fail(abortedFailure(id), 0);

    const previous = await this.safe(() => this.outbox.get(id));
    const entry: OutboxEntry = { submission, files, attempts: previous?.attempts ?? 0 };
    await this.safe(() => this.outbox.put(entry));
    emit({ phase: "queued", attempt: 0 });

    let attempt = 0;
    let refitted = false;
    while (true) {
      if (signal?.aborted) return fail(await this.recordFailure(entry, abortedFailure(id), 1), attempt);
      attempt++;
      emit({ phase: "sending", attempt });
      const result = await this.send(entry, signal);
      if (!refitted && (await this.refitToServerLimit(entry, result, rawFiles))) {
        refitted = true;
        continue;
      }
      if (result.ok) {
        await this.safe(() => this.outbox.remove(id));
        emit({ phase: "done", attempt });
        return result;
      }
      const delay = computeBackoffDelay(entry.attempts, this.options.backoff, this.random, result.error.retryAfter);
      const stop =
        signal?.aborted ||
        isAbortFailure(result) ||
        !result.error.retryable ||
        attempt >= maxAttempts ||
        delay > this.maxInlineWaitMs;
      if (stop) return fail(await this.recordFailure(entry, result, delay), attempt);

      await this.recordFailure(entry, result, delay);
      emit({ phase: "retrying", attempt, retryInMs: delay, error: result.error.message });
      await sleep(delay, signal);
    }
  }

  private async runRetryPending(options: { signal?: AbortSignal; force?: boolean }): Promise<SubmissionResult[]> {
    const results: SubmissionResult[] = [];
    const entries = await this.pending();
    for (const listed of entries) {
      if (options.signal?.aborted) break;
      const id = listed.submission.submissionId;
      if (this.inFlight.has(id)) continue;
      if (!options.force && listed.nextAttemptAt !== undefined && listed.nextAttemptAt > this.now()) continue;

      const run = (async () => {
        const entry = (await this.safe(() => this.outbox.get(id))) ?? listed;
        let result = await this.send(entry, options.signal);
        if (await this.refitToServerLimit(entry, result, entry.files)) result = await this.send(entry, options.signal);
        if (result.ok) {
          await this.safe(() => this.outbox.remove(id));
          return result;
        }
        const delay = computeBackoffDelay(entry.attempts, this.options.backoff, this.random, result.error.retryAfter);
        return this.recordFailure(entry, result, delay);
      })();
      this.inFlight.set(id, run);
      try {
        results.push(await run);
      } finally {
        if (this.inFlight.get(id) === run) this.inFlight.delete(id);
      }
    }
    return results;
  }

  private precheck(submission: FeedbackSubmission): SubmissionResult | undefined {
    const id = submission.submissionId;
    if (this.options.validate !== false) {
      // Category membership depends on the server's configuration; only its format is checked here.
      const v = validateSubmission(submission, {
        categories: typeof submission.category === "string" ? [submission.category] : [],
      });
      if (!v.ok) {
        const first = v.issues[0];
        const message = first ? `${first.path || "payload"} ${first.message}` : "Invalid submission";
        return failure(id, "validation", message, false, { details: v.issues });
      }
    }
    let bytes: number;
    try {
      bytes = new TextEncoder().encode(JSON.stringify(submission)).byteLength;
    } catch (err) {
      return failure(id, "validation", `Submission is not serialisable: ${errorMessage(err)}`, false);
    }
    if (bytes > LIMITS.payloadMaxBytes) {
      return failure(id, "payload_too_large", `Submission payload exceeds ${LIMITS.payloadMaxBytes} bytes`, false);
    }
    return undefined;
  }

  private async prepareFiles(files: SubmissionFiles): Promise<SubmissionFiles> {
    const fit = this.options.fitImage ?? fitImageToSize;
    const out: SubmissionFiles = {};
    if (files.screenshot) out.screenshot = (await fit(files.screenshot, this.maxFileBytes)).blob;
    if (files.annotatedScreenshot) out.annotatedScreenshot = (await fit(files.annotatedScreenshot, this.maxFileBytes)).blob;
    return out;
  }

  /**
   * After a 413 whose `details.maxFileBytes` is below the largest file sent, lowers the client's
   * limit for its lifetime, re-fits the images and updates the outbox entry. True when the caller
   * should resend once.
   */
  private async refitToServerLimit(
    entry: OutboxEntry,
    result: SubmissionResult,
    source: SubmissionFiles,
  ): Promise<boolean> {
    if (result.ok || result.error.code !== "payload_too_large") return false;
    const limit = serverFileLimit(result.error.details);
    if (limit === undefined) return false;
    const largest = Math.max(0, ...[entry.files.screenshot, entry.files.annotatedScreenshot].map((f) => f?.size ?? 0));
    if (limit >= largest) return false;
    this.maxFileBytes = Math.min(this.maxFileBytes, limit);
    try {
      entry.files = await this.prepareFiles(source);
    } catch {
      return false;
    }
    await this.safe(() => this.outbox.put(entry));
    return true;
  }

  private async send(entry: OutboxEntry, signal: AbortSignal | undefined): Promise<SubmissionResult> {
    const id = entry.submission.submissionId;
    entry.attempts += 1;
    entry.lastAttemptAt = this.now();
    let result: SubmissionResult;
    try {
      result = await this.transport.submit(entry.submission, entry.files, { signal });
    } catch (err) {
      result = failure(id, "network", errorMessage(err), true);
    }
    if (signal?.aborted && !result.ok && !isAbortFailure(result)) result = abortedFailure(id);
    if (!result.ok && result.submissionId === undefined) result = { ...result, submissionId: id };
    return result;
  }

  /** Drops permanent failures; otherwise stores error + next retry time. Aborted sends are kept. */
  private async recordFailure(entry: OutboxEntry, result: SubmissionResult, delayMs: number): Promise<SubmissionResult> {
    if (result.ok) return result;
    const id = entry.submission.submissionId;
    if (isPermanentFailure(result)) {
      await this.safe(() => this.outbox.remove(id));
      return result;
    }
    entry.lastError = `${result.error.code}: ${result.error.message}`;
    entry.nextAttemptAt = this.now() + delayMs;
    await this.safe(() => this.outbox.put(entry));
    return result;
  }

  private async safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  }
}

function serverFileLimit(details: unknown): number | undefined {
  if (!details || typeof details !== "object") return undefined;
  const value = (details as { maxFileBytes?: unknown }).maxFileBytes;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Creates the browser submission client.
 *
 * - `submit` validates, fits images to `maxFileBytes`, persists to the outbox, then sends with
 *   exponential backoff + jitter (honouring `retryAfter`) up to `maxAttempts` for retryable errors.
 *   The same submissionId is sent each time (server dedupes via Idempotency-Key).
 * - A `payload_too_large` response carrying `details.maxFileBytes` below the size of the files
 *   sent lowers `maxFileBytes` for the client's lifetime; the images are re-fitted and sent once more.
 * - Success removes the entry. Permanent failures (validation, payload_too_large,
 *   unsupported_media_type, spam) remove it. Everything else, including exhausted retryable
 *   failures, other non-retryable server errors and caller aborts, stays for `retryPending`.
 * - `retryPending` sends each due entry once (entries whose `nextAttemptAt` is in the future are
 *   skipped unless `force`), sequentially, is single-flight, and skips ids `submit` is handling.
 */
export function createFeedbackClient(options: CreateFeedbackClientOptions): FeedbackClient & {
  retryPending(options?: { signal?: AbortSignal; force?: boolean }): Promise<SubmissionResult[]>;
} {
  return new Client(options);
}
