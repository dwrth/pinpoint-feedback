import { defineCategories, en, type BuiltinCategoryId, type CategoryList } from "@pinpoint-feedback/core";
import type { ComponentProps } from "react";
import { describe, expectTypeOf, it } from "vitest";
import { FeedbackProvider, FeedbackWidget, type FeedbackProviderProps } from "../src/index";

const shared = defineCategories(["bug", { id: "perf", label: "Performance", color: "orange", emoji: "⚡" }, "feature"]);

/** Never rendered: these lines exist for `tsc --noEmit`. */
export function typeChecks() {
  return (
    <>
      <FeedbackProvider />
      <FeedbackProvider maxFileBytes={20 * 1024 * 1024} />
      <FeedbackProvider defaultCategory="design" />
      {/* @ts-expect-error not a built-in category */}
      <FeedbackProvider defaultCategory="perf" />

      <FeedbackProvider categories={["bug", "design"]} defaultCategory="design" />
      {/* @ts-expect-error not in the list */}
      <FeedbackProvider categories={["bug", "design"]} defaultCategory="content" />
      {/* @ts-expect-error unknown built-in id */}
      <FeedbackProvider categories={["bug", "nope"]} />

      <FeedbackProvider categories={[{ id: "perf", label: "Performance" }, "bug"]} defaultCategory="perf" />
      <FeedbackProvider categories={[{ id: "perf", label: "Performance" }, "bug"]} defaultCategory="bug" />
      {/* @ts-expect-error not in the list */}
      <FeedbackProvider categories={[{ id: "perf", label: "Performance" }, "bug"]} defaultCategory="nope" />
      {/* @ts-expect-error invalid color */}
      <FeedbackProvider categories={[{ id: "perf", label: "Performance", color: "teal" }]} />
      {/* @ts-expect-error label is required */}
      <FeedbackProvider categories={[{ id: "perf" }]} />

      <FeedbackProvider categories={shared} defaultCategory="perf">
        <main />
      </FeedbackProvider>
      {/* @ts-expect-error not in the shared list */}
      <FeedbackProvider categories={shared} defaultCategory="design" />

      <FeedbackProvider categories={shared} defaultCategory="perf" locale={[en]} messages={{ widget: { "launcher.label": "Report" } }} />
      {/* @ts-expect-error unknown widget message key */}
      <FeedbackProvider messages={{ widget: { "launcher.labl": "Report" } }} />

      <FeedbackWidget categories={shared} defaultCategory="feature" />
      {/* @ts-expect-error not in the shared list */}
      <FeedbackWidget categories={shared} defaultCategory="other" />
    </>
  );
}

describe("category prop types", () => {
  it("infers category ids", () => {
    expectTypeOf<FeedbackProviderProps["defaultCategory"]>().toEqualTypeOf<BuiltinCategoryId | undefined>();
    expectTypeOf<FeedbackProviderProps<typeof shared>["defaultCategory"]>().toEqualTypeOf<
      "bug" | "perf" | "feature" | undefined
    >();
    expectTypeOf<FeedbackProviderProps<CategoryList>["defaultCategory"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ComponentProps<typeof FeedbackProvider>>().toHaveProperty("categories");
  });
});
