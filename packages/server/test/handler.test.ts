import { APIErrorCode } from "@notionhq/client";
import type { FeedbackBackend, FeedbackRecordInput } from "@pinpoint-feedback/core";
import { describe, expect, it, vi } from "vitest";
import { createFeedbackRequestHandler, type FeedbackHandlerOptions } from "../src/index";
import { FakeNotion, JPEG_BYTES, makeBackend, makeRequest, makeSubmission, notionError, pngBlob, silentLogger } from "./helpers";

function memoryBackend() {
  const inputs: FeedbackRecordInput[] = [];
  const backend: FeedbackBackend = {
    createRecord: vi.fn(async (input: FeedbackRecordInput) => {
      inputs.push(input);
      await new Promise((r) => setTimeout(r, 5));
      return { id: `rec-${inputs.length}`, url: "https://notion.so/rec", duplicate: false };
    }),
  };
  return { backend, inputs };
}

function handler(options: Partial<FeedbackHandlerOptions> = {}) {
  const mem = memoryBackend();
  const h = createFeedbackRequestHandler({ backend: mem.backend, logger: silentLogger, ...options });
  return { h, ...mem };
}

describe("createFeedbackRequestHandler", () => {
  it("creates a record for a valid submission", async () => {
    const onSubmission = vi.fn();
    const { h, inputs } = handler({ onSubmission, projectId: "server-project" });
    const submission = makeSubmission({ projectId: "client-project" });
    const res = await h(makeRequest(submission));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ ok: true, submissionId: submission.submissionId, pageId: "rec-1", pageUrl: "https://notion.so/rec", duplicate: false });
    expect(inputs).toHaveLength(1);
    const input = inputs[0]!;
    expect(input.submission.title).toBe(submission.title);
    expect(input.submission.projectId).toBe("server-project");
    expect(input.screenshot?.contentType).toBe("image/png");
    expect(input.screenshot?.filename).toBe(`pinpoint-${submission.submissionId.slice(0, 8)}-original.png`);
    expect(input.annotatedScreenshot?.filename).toMatch(/-annotated\.png$/);
    expect(onSubmission).toHaveBeenCalledOnce();
  });

  it("accepts submissions without screenshots", async () => {
    const { h, inputs } = handler();
    const res = await h(makeRequest(makeSubmission(), {}));
    expect(res.status).toBe(201);
    expect(inputs[0]!.screenshot).toBeUndefined();
  });

  it("rejects non-POST methods with 405", async () => {
    const { h } = handler();
    const res = await h(new Request("https://shop.example.com/api/feedback", { method: "GET" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("rejects cross-origin requests unless allowed", async () => {
    const { h } = handler();
    const res = await h(makeRequest(makeSubmission(), undefined, { headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
    const same = await h(makeRequest(makeSubmission(), undefined, { headers: { origin: "https://shop.example.com" } }));
    expect(same.status).toBe(201);
  });

  it("supports CORS for allowed origins", async () => {
    const { h } = handler({ allowedOrigins: ["https://app.example.com"] });
    const pre = await h(
      new Request("https://api.example.com/feedback", {
        method: "OPTIONS",
        headers: { origin: "https://app.example.com", "access-control-request-method": "POST" },
      }),
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    const res = await h(makeRequest(makeSubmission(), undefined, { url: "https://api.example.com/feedback", headers: { origin: "https://app.example.com" } }));
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    const bad = await h(makeRequest(makeSubmission(), undefined, { url: "https://api.example.com/feedback", headers: { origin: "https://other.example" } }));
    expect(bad.status).toBe(403);
  });

  it("rejects OPTIONS when CORS is not configured", async () => {
    const { h } = handler();
    const res = await h(new Request("https://shop.example.com/api/feedback", { method: "OPTIONS" }));
    expect(res.status).toBe(405);
  });

  it("requires multipart/form-data", async () => {
    const { h } = handler();
    const res = await h(
      new Request("https://shop.example.com/api/feedback", {
        method: "POST",
        body: JSON.stringify(makeSubmission()),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe("unsupported_media_type");
  });

  it("rejects oversized bodies by content-length and by streamed size", async () => {
    const { h } = handler({ maxFileBytes: 1024 });
    const req = makeRequest(makeSubmission());
    const big = new Request(req.url, { method: "POST", body: "x", headers: { "content-type": req.headers.get("content-type")!, "content-length": String(10 * 1024 * 1024) } });
    expect((await h(big)).status).toBe(413);

    const huge = new Blob([new Uint8Array(600 * 1024)], { type: "image/png" });
    const res = await h(makeRequest(makeSubmission(), { screenshot: huge }));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("payload_too_large");
  });

  it("rejects files above maxFileBytes and advertises the limit and field", async () => {
    const { h } = handler({ maxFileBytes: 32 });
    const big = new Blob([new Uint8Array([...Array.from(pngHeader()), ...new Uint8Array(64)])], { type: "image/png" });
    const res = await h(makeRequest(makeSubmission(), { screenshot: big }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatchObject({ code: "payload_too_large", details: { maxFileBytes: 32, field: "screenshot" } });

    const annotated = await h(makeRequest(makeSubmission(), { screenshot: pngBlob(), annotatedScreenshot: big }));
    expect(annotated.status).toBe(413);
    expect((await annotated.json()).error.details).toEqual({ maxFileBytes: 32, field: "annotatedScreenshot" });
  });

  it("advertises maxFileBytes when the body size guard trips", async () => {
    const { h } = handler({ maxFileBytes: 1024 });
    const req = makeRequest(makeSubmission());
    const big = new Request(req.url, { method: "POST", body: "x", headers: { "content-type": req.headers.get("content-type")!, "content-length": String(10 * 1024 * 1024) } });
    const res = await h(big);
    expect(res.status).toBe(413);
    expect((await res.json()).error.details).toEqual({ maxFileBytes: 1024 });

    const huge = new Blob([new Uint8Array(600 * 1024)], { type: "image/png" });
    const streamed = await h(makeRequest(makeSubmission(), { screenshot: huge }));
    expect((await streamed.json()).error.details).toEqual({ maxFileBytes: 1024 });
  });

  it("accepts an Idempotency-Key equal to the submission ID, ignoring case", async () => {
    const { h, inputs } = handler();
    const submission = makeSubmission();
    const res = await h(makeRequest(submission, undefined, { headers: { "idempotency-key": submission.submissionId.toUpperCase() } }));
    expect(res.status).toBe(201);
    const again = await h(makeRequest(submission, undefined, { headers: { "idempotency-key": submission.submissionId } }));
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true });
    expect(inputs).toHaveLength(1);
  });

  it("rejects an Idempotency-Key that differs from the submission ID", async () => {
    const { h, inputs } = handler();
    const submission = makeSubmission();
    const res = await h(makeRequest(submission, undefined, { headers: { "idempotency-key": makeSubmission().submissionId } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.submissionId).toBe(submission.submissionId);
    expect(body.error).toMatchObject({ code: "validation", retryable: false, details: { issues: [{ path: "submissionId" }] } });
    expect(inputs).toHaveLength(0);
  });

  it("uses the client projectId when the server has none", async () => {
    const { h, inputs } = handler();
    await h(makeRequest(makeSubmission({ projectId: "client-project" })));
    expect(inputs[0]!.submission.projectId).toBe("client-project");
  });

  it("logs each distinct ignored client projectId once", async () => {
    const info = vi.fn();
    const onSubmission = vi.fn();
    const { h, inputs } = handler({ projectId: "server-project", onSubmission, logger: { ...silentLogger, info } });
    for (const projectId of ["a", "a", "b", "server-project", undefined]) {
      await h(makeRequest(makeSubmission(projectId === undefined ? {} : { projectId })));
    }
    expect(inputs.map((i) => i.submission.projectId)).toEqual(Array(5).fill("server-project"));
    expect(onSubmission.mock.calls.map(([s]) => s.projectId)).toEqual(Array(5).fill("server-project"));
    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls.map(([m]) => m)).toEqual([expect.stringContaining('"a"'), expect.stringContaining('"b"')]);
  });

  it("verifies magic bytes instead of trusting the declared type", async () => {
    const { h, inputs } = handler();
    const fake = new Blob(["<svg onload=alert(1)>"], { type: "image/png" });
    const res = await h(makeRequest(makeSubmission(), { screenshot: fake }));
    expect(res.status).toBe(415);

    const svg = new Blob(["<svg/>"], { type: "image/svg+xml" });
    expect((await h(makeRequest(makeSubmission(), { screenshot: svg }))).status).toBe(415);

    const jpegLabelledPng = new Blob([JPEG_BYTES], { type: "image/png" });
    const ok = await h(makeRequest(makeSubmission(), { screenshot: jpegLabelledPng }));
    expect(ok.status).toBe(201);
    expect(inputs[0]!.screenshot?.contentType).toBe("image/jpeg");
    expect(inputs[0]!.screenshot?.filename).toMatch(/\.jpg$/);
  });

  it("returns validation issues", async () => {
    const { h } = handler();
    const res = await h(makeRequest({ ...makeSubmission(), title: "", category: "nope" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation");
    expect(body.error.retryable).toBe(false);
    expect(body.error.details.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(["title", "category"]));

    const notJson = await h(makeRequest("{not json"));
    expect(notJson.status).toBe(400);
  });

  it("rejects honeypot, too-fast and future openedAt submissions as spam", async () => {
    const { h, inputs } = handler();
    const honeypot = await h(makeRequest(makeSubmission({ website: "http://spam" })));
    expect(honeypot.status).toBe(400);
    expect((await honeypot.json()).error.code).toBe("spam");

    const fast = await h(makeRequest(makeSubmission({ openedAt: Date.now() - 100 })));
    expect((await fast.json()).error.code).toBe("spam");

    const future = await h(makeRequest(makeSubmission({ openedAt: Date.now() + 5 * 60_000 })));
    expect((await future.json()).error.code).toBe("spam");
    expect(inputs).toHaveLength(0);
  });

  it("rate limits per client IP with Retry-After", async () => {
    const { h } = handler({ rateLimit: { windowMs: 60_000, max: 2 } });
    expect((await h(makeRequest(makeSubmission()))).status).toBe(201);
    expect((await h(makeRequest(makeSubmission()))).status).toBe(201);
    const limited = await h(makeRequest(makeSubmission()));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = await limited.json();
    expect(body.error).toMatchObject({ code: "rate_limited", retryable: true });
    const other = await h(makeRequest(makeSubmission(), undefined, { headers: { "x-forwarded-for": "198.51.100.1" } }));
    expect(other.status).toBe(201);
  });

  it("creates concurrent duplicates only once and reports later ones as duplicates", async () => {
    const { h, backend } = handler();
    const submission = makeSubmission();
    const results = await Promise.all([1, 2, 3].map(() => h(makeRequest(submission))));
    expect(backend.createRecord).toHaveBeenCalledTimes(1);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 201]);
    const again = await h(makeRequest(submission));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true, pageId: "rec-1" });
    expect(backend.createRecord).toHaveBeenCalledTimes(1);
  });

  it("uses findBySubmissionId of custom backends", async () => {
    const backend: FeedbackBackend = {
      createRecord: vi.fn(),
      findBySubmissionId: vi.fn(async () => ({ id: "existing", duplicate: true })),
    };
    const h = createFeedbackRequestHandler({ backend, logger: silentLogger });
    const res = await h(makeRequest(makeSubmission()));
    expect(res.status).toBe(200);
    expect((await res.json()).pageId).toBe("existing");
    expect(backend.createRecord).not.toHaveBeenCalled();
  });

  it("returns 500 misconfigured without leaking env values", async () => {
    vi.stubEnv("NOTION_API_KEY", "secret_should_not_leak");
    vi.stubEnv("NOTION_FEEDBACK_DATABASE_ID", "");
    try {
      const h = createFeedbackRequestHandler({ logger: silentLogger });
      const res = await h(makeRequest(makeSubmission()));
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text).error.code).toBe("misconfigured");
      expect(text).toContain("NOTION_FEEDBACK_DATABASE_ID");
      expect(text).not.toContain("secret_should_not_leak");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("hides unexpected errors", async () => {
    const backend: FeedbackBackend = { createRecord: async () => { throw new Error("boom at /srv/app.js:12 secret_x"); } };
    const h = createFeedbackRequestHandler({ backend, logger: silentLogger });
    const res = await h(makeRequest(makeSubmission()));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("boom");
    expect(JSON.parse(text).error).toMatchObject({ code: "server_error", retryable: true });
  });
});

function pngHeader() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

describe("handler with the Notion backend", () => {
  const run = async (fake: FakeNotion, submission = makeSubmission()) => {
    const h = createFeedbackRequestHandler({ backend: makeBackend(fake), logger: silentLogger });
    return h(makeRequest(submission));
  };

  it("writes the server projectId to Notion and passes it to onSubmission", async () => {
    const fake = new FakeNotion();
    const onSubmission = vi.fn();
    const notion = { apiKey: "secret_test", databaseId: "0123456789abcdef0123456789abcdef", client: fake.asClient(), logger: silentLogger, throttle: { requestsPerSecond: Infinity, maxConcurrent: 3 } };
    const h = createFeedbackRequestHandler({ notion, projectId: "handler-project", onSubmission, logger: silentLogger });
    expect((await h(makeRequest(makeSubmission({ projectId: "client" })))).status).toBe(201);
    const h2 = createFeedbackRequestHandler({ notion: { ...notion, projectId: "notion-project" }, projectId: "handler-project", logger: silentLogger });
    expect((await h2(makeRequest(makeSubmission({ projectId: "client" })))).status).toBe(201);
    expect(fake.pages.map((p) => p.properties.Project.rich_text[0].text.content)).toEqual(["handler-project", "notion-project"]);
    expect(onSubmission.mock.calls[0]![0].projectId).toBe("handler-project");
  });

  it("happy path creates a Notion page", async () => {
    const fake = new FakeNotion();
    const res = await run(fake);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, pageId: "page-3", pageUrl: "https://www.notion.so/page-3" });
  });

  it("returns duplicate when the Submission ID already exists in Notion", async () => {
    const fake = new FakeNotion();
    const submission = makeSubmission();
    await run(fake, submission);
    const res = await run(fake, submission);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true });
    expect(fake.count("pages.create")).toBe(1);
  });

  it("maps 401 to notion_unauthorized", async () => {
    const fake = new FakeNotion();
    fake.failures["databases.retrieve"] = [notionError(401, APIErrorCode.Unauthorized)];
    const res = await run(fake);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "notion_unauthorized", retryable: false });
    expect(JSON.stringify(body)).not.toContain("secret_test");
  });

  it("maps 404 to notion_not_found with an actionable message", async () => {
    const fake = new FakeNotion();
    fake.failures["databases.retrieve"] = [notionError(404, APIErrorCode.ObjectNotFound)];
    fake.failures["dataSources.retrieve"] = [notionError(404, APIErrorCode.ObjectNotFound)];
    const res = await run(fake);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("notion_not_found");
    expect(body.error.message).toMatch(/Share the database with your integration/);
  });

  it("retries 429 and succeeds", async () => {
    const fake = new FakeNotion();
    fake.failures["pages.create"] = [notionError(429, APIErrorCode.RateLimited, { "retry-after": "0" }), notionError(429, APIErrorCode.RateLimited)];
    const res = await run(fake);
    expect(res.status).toBe(201);
    expect(fake.count("pages.create")).toBe(3);
  });

  it("returns 502 retryable after exhausting retries on 500", async () => {
    const fake = new FakeNotion();
    fake.failures["pages.create"] = Array.from({ length: 4 }, () => notionError(500, APIErrorCode.InternalServerError));
    const res = await run(fake);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: "notion_error", retryable: true });
    expect(fake.count("pages.create")).toBe(4);
  });

  it("does not create twice when a create succeeded but the response was lost", async () => {
    const fake = new FakeNotion();
    const original = fake.pagesApi.create;
    let first = true;
    fake.pagesApi.create = async (args) => {
      const result = await original(args);
      if (first) {
        first = false;
        throw notionError(504, APIErrorCode.GatewayTimeout);
      }
      return result;
    };
    const res = await run(fake);
    expect(res.status).toBe(201);
    expect(fake.pages).toHaveLength(1);
  });
});
