import { defineCategories, defineLocale, en, type BuiltinCategoryId, type CategoryList } from "@pinpoint-feedback/core";
import type { ComponentProps } from "react";
import { describe, expectTypeOf, it } from "vitest";
import { FeedbackProvider, FeedbackWidget, type FeedbackProviderProps } from "../src";

const shared = defineCategories(["bug", { id: "perf", label: "Performance", color: "orange", emoji: "⚡" }, "feature"]);

const rtl = defineLocale({ ...en, locale: "ar", dir: "rtl" });

// @ts-expect-error a translation must contain every section
defineLocale({ locale: "xx", dir: "ltr", widget: en.widget, editor: en.editor, capture: en.capture });
// @ts-expect-error a translation must contain every key
defineLocale({ ...en, locale: "xx", widget: { "launcher.label": "X" } });

/** Never rendered: these lines exist for `tsc --noEmit`. */
export function typeChecks() {
  return (
    <>
      <FeedbackProvider />
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

      <FeedbackProvider locale={en} />
      <FeedbackProvider locale={[en, rtl]} />
      <FeedbackProvider messages={{ widget: { "dialog.title": "Report a problem" }, editor: { "pin.added": "Pin {number}!" } }} />
      <FeedbackProvider messages={{ capture: { "warning.unknown": { other: "# missing" } } }} />
      {/* @ts-expect-error unknown widget message key */}
      <FeedbackProvider messages={{ widget: { "dialog.titel": "Typo" } }} />
      {/* @ts-expect-error unknown section */}
      <FeedbackProvider messages={{ footer: {} }} />
      {/* @ts-expect-error messages are strings */}
      <FeedbackProvider messages={{ widget: { "dialog.title": 42 } }} />
      {/* @ts-expect-error locale must be a bundle, not a tag */}
      <FeedbackProvider locale="de" />

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
