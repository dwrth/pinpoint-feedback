import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOutbox, computeBackoffDelay, createFeedbackClient, isPermanentFailure, isRetryable } from "../src/client/index";
import type { FeedbackTransport, OutboxEntry, SubmitProgress } from "../src/interfaces";
import type { FeedbackSubmission, SubmissionErrorCode, SubmissionFiles, SubmissionResult } from "../src/types";
import { jsonResponse, makeSubmission, success } from "./client-helpers";

const ok = (id: string): SubmissionResult => ({ ok: true, submissionId: id, pageId: "page", duplicate: false });
const fail = (code: SubmissionErrorCode, retryable: boolean, retryAfter?: number): SubmissionResult => ({
  ok: false,
  error: { code, message: code, retryable, ...(retryAfter !== undefined ? { retryAfter } : {}) },
});

type Responder = (submission: FeedbackSubmission, files: SubmissionFiles, signal?: AbortSignal) => SubmissionResult | Promise<SubmissionResult>;

function scriptedTransport(...responses: Array<SubmissionResult | Responder>) {
  const queue = [...responses];
  const submit = vi.fn(async (submission: FeedbackSubmission, files: SubmissionFiles, opts?: { signal?: AbortSignal }) => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return typeof next === "function" ? next(submission, files, opts?.signal) : next;
  });
  return { submit } satisfies FeedbackTransport;
}

function setup(transport: FeedbackTransport, extra: Partial<Parameters<typeof createFeedbackClient>[0]> = {}) {
  const outbox = new MemoryOutbox();
  const client = createFeedbackClient({
    endpoint: "/api/feedback",
    transport,
    outbox,
    random: () => 0.5,
    fitImage: async (blob) => ({ blob }),
    ...extra,
  });
  return { client, outbox };
}

describe("helpers", () => {
  it("isRetryable / isPermanentFailure", () => {
    expect(isRetryable(fail("network", true))).toBe(true);
    expect(isRetryable(ok("x"))).toBe(false);
    expect(isPermanentFailure(fail("validation", false))).toBe(true);
    expect(isPermanentFailure(fail("misconfigured", false))).toBe(false);
    expect(isPermanentFailure(fail("server_error", true))).toBe(false);
  });

  it("computeBackoffDelay is 1s/3s/9s with jitter and honours retryAfter", () => {
    expect([1, 2, 3].map((n) => computeBackoffDelay(n, {}, () => 0.5))).toEqual([1000, 3000, 9000]);
    expect(computeBackoffDelay(1, {}, () => 0)).toBe(800);
    expect(computeBackoffDelay(1, {}, () => 1)).toBe(1200);
    expect(computeBackoffDelay(10, {}, () => 0.5)).toBe(30_000);
    expect(computeBackoffDelay(1, {}, () => 0.5, 20)).toBe(20_000);
  });
});

