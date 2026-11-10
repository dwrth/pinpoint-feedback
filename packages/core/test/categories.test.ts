import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CategoryConfigError,
  DEFAULT_CATEGORIES,
  defineCategories,
  resolveCategories,
  type CategoryId,
} from "../src/categories";

describe("categories", () => {
  it("resolves built-in ids and custom definitions", () => {
    expect(resolveCategories()).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(resolveCategories(["bug", { id: "perf", label: " Performance ", color: "orange" }])).toEqual([
      { id: "bug", label: "Bug", color: "red", emoji: "🐞" },
      { id: "perf", label: "Performance", color: "orange" },
    ]);
  });

  it.each([
    [[], /non-empty/],
    [["nope"], /not a built-in/],
    [[{ id: "has space", label: "x" }], /id must match/],
    [[{ id: "a", label: "" }], /label/],
    [[{ id: "a", label: "a, b" }], /commas/],
    [[{ id: "a", label: "A" }, { id: "a", label: "B" }], /duplicate/],
  ])("rejects invalid config %#", (list, message) => {
    expect(() => resolveCategories(list as never)).toThrow(CategoryConfigError);
    expect(() => resolveCategories(list as never)).toThrow(message);
  });

  it("preserves literal id types", () => {
    const cats = defineCategories(["bug", { id: "perf", label: "Performance" }, { id: "a11y", label: "Accessibility" }]);
    expectTypeOf<CategoryId<typeof cats>>().toEqualTypeOf<"bug" | "perf" | "a11y">();
    expectTypeOf<CategoryId<typeof DEFAULT_CATEGORIES>>().toEqualTypeOf<"bug" | "design" | "content" | "feature" | "other">();
  });

  it("throws eagerly from defineCategories", () => {
    expect(() => defineCategories([{ id: "x", label: "" }])).toThrow(CategoryConfigError);
  });
});
