import { describe, expect, it } from "vitest";
import { createId, isUuid } from "../src/ids";
import { LIMITS } from "../src/limits";
import { sanitizeText, validateSubmission } from "../src/validation";

function valid(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: createId(),
    title: "  Button is misaligned  ",
    description: "On the pricing page",
    category: "bug",
    priority: "high",
    metadata: {
      url: "https://example.com/pricing?x=1",
      pageTitle: "Pricing",
      userAgent: "UA",
      browser: { name: "Chrome", version: "130" },
      os: { name: "macOS" },
      viewport: { width: 1440, height: 900 },
      screen: { width: 1728, height: 1117 },
      devicePixelRatio: 2,
    },
    annotations: [
      { id: "a", type: "pin", color: "#ef4444", strokeWidth: 3, at: { x: 10, y: 20 }, number: 1 },
      { id: "b", type: "rectangle", color: "#ef4444", strokeWidth: 3, x: 1, y: 2, width: 30, height: 40 },
      { id: "c", type: "freehand", color: "rgb(1,2,3)", strokeWidth: 3, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      { id: "d", type: "arrow", color: "#000", strokeWidth: 3, from: { x: 0, y: 0 }, to: { x: 5, y: 5 } },
      { id: "e", type: "text", color: "#000", strokeWidth: 3, at: { x: 0, y: 0 }, text: "hi", fontSize: 16 },
    ],
    createdAt: "2026-11-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("ids", () => {
  it("creates v4 uuids", () => {
    const ids = new Set(Array.from({ length: 100 }, createId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(isUuid(id)).toBe(true);
    expect(isUuid("nope")).toBe(false);
  });
});

describe("validateSubmission", () => {
  it("accepts and normalises a valid payload", () => {
    const r = validateSubmission(valid());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe("Button is misaligned");
    expect(r.value.annotations).toHaveLength(5);
    expect(r.value.metadata.url).toBe("https://example.com/pricing?x=1");
    expect(r.value.reporter).toBeUndefined();
  });

  it("rejects non-objects", () => {
    expect(validateSubmission(null).ok).toBe(false);
    expect(validateSubmission([]).ok).toBe(false);
  });

  it.each([
    ["submissionId", "x"],
    ["title", ""],
    ["title", "   "],
    ["title", "a".repeat(LIMITS.titleMax + 1)],
    ["category", "nope"],
    ["priority", "urgent"],
    ["metadata", undefined],
  ])("rejects invalid %s", (key, value) => {
    const r = validateSubmission(valid({ [key]: value }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path.startsWith(key))).toBe(true);
  });

  it("rejects non-http page urls", () => {
    const v = valid();
    (v.metadata as Record<string, unknown>).url = "javascript:alert(1)";
    expect(validateSubmission(v).ok).toBe(false);
  });

  it("validates reporter email but allows anonymous", () => {
    expect(validateSubmission(valid({ reporter: { name: "", email: "" } })).ok).toBe(true);
    expect(validateSubmission(valid({ reporter: { email: "bad" } })).ok).toBe(false);
    const r = validateSubmission(valid({ reporter: { name: "Ada", email: "ada@example.com" } }));
    expect(r.ok && r.value.reporter).toEqual({ name: "Ada", email: "ada@example.com" });
  });

  it("rejects malformed annotations", () => {
    const bad = [
      { id: "x", type: "circle", color: "#000", strokeWidth: 1 },
      { id: "x", type: "pin", color: "url(evil)", strokeWidth: 1, at: { x: 0, y: 0 }, number: 1 },
      { id: "x", type: "pin", color: "#000", strokeWidth: 1, at: { x: Infinity, y: 0 }, number: 1 },
    ];
    for (const a of bad) expect(validateSubmission(valid({ annotations: [a] })).ok).toBe(false);
    expect(validateSubmission(valid({ annotations: new Array(LIMITS.annotationsMax + 1).fill(null) })).ok).toBe(false);
  });

  it("keeps only known capture warnings", () => {
    const r = validateSubmission(
      valid({
        capture: {
          method: "dom",
          width: 100,
          height: 100,
          warnings: [{ code: "cross-origin-iframe", message: "1 iframe", count: 1 }, { code: "bogus", message: "x" }],
        },
      }),
    );
    expect(r.ok && r.value.capture?.warnings).toEqual([{ code: "cross-origin-iframe", message: "1 iframe", count: 1 }]);
  });

  it("sanitises control characters", () => {
    expect(sanitizeText(" a\u0000b\u0007c\n\td ")).toBe("abc\n\td");
  });
});
