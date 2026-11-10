import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpFeedbackTransport, interpretResponse, isAbortFailure, parseRetryAfter } from "../src/client/index";
import { FORM_FIELDS } from "../src/limits";
import type { SubmissionResult } from "../src/types";
import { jsonResponse, makeSubmission, success } from "./client-helpers";

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

function fakeFetch(respond: (...args: FetchArgs) => Promise<Response> | Response) {
  return vi.fn<(...args: FetchArgs) => Promise<Response>>(async (...args) => respond(...args));
}

const failed = (r: SubmissionResult) => {
  if (r.ok) throw new Error("expected failure");
  return r.error;
};

describe("HttpFeedbackTransport request", () => {
  it("POSTs multipart with payload, files and Idempotency-Key", async () => {
    const sub = makeSubmission();
    const fetch = fakeFetch(() => jsonResponse(200, success(sub.submissionId)));
    const transport = new HttpFeedbackTransport({
      endpoint: "/api/feedback",
      fetch,
      headers: { "X-Project": "p1", "Content-Type": "application/json" },
    });
    const screenshot = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const annotated = new Blob([new Uint8Array([4, 5])], { type: "image/jpeg" });

    const result = await transport.submit(sub, { screenshot, annotatedScreenshot: annotated });

    expect(result).toEqual({ ok: true, submissionId: sub.submissionId, pageId: "page-1", pageUrl: "https://notion.so/page-1", duplicate: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/feedback");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe(sub.submissionId);
    expect(headers["X-Project"]).toBe("p1");
    expect(Object.keys(headers).some((k) => k.toLowerCase() === "content-type")).toBe(false);

    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(JSON.parse(form.get(FORM_FIELDS.payload) as string)).toEqual(sub);
    const shot = form.get(FORM_FIELDS.screenshot) as File;
    expect(shot.name).toBe(`screenshot-${sub.submissionId}.png`);
    expect(shot.size).toBe(3);
    const ann = form.get(FORM_FIELDS.annotatedScreenshot) as File;
    expect(ann.name).toBe(`annotated-screenshot-${sub.submissionId}.jpg`);
  });

  it("omits absent file fields", async () => {
    const sub = makeSubmission();
    const fetch = fakeFetch(() => jsonResponse(201, success(sub.submissionId, true)));
    const result = await new HttpFeedbackTransport({ endpoint: "/x", fetch }).submit(sub, {});
    expect(result.ok && result.duplicate).toBe(true);
    const form = fetch.mock.calls[0]![1]!.body as FormData;
    expect(form.has(FORM_FIELDS.screenshot)).toBe(false);
    expect(form.has(FORM_FIELDS.annotatedScreenshot)).toBe(false);
  });
});

describe("HttpFeedbackTransport outcome mapping", () => {
  const sub = makeSubmission();
  const run = (res: Response | (() => never)) =>
    new HttpFeedbackTransport({
      endpoint: "/x",
      fetch: fakeFetch(() => (typeof res === "function" ? res() : res)),
    }).submit(sub, {});

  it.each([
    [500, "server_error", true],
    [502, "server_error", true],
    [503, "server_error", true],
    [408, "timeout", true],
    [409, "server_error", true],
    [413, "payload_too_large", false],
    [415, "unsupported_media_type", false],
    [400, "validation", false],
    [422, "validation", false],
    [401, "misconfigured", false],
    [404, "misconfigured", false],
    [418, "validation", false],
  ] as const)("HTTP %i without JSON body → %s (retryable=%s)", async (status, code, retryable) => {
    const e = failed(await run(new Response("<html>oops</html>", { status })));
    expect(e.code).toBe(code);
    expect(e.retryable).toBe(retryable);
    expect(e.message).toContain(String(status));
  });

  it("uses the server's SubmissionFailure body", async () => {
    const r = await run(
      jsonResponse(400, {
        ok: false,
        error: { code: "spam", message: "Looks automated", retryable: false, details: { reason: "honeypot" } },
      }),
    );
    expect(r).toEqual({
      ok: false,
      submissionId: sub.submissionId,
      error: { code: "spam", message: "Looks automated", retryable: false, details: { reason: "honeypot" } },
    });
  });

  it("falls back to status mapping for unknown error codes but keeps the message", async () => {
    const e = failed(await run(jsonResponse(503, { ok: false, error: { code: "weird", message: "Notion down" } })));
    expect(e).toMatchObject({ code: "server_error", message: "Notion down", retryable: true });
  });

  it("429 → rate_limited with Retry-After seconds", async () => {
    const e = failed(await run(new Response("slow down", { status: 429, headers: { "Retry-After": "12" } })));
    expect(e).toMatchObject({ code: "rate_limited", retryable: true, retryAfter: 12, message: "slow down" });
  });

  it("body retryAfter wins over header", async () => {
    const e = failed(
      await run(jsonResponse(429, { ok: false, error: { code: "rate_limited", message: "x", retryable: true, retryAfter: 3 } }, { "Retry-After": "99" })),
    );
    expect(e.retryAfter).toBe(3);
  });

  it("2xx with an unrecognised body is a retryable server_error", async () => {
    const e = failed(await run(new Response("ok", { status: 200 })));
    expect(e).toMatchObject({ code: "server_error", retryable: true });
  });

  it("network errors → retryable network failure", async () => {
    const e = failed(await run(() => { throw new TypeError("Failed to fetch"); }));
    expect(e).toMatchObject({ code: "network", retryable: true });
    expect(e.message).toContain("Failed to fetch");
  });

  it("missing fetch → misconfigured, never throws", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", undefined);
    try {
      const e = failed(await new HttpFeedbackTransport({ endpoint: "/x" }).submit(sub, {}));
      expect(e.code).toBe("misconfigured");
    } finally {
      vi.stubGlobal("fetch", original);
    }
  });
});

describe("HttpFeedbackTransport abort/timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const hangingFetch = () =>
    fakeFetch(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );

  it("times out with a retryable timeout failure", async () => {
    vi.useFakeTimers();
    const transport = new HttpFeedbackTransport({ endpoint: "/x", fetch: hangingFetch(), timeoutMs: 5000 });
    const pending = transport.submit(makeSubmission(), {});
    await vi.advanceTimersByTimeAsync(5000);
    const e = failed(await pending);
    expect(e).toMatchObject({ code: "timeout", retryable: true });
  });

  it("caller abort → non-retryable aborted failure", async () => {
    const controller = new AbortController();
    const transport = new HttpFeedbackTransport({ endpoint: "/x", fetch: hangingFetch() });
    const pending = transport.submit(makeSubmission(), {}, { signal: controller.signal });
    controller.abort();
    const r = await pending;
    expect(failed(r)).toMatchObject({ code: "network", retryable: false });
    expect(isAbortFailure(r)).toBe(true);
  });

  it("already-aborted signal does not call fetch", async () => {
    const fetch = hangingFetch();
    const controller = new AbortController();
    controller.abort();
    const r = await new HttpFeedbackTransport({ endpoint: "/x", fetch }).submit(makeSubmission(), {}, { signal: controller.signal });
    expect(isAbortFailure(r)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("parseRetryAfter handles seconds and HTTP dates", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("garbage")).toBeUndefined();
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(10);
    expect(parseRetryAfter("Wed, 31 Dec 2025 00:00:00 GMT", now)).toBe(0);
  });

  it("interpretResponse requires 2xx for success", () => {
    const r = interpretResponse("id", 500, new Headers(), JSON.stringify({ ok: true, pageId: "p" }));
    expect(r.ok).toBe(false);
  });
});
