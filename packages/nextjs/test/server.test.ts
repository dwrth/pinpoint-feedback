import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFeedbackRequestHandler: vi.fn(),
  inner: vi.fn(async () => Response.json({ ok: true }, { status: 201 })),
}));

vi.mock("server-only", () => ({}));

vi.mock("@pinpoint-feedback/server", async () => {
  const actual = await vi.importActual<typeof import("@pinpoint-feedback/server")>("@pinpoint-feedback/server");
  return {
    ...actual,
    createFeedbackRequestHandler: mocks.createFeedbackRequestHandler,
  };
});

import { createFeedbackHandler, createFeedbackRouteHandlers } from "../src/server";

const DB_ID = "0123456789abcdef0123456789abcdef";
const DB_UUID = "01234567-89ab-cdef-0123-456789abcdef";
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const request = () => new Request("http://localhost/api/feedback", { method: "POST", body: "{}" });

describe("createFeedbackHandler", () => {
  beforeEach(() => {
    mocks.createFeedbackRequestHandler.mockReset().mockImplementation(() => mocks.inner);
    mocks.inner.mockClear();
    vi.stubEnv("NOTION_API_KEY", "");
    vi.stubEnv("NOTION_FEEDBACK_DATABASE_ID", "");
    vi.stubEnv("NOTION_API_BASE_URL", "");
    vi.stubEnv("PINPOINT_PROJECT_ID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not read the environment or build the handler until the first request", async () => {
    const handler = createFeedbackHandler({ logger: silent });
    expect(mocks.createFeedbackRequestHandler).not.toHaveBeenCalled();

    vi.stubEnv("NOTION_API_KEY", "secret_lazy");
    vi.stubEnv("NOTION_FEEDBACK_DATABASE_ID", DB_ID);
    const res = await handler(request());

    expect(res.status).toBe(201);
    expect(mocks.createFeedbackRequestHandler).toHaveBeenCalledTimes(1);
    const opts = mocks.createFeedbackRequestHandler.mock.calls[0]![0];
    expect(opts.notion).toMatchObject({ apiKey: "secret_lazy", databaseId: DB_UUID });
  });

  it("returns a 500 misconfigured JSON response when env vars are missing", async () => {
    const handler = createFeedbackHandler({ logger: silent });
    const res = await handler(request());

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: { code: "misconfigured", retryable: false } });
    expect(JSON.stringify(body)).not.toMatch(/NOTION_API_KEY/);
    expect(silent.error).toHaveBeenCalledWith(expect.stringMatching(/NOTION_API_KEY/));
    expect(mocks.createFeedbackRequestHandler).not.toHaveBeenCalled();
  });

  it("recovers once the environment becomes available", async () => {
    const handler = createFeedbackHandler({ logger: silent });
    expect((await handler(request())).status).toBe(500);

    vi.stubEnv("NOTION_API_KEY", "secret_late");
    vi.stubEnv("NOTION_FEEDBACK_DATABASE_ID", DB_ID);
    expect((await handler(request())).status).toBe(201);
  });

  it("forwards the shared category list to the request handler", async () => {
    vi.stubEnv("NOTION_API_KEY", "secret_x");
    vi.stubEnv("NOTION_FEEDBACK_DATABASE_ID", DB_ID);
    const categories = ["bug", { id: "perf", label: "Performance", color: "orange" }] as const;
    await createFeedbackHandler({ logger: silent, categories })(request());
    expect(mocks.createFeedbackRequestHandler.mock.calls[0]![0].categories).toBe(categories);
  });

  it("creates the underlying handler once and reuses it", async () => {
    vi.stubEnv("NOTION_API_KEY", "secret_x");
    vi.stubEnv("NOTION_FEEDBACK_DATABASE_ID", DB_ID);
    const handler = createFeedbackHandler({ logger: silent });

    await handler(request());
    await handler(request());
    await handler(request());

    expect(mocks.createFeedbackRequestHandler).toHaveBeenCalledTimes(1);
    expect(mocks.inner).toHaveBeenCalledTimes(3);
  });

  it("passes options through and lets them override env values", async () => {
    vi.stubEnv("NOTION_API_KEY", "secret_env");
    vi.stubEnv("NOTION_FEEDBACK_DATABASE_ID", DB_ID);
    vi.stubEnv("NOTION_API_BASE_URL", "http://127.0.0.1:3999");
    vi.stubEnv("PINPOINT_PROJECT_ID", "env-project");

    const rateLimit = { max: 5, windowMs: 60_000 };
    const handler = createFeedbackHandler({
      notion: { apiKey: "secret_option", databaseId: DB_ID, autoSetupSchema: false },
      projectId: "option-project",
      allowedOrigins: ["https://example.com"],
      maxFileBytes: 1234,
      rateLimit,
      logger: silent,
    } as Parameters<typeof createFeedbackHandler>[0]);
    await handler(request());

    const opts = mocks.createFeedbackRequestHandler.mock.calls[0]![0];
    expect(opts).toMatchObject({
      notion: { apiKey: "secret_option", databaseId: DB_ID, baseUrl: "http://127.0.0.1:3999", autoSetupSchema: false },
      projectId: "option-project",
      allowedOrigins: ["https://example.com"],
      maxFileBytes: 1234,
      rateLimit,
    });
    expect(opts).not.toHaveProperty("env");
  });

  it("uses PINPOINT_PROJECT_ID and NOTION_API_BASE_URL from env", async () => {
    vi.stubEnv("NOTION_API_KEY", "secret_env");
    vi.stubEnv("NOTION_FEEDBACK_DATABASE_ID", DB_ID);
    vi.stubEnv("NOTION_API_BASE_URL", "http://127.0.0.1:3999");
    vi.stubEnv("PINPOINT_PROJECT_ID", "env-project");
    await createFeedbackHandler({ logger: silent })(request());

    const opts = mocks.createFeedbackRequestHandler.mock.calls[0]![0];
    expect(opts.projectId).toBe("env-project");
    expect(opts.notion.baseUrl).toBe("http://127.0.0.1:3999");
    expect(opts.notion).not.toHaveProperty("projectId");
  });

  it("works with explicit Notion options and no env at all", async () => {
    const handler = createFeedbackHandler({ notion: { apiKey: "secret_o", databaseId: DB_ID }, logger: silent });
    expect((await handler(request())).status).toBe(201);
  });

  it("reads from a custom env object", async () => {
    const handler = createFeedbackHandler({
      env: { NOTION_API_KEY: "secret_custom", NOTION_FEEDBACK_DATABASE_ID: DB_ID },
      logger: silent,
    });
    await handler(request());
    expect(mocks.createFeedbackRequestHandler.mock.calls[0]![0].notion.apiKey).toBe("secret_custom");
  });

  it("skips Notion env resolution when a custom backend is given", async () => {
    const backend = { createRecord: vi.fn() };
    await createFeedbackHandler({ backend, logger: silent })(request());
    const opts = mocks.createFeedbackRequestHandler.mock.calls[0]![0];
    expect(opts.backend).toBe(backend);
    expect(opts.notion).toBeUndefined();
  });

  it("returns misconfigured when the underlying handler cannot be created", async () => {
    mocks.createFeedbackRequestHandler.mockImplementation(() => {
      throw new Error("bad options");
    });
    vi.stubEnv("NOTION_API_KEY", "secret_x");
    vi.stubEnv("NOTION_FEEDBACK_DATABASE_ID", DB_ID);
    const res = await createFeedbackHandler({ logger: silent })(request());
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("misconfigured");
  });

  it("createFeedbackRouteHandlers shares one handler between POST and OPTIONS", async () => {
    vi.stubEnv("NOTION_API_KEY", "secret_x");
    vi.stubEnv("NOTION_FEEDBACK_DATABASE_ID", DB_ID);
    const { POST, OPTIONS } = createFeedbackRouteHandlers({ logger: silent });
    expect(POST).toBe(OPTIONS);
    await POST(request());
    await OPTIONS(new Request("http://localhost/api/feedback", { method: "OPTIONS" }));
    expect(mocks.createFeedbackRequestHandler).toHaveBeenCalledTimes(1);
  });
});
