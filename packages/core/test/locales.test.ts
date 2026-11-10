import { describe, expect, it } from "vitest";
import type { LocaleBundle } from "../src/i18n/bundle";
import { en } from "../src/i18n/en";
import type { MessageValue } from "../src/i18n/format";

const modules = import.meta.glob<Record<string, unknown>>("../src/locales/*.ts", { eager: true });
const SECTIONS = ["widget", "editor", "capture", "report"] as const;
const RTL = new Set(["ar", "he", "fa", "ur"]);
const PLURAL_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);

function exportName(tag: string): string {
  return tag.replace(/-([a-z0-9])/gi, (_, c: string) => c.toUpperCase());
}

function placeholders(message: MessageValue): string[] {
  const texts = typeof message === "string" ? [message] : Object.values(message);
  const names = new Set<string>();
  for (const text of texts) for (const match of (text ?? "").matchAll(/\{(\w+)\}/g)) names.add(match[1]!);
  return [...names].sort();
}

const entries = Object.entries(modules).map(([path, mod]) => {
  const tag = path.split("/").pop()!.replace(/\.ts$/, "");
  return { tag, mod, bundle: mod.default as LocaleBundle };
});

describe("built-in locales", () => {
  it("include English", () => {
    expect(entries.map((e) => e.tag)).toContain("en");
    expect(modules["../src/locales/en.ts"]!.default).toBe(en);
  });

  describe.each(entries)("$tag", ({ tag, mod, bundle }) => {
    it("exports the bundle as default and as a camel-case named export", () => {
      expect(bundle).toBeTruthy();
      expect(mod[exportName(tag)]).toBe(bundle);
      expect(bundle.locale).toBe(tag);
      expect(bundle.dir).toBe(RTL.has(tag.split("-")[0]!) ? "rtl" : "ltr");
      expect(() => new Intl.PluralRules(bundle.locale)).not.toThrow();
    });

    it.each(SECTIONS)("has exactly the English %s keys with matching placeholders", (section) => {
      const source = en[section] as Record<string, MessageValue>;
      const target = bundle[section] as Record<string, MessageValue>;
      expect(Object.keys(target).sort()).toEqual(Object.keys(source).sort());
      for (const [key, english] of Object.entries(source)) {
        const message = target[key]!;
        expect(typeof message, `${section}.${key}`).toBe(typeof english);
        expect(placeholders(message), `${section}.${key}`).toEqual(placeholders(english));
        if (typeof message === "string") {
          expect(message.trim(), `${section}.${key}`).not.toBe("");
        } else {
          expect(message.other, `${section}.${key}`).toBeTruthy();
          for (const category of Object.keys(message)) expect(PLURAL_CATEGORIES, `${section}.${key}`).toContain(category);
        }
      }
    });
  });
});
