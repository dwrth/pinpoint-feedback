import { describe, expect, expectTypeOf, it } from "vitest";
import { localizedCategoryLabel } from "../src/categories";
import { en } from "../src/i18n/en";
import { createTranslator, formatMessage, type MessagesOf } from "../src/i18n/format";
import { mergeLocale, negotiateLocale } from "../src/i18n/bundle";

describe("formatMessage", () => {
  it("interpolates and formats numbers per locale", () => {
    expect(formatMessage("en", "Retrying in {seconds}s", { seconds: 3 })).toBe("Retrying in 3s");
    expect(formatMessage("de", "{n} Bytes", { n: 1234567 })).toBe("1.234.567 Bytes");
    expect(formatMessage("en", "Hi {missing}")).toBe("Hi {missing}");
  });

  it("selects CLDR plural forms", () => {
    const iframes = { one: "# iframe", other: "# iframes" };
    expect(formatMessage("en", iframes, { count: 1 })).toBe("1 iframe");
    expect(formatMessage("en", iframes, { count: 2 })).toBe("2 iframes");
    const pl = { one: "# ramka", few: "# ramki", many: "# ramek", other: "# ramki" };
    expect(formatMessage("pl", pl, { count: 3 })).toBe("3 ramki");
    expect(formatMessage("pl", pl, { count: 5 })).toBe("5 ramek");
    expect(formatMessage("ar", { zero: "لا شيء", other: "# عناصر" }, { count: 0 })).toBe("لا شيء");
  });
});

describe("createTranslator", () => {
  const source = { hello: "Hello {name}", plain: "Plain", items: { one: "# item in {where}", other: "# items in {where}" } } as const;
  const t = createTranslator<typeof source>("en", source as MessagesOf<typeof source>);

  it("translates with typed params", () => {
    expect(t("hello", { name: "Ada" })).toBe("Hello Ada");
    expect(t("plain")).toBe("Plain");
    expect(t("items", { count: 2, where: "cart" })).toBe("2 items in cart");
  });

  it("enforces placeholders at the type level", () => {
    // @ts-expect-error missing params
    t("hello");
    // @ts-expect-error unexpected params
    t("plain", { x: 1 });
    // @ts-expect-error unknown key
    t("nope");
    expectTypeOf<MessagesOf<typeof source>["items"]>().toMatchTypeOf<{ other: string }>();
  });
});

describe("negotiateLocale", () => {
  const available = ["en", "de", "pt-BR", "zh-CN"];
  it.each([
    [["de-AT"], "de"],
    [["pt"], "pt-BR"],
    [["zh-cn"], "zh-CN"],
    [["fr", "de"], "de"],
    [["fr"], "en"],
    [[], "en"],
  ])("%j → %s", (requested, expected) => {
    expect(negotiateLocale(available, requested)).toBe(expected);
  });
});

describe("mergeLocale", () => {
  it("applies known overrides only and keeps the base intact", () => {
    const merged = mergeLocale(en, { widget: { nope: "x" } as never });
    expect(merged).toEqual(en);
    expect(mergeLocale(en)).toBe(en);
  });
});

describe("localizedCategoryLabel", () => {
  const cat = { id: "perf", label: "Performance", labels: { de: "Leistung", "pt-BR": "Desempenho" } };
  it("falls back from exact tag to language to label", () => {
    expect(localizedCategoryLabel(cat, "de-AT")).toBe("Leistung");
    expect(localizedCategoryLabel(cat, "pt-br")).toBe("Desempenho");
    expect(localizedCategoryLabel(cat, "pt")).toBe("Desempenho");
    expect(localizedCategoryLabel(cat, "fr")).toBe("Performance");
  });
});