describe("createFeedbackClient.submit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists to the outbox before sending and removes on success", async () => {
    const sub = makeSubmission();
    let seenInOutbox: OutboxEntry | undefined;
    const transport = scriptedTransport(async (s) => {
      seenInOutbox = await outbox.get(s.submissionId);
      return ok(s.submissionId);
    });
    const { client, outbox } = setup(transport);
    const progress: SubmitProgress[] = [];
    const result = await client.submit(sub, { screenshot: new Blob(["a"]) }, { onProgress: (p) => progress.push(p) });

    expect(result.ok).toBe(true);
    expect(seenInOutbox?.submission.submissionId).toBe(sub.submissionId);
    expect(seenInOutbox?.files.screenshot).toBeInstanceOf(Blob);
    expect(await client.pending()).toEqual([]);
    expect(progress.map((p) => p.phase)).toEqual(["preparing", "queued", "sending", "done"]);
    expect(progress.every((p) => p.maxAttempts === 3)).toBe(true);
  });

  it("retries retryable errors with backoff, same submissionId, then succeeds", async () => {
    const sub = makeSubmission();
    const transport = scriptedTransport(fail("server_error", true), fail("network", true), ok(sub.submissionId));
    const { client } = setup(transport);
    const progress: SubmitProgress[] = [];
    const pending = client.submit(sub, {}, { onProgress: (p) => progress.push(p) });

    await vi.advanceTimersByTimeAsync(0);
    expect(transport.submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(transport.submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.submit).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(transport.submit).toHaveBeenCalledTimes(3);

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(transport.submit.mock.calls.every(([s]) => s.submissionId === sub.submissionId)).toBe(true);
    const retrying = progress.filter((p) => p.phase === "retrying");
    expect(retrying.map((p) => [p.attempt, p.retryInMs])).toEqual([
      [1, 1000],
      [2, 3000],
    ]);
    expect(progress.at(-1)).toMatchObject({ phase: "done", attempt: 3 });
    expect(await client.pending()).toEqual([]);
  });

  it("honours retryAfter from rate limiting", async () => {
    const sub = makeSubmission();
    const transport = scriptedTransport(fail("rate_limited", true, 7), ok(sub.submissionId));
    const { client } = setup(transport);
    const pending = client.submit(sub, {});
    await vi.advanceTimersByTimeAsync(6999);
    expect(transport.submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).ok).toBe(true);
  });

  it("keeps the entry after exhausting retryable attempts", async () => {
    const sub = makeSubmission();
    const transport = scriptedTransport(fail("server_error", true));
    const { client } = setup(transport, { now: () => 1_000_000 });
    const progress: SubmitProgress[] = [];
    const pending = client.submit(sub, {}, { onProgress: (p) => progress.push(p) });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(transport.submit).toHaveBeenCalledTimes(3);
    const [entry] = await client.pending();
    expect(entry?.attempts).toBe(3);
    expect(entry?.lastError).toBe("server_error: server_error");
    expect(entry?.nextAttemptAt).toBe(1_000_000 + 9_000);
    expect(progress.at(-1)).toMatchObject({ phase: "failed", attempt: 3, error: "server_error" });
  });

  it("stops early when retryAfter exceeds maxInlineWaitMs and leaves it queued", async () => {
    const sub = makeSubmission();
    const transport = scriptedTransport(fail("rate_limited", true, 3600));
    const { client } = setup(transport);
    const result = await client.submit(sub, {});
    expect(result.ok).toBe(false);
    expect(transport.submit).toHaveBeenCalledTimes(1);
    expect(await client.pending()).toHaveLength(1);
  });

  it.each(["validation", "payload_too_large", "unsupported_media_type", "spam"] as const)(
    "removes the entry on permanent %s failure without retrying",
    async (code) => {
      const transport = scriptedTransport(fail(code, false));
      const { client } = setup(transport);
      const result = await client.submit(makeSubmission(), {});
      expect(!result.ok && result.error.code).toBe(code);
      expect(transport.submit).toHaveBeenCalledTimes(1);
      expect(await client.pending()).toEqual([]);
    },
  );

  it("keeps non-retryable, non-permanent failures (e.g. misconfigured) without retrying", async () => {
    const transport = scriptedTransport(fail("misconfigured", false));
    const { client } = setup(transport);
    const sub = makeSubmission();
    const result = await client.submit(sub, {});
    expect(result).toMatchObject({ ok: false, submissionId: sub.submissionId });
    expect(transport.submit).toHaveBeenCalledTimes(1);
    expect(await client.pending()).toHaveLength(1);
  });

  it("rejects invalid submissions before queueing", async () => {
    const transport = scriptedTransport(ok("x"));
    const { client } = setup(transport);
    const result = await client.submit(makeSubmission({ title: "   " }), {});
    expect(!result.ok && result.error.code).toBe("validation");
    expect(transport.submit).not.toHaveBeenCalled();
    expect(await client.pending()).toEqual([]);
  });

  it("returns payload_too_large when an image cannot be fitted", async () => {
    const transport = scriptedTransport(ok("x"));
    const { client } = setup(transport, {
      fitImage: async () => {
        throw new Error("too big");
      },
    });
    const result = await client.submit(makeSubmission(), { screenshot: new Blob(["x"]) });
    expect(!result.ok && result.error).toMatchObject({ code: "payload_too_large", retryable: false });
    expect(transport.submit).not.toHaveBeenCalled();
  });

  it("sends the fitted images and passes maxFileBytes", async () => {
    const small = new Blob(["small"], { type: "image/webp" });
    const fitImage = vi.fn(async () => ({ blob: small }));
    const transport = scriptedTransport((s, files) => {
      expect(files.screenshot).toBe(small);
      expect(files.annotatedScreenshot).toBe(small);
      return ok(s.submissionId);
    });
    const { client } = setup(transport, { fitImage, maxFileBytes: 1234 });
    const big = new Blob(["big"], { type: "image/png" });
    expect((await client.submit(makeSubmission(), { screenshot: big, annotatedScreenshot: big })).ok).toBe(true);
    expect(fitImage).toHaveBeenCalledWith(big, 1234);
  });

  it("abort during backoff ends the call and keeps the entry", async () => {
    const transport = scriptedTransport(fail("server_error", true));
    const { client } = setup(transport);
    const controller = new AbortController();
    const pending = client.submit(makeSubmission(), {}, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    const result = await pending;
    expect(!result.ok && result.error).toMatchObject({ retryable: false, details: { aborted: true } });
    expect(transport.submit).toHaveBeenCalledTimes(1);
    expect(await client.pending()).toHaveLength(1);
  });

  it("never throws if the transport throws", async () => {
    const transport: FeedbackTransport = {
      submit: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const { client } = setup(transport, { maxAttempts: 1 });
    const result = await client.submit(makeSubmission(), {});
    expect(!result.ok && result.error).toMatchObject({ code: "network", retryable: true, message: "boom" });
  });

  it("still sends if the outbox fails", async () => {
    const transport = scriptedTransport((s) => ok(s.submissionId));
    const broken = {
      put: async () => { throw new Error("quota"); },
      get: async () => { throw new Error("quota"); },
      list: async () => { throw new Error("quota"); },
      remove: async () => { throw new Error("quota"); },
    };
    const client = createFeedbackClient({ endpoint: "/x", transport, outbox: broken, fitImage: async (b) => ({ blob: b }) });
    expect((await client.submit(makeSubmission(), {})).ok).toBe(true);
    expect(await client.pending()).toEqual([]);
  });

  it("works end-to-end with the default HTTP transport", async () => {
    const sub = makeSubmission();
    const fetch = vi.fn(async () => jsonResponse(200, success(sub.submissionId)));
    const client = createFeedbackClient({ endpoint: "/api/feedback", fetch, outbox: new MemoryOutbox(), headers: { "X-A": "1" } });
    const result = await client.submit(sub, {});
    expect(result).toMatchObject({ ok: true, pageId: "page-1" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("createFeedbackClient.retryPending", () => {
  const seed = async (outbox: MemoryOutbox, entries: Array<Partial<OutboxEntry>>) => {
    const subs: FeedbackSubmission[] = [];
    for (const [i, e] of entries.entries()) {
      const submission = makeSubmission({ createdAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() });
      subs.push(submission);
      await outbox.put({ submission, files: {}, attempts: 1, ...e });
    }
    return subs;
  };

  it("sends each due entry once, sequentially, applying removal rules", async () => {
    const order: string[] = [];
    let active = 0;
    const transport = scriptedTransport(async (s) => {
      active++;
      expect(active).toBe(1);
      order.push(s.submissionId);
      await Promise.resolve();
      active--;
      if (s.submissionId === subs[0]!.submissionId) return ok(s.submissionId);
      if (s.submissionId === subs[1]!.submissionId) return fail("server_error", true);
      return fail("validation", false);
    });
    const { client, outbox } = setup(transport, { now: () => 5_000 });
    const subs = await seed(outbox, [{}, {}, {}, { nextAttemptAt: 10_000 }]);

    const results = await client.retryPending();
    expect(order).toEqual(subs.slice(0, 3).map((s) => s.submissionId));
    expect(results.map((r) => r.ok)).toEqual([true, false, false]);

    const left = await client.pending();
    expect(left.map((e) => e.submission.submissionId)).toEqual([subs[1]!.submissionId, subs[3]!.submissionId]);
    expect(left[0]).toMatchObject({ attempts: 2, lastError: "server_error: server_error", nextAttemptAt: 5_000 + 3_000 });
  });

  it("force sends entries not yet due", async () => {
    const transport = scriptedTransport((s) => ok(s.submissionId));
    const { client, outbox } = setup(transport, { now: () => 0 });
    await seed(outbox, [{ nextAttemptAt: 99_999 }]);
    expect(await client.retryPending()).toEqual([]);
    expect(await client.retryPending({ force: true })).toHaveLength(1);
    expect(await client.pending()).toEqual([]);
  });

  it("is single-flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const transport = scriptedTransport(async (s) => {
      await gate;
      return ok(s.submissionId);
    });
    const { client, outbox } = setup(transport);
    await seed(outbox, [{}]);
    const a = client.retryPending();
    const b = client.retryPending();
    expect(a).toBe(b);
    release();
    await a;
    expect(transport.submit).toHaveBeenCalledTimes(1);
  });

  it("does not resend an id that submit() is currently handling", async () => {
    vi.useFakeTimers();
    try {
      const sub = makeSubmission();
      const transport = scriptedTransport(fail("server_error", true), ok(sub.submissionId));
      const { client } = setup(transport);
      const submitting = client.submit(sub, {});
      await vi.advanceTimersByTimeAsync(10);
      expect(await client.pending()).toHaveLength(1);
      expect(await client.retryPending({ force: true })).toEqual([]);
      expect(transport.submit).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await submitting).ok).toBe(true);
      expect(transport.submit).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("submit() of an id retryPending is sending waits for it instead of double-sending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const transport = scriptedTransport(async (s) => {
      await gate;
      return ok(s.submissionId);
    });
    const { client, outbox } = setup(transport);
    const [sub] = await seed(outbox, [{}]);
    const retry = client.retryPending();
    await Promise.resolve();
    await Promise.resolve();
    const submitted = client.submit(sub!, {});
    release();
    expect((await submitted).ok).toBe(true);
    await retry;
    expect(transport.submit).toHaveBeenCalledTimes(1);
  });

  it("discard removes an entry", async () => {
    const { client, outbox } = setup(scriptedTransport(ok("x")));
    const [sub] = await seed(outbox, [{}]);
    await client.discard(sub!.submissionId);
    expect(await client.pending()).toEqual([]);
  });
});

describe("client precheck with custom categories", () => {
  it("does not reject category ids unknown to the built-in list", async () => {
    const { createFeedbackClient, MemoryOutbox } = await import("../src/client/index");
    const { createId } = await import("../src/ids");
    const submit = vi.fn(async (s: { submissionId: string }) => ({ ok: true as const, submissionId: s.submissionId, pageId: "p", duplicate: false }));
    const client = createFeedbackClient({ endpoint: "/x", transport: { submit }, outbox: new MemoryOutbox(), fitImage: async (b: Blob) => ({ blob: b, downscaled: false, reencoded: false }) } as never);
    const result = await client.submit(
      {
        submissionId: createId(),
        title: "t",
        description: "",
        category: "perf",
        priority: "low",
        annotations: [],
        createdAt: new Date().toISOString(),
        metadata: { url: "https://a.test/", pageTitle: "", userAgent: "", browser: { name: "x" }, os: { name: "y" }, viewport: { width: 1, height: 1 }, screen: { width: 1, height: 1 }, devicePixelRatio: 1 },
      },
      {},
    );
    expect(result.ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe("server file size limit", () => {
  const tooLarge = (maxFileBytes: unknown): SubmissionResult => ({
    ok: false,
    error: { code: "payload_too_large", message: "too large", retryable: false, details: { maxFileBytes, field: "screenshot" } },
  });
  const big = () => new Blob([new Uint8Array(100)], { type: "image/png" });
  let truncatingFit: ReturnType<typeof makeFit>;
  const makeFit = () => vi.fn(async (blob: Blob, maxBytes: number) => ({ blob: blob.slice(0, maxBytes) }));

  beforeEach(() => {
    truncatingFit = makeFit();
  });

  it("re-fits both images to the server's limit and resends once with the same submissionId", async () => {
    const sub = makeSubmission();
    const sizes: number[][] = [];
    const transport = scriptedTransport(
      (_s, files) => {
        sizes.push([files.screenshot!.size, files.annotatedScreenshot!.size]);
        return tooLarge(40);
      },
      (s, files) => {
        sizes.push([files.screenshot!.size, files.annotatedScreenshot!.size]);
        return ok(s.submissionId);
      },
    );
    const { client, outbox } = setup(transport, { fitImage: truncatingFit });
    const putSpy = vi.spyOn(outbox, "put");
    const result = await client.submit(sub, { screenshot: big(), annotatedScreenshot: big() });

    expect(result.ok).toBe(true);
    expect(sizes).toEqual([
      [100, 100],
      [40, 40],
    ]);
    expect(transport.submit.mock.calls.every(([s]) => s.submissionId === sub.submissionId)).toBe(true);
    expect(putSpy.mock.calls.some(([e]) => e.files.screenshot?.size === 40)).toBe(true);
    expect(await client.pending()).toEqual([]);

    await client.submit(makeSubmission(), { screenshot: big() });
    expect(truncatingFit).toHaveBeenLastCalledWith(expect.any(Blob), 40);
  });

  it("retries only once and then drops the entry", async () => {
    const transport = scriptedTransport(tooLarge(40), tooLarge(10));
    const { client } = setup(transport, { fitImage: truncatingFit });
    const result = await client.submit(makeSubmission(), { screenshot: big() });
    expect(!result.ok && result.error.code).toBe("payload_too_large");
    expect(transport.submit).toHaveBeenCalledTimes(2);
    expect(await client.pending()).toEqual([]);
  });

  it.each([[undefined], ["40"], [500]])("does not retry when details.maxFileBytes is %s", async (limit) => {
    const transport = scriptedTransport(tooLarge(limit));
    const { client } = setup(transport, { fitImage: truncatingFit });
    await client.submit(makeSubmission(), { screenshot: big() });
    expect(transport.submit).toHaveBeenCalledTimes(1);
  });

  it("re-fits entries sent by retryPending", async () => {
    const sub = makeSubmission();
    const transport = scriptedTransport(tooLarge(30), ok(sub.submissionId));
    const { client, outbox } = setup(transport, { fitImage: truncatingFit });
    await outbox.put({ submission: sub, files: { screenshot: big() }, attempts: 1 });
    const [result] = await client.retryPending({ force: true });
    expect(result?.ok).toBe(true);
    expect(transport.submit.mock.calls[1]![1].screenshot!.size).toBe(30);
  });
});
