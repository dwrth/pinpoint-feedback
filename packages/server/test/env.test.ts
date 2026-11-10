import { describe, expect, it } from "vitest";
import { MemoryRateLimiter, PinpointConfigError, normalizeNotionId, resolveNotionConfigFromEnv } from "../src/index";

const ID = "0123456789abcdef0123456789abcdef";
const DASHED = "01234567-89ab-cdef-0123-456789abcdef";

describe("normalizeNotionId", () => {
  it("accepts undashed, dashed and URL forms", () => {
    expect(normalizeNotionId(ID)).toBe(DASHED);
    expect(normalizeNotionId(DASHED.toUpperCase())).toBe(DASHED);
    expect(normalizeNotionId(`https://www.notion.so/acme/Feedback-${ID}?v=fedcba9876543210fedcba9876543210`)).toBe(DASHED);
    expect(normalizeNotionId(`https://www.notion.so/${ID}`)).toBe(DASHED);
    expect(normalizeNotionId(`https://www.notion.so/acme/${DASHED}`)).toBe(DASHED);
  });

  it("throws on invalid input", () => {
    expect(() => normalizeNotionId("not-an-id")).toThrow(PinpointConfigError);
  });
});

describe("resolveNotionConfigFromEnv", () => {
  it("reads the configuration", () => {
    expect(
      resolveNotionConfigFromEnv({
        NOTION_API_KEY: "secret_abc",
        NOTION_FEEDBACK_DATABASE_ID: ID,
        NOTION_API_BASE_URL: "http://localhost:4010",
        PINPOINT_PROJECT_ID: "site",
      }),
    ).toEqual({ apiKey: "secret_abc", databaseId: DASHED, baseUrl: "http://localhost:4010", projectId: "site" });
  });

  it("names missing variables without values", () => {
    try {
      resolveNotionConfigFromEnv({ NOTION_FEEDBACK_DATABASE_ID: ID });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PinpointConfigError);
      expect((e as PinpointConfigError).code).toBe("misconfigured");
      expect((e as Error).message).toContain("NOTION_API_KEY");
    }
    expect(() => resolveNotionConfigFromEnv({ NOTION_API_KEY: "secret_abc", NOTION_FEEDBACK_DATABASE_ID: "nope" })).toThrow(
      /NOTION_FEEDBACK_DATABASE_ID/,
    );
  });
});

describe("MemoryRateLimiter", () => {
  it("uses a sliding window and reports retryAfter", () => {
    let now = 0;
    const rl = new MemoryRateLimiter({ windowMs: 10_000, max: 2, now: () => now });
    expect(rl.check("a").allowed).toBe(true);
    now = 4000;
    expect(rl.check("a").allowed).toBe(true);
    const blocked = rl.check("a");
    expect(blocked).toEqual({ allowed: false, retryAfter: 6 });
    now = 10_001;
    expect(rl.check("a").allowed).toBe(true);
  });

  it("defaults to 10 per 10 minutes and bounds memory", () => {
    let now = 0;
    const rl = new MemoryRateLimiter({ now: () => now, maxKeys: 100 });
    for (let i = 0; i < 10; i++) expect(rl.check("x").allowed).toBe(true);
    expect(rl.check("x").allowed).toBe(false);
    for (let i = 0; i < 500; i++) rl.check(`ip-${i}`);
    expect(rl.size).toBeLessThanOrEqual(100);
    now = 11 * 60 * 1000;
    rl.check("fresh");
    expect(rl.size).toBe(1);
  });
});
