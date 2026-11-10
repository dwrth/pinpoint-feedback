import type { CaptureMessages } from "./capture";
import type { EditorMessages } from "./editor";
import type { DeepPartial } from "./format";
import type { ReportMessages } from "./report";
import type { WidgetMessages } from "./widget";

export type TextDirection = "ltr" | "rtl";

/**
 * Everything user-facing for one language. Built-in bundles are published as separate
 * entry points (`pinpoint-feedback/locales/<tag>`) so apps only ship the languages they use.
 */
export interface LocaleBundle {
  /** BCP 47 tag, e.g. "de", "pt-BR", "zh-CN". Also used for Intl formatting. */
  locale: string;
  dir: TextDirection;
  /** React widget UI. */
  widget: WidgetMessages;
  /** Annotation editor: screen-reader announcements and labels. */
  editor: EditorMessages;
  /** Capture placeholders drawn into the screenshot and capture warnings. */
  capture: CaptureMessages;
  /** Notion page body written by the server. */
  report: ReportMessages;
}

export type LocaleOverrides = DeepPartial<Omit<LocaleBundle, "locale" | "dir">>;

/** Identity helper that type-checks a complete translation. */
export function defineLocale<const T extends LocaleBundle>(bundle: T): T {
  return bundle;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns `base` with `overrides` applied section by section. Unknown keys are ignored. */
export function mergeLocale(base: LocaleBundle, overrides?: LocaleOverrides): LocaleBundle {
  if (!overrides) return base;
  const out: Record<string, unknown> = { ...base };
  for (const section of ["widget", "editor", "capture", "report"] as const) {
    const patch = overrides[section];
    if (!isPlainObject(patch)) continue;
    const merged: Record<string, unknown> = { ...(base[section] as Record<string, unknown>) };
    for (const [key, value] of Object.entries(patch)) {
      if (key in merged && value !== undefined) merged[key] = value;
    }
    out[section] = merged;
  }
  return out as unknown as LocaleBundle;
}

/**
 * Chooses the best available locale for the requested tags: exact match first, then
 * language-only match (e.g. "de-AT" → "de", "pt" → "pt-BR"). Matching is case-insensitive.
 */
export function negotiateLocale(available: readonly string[], requested: readonly string[], fallback = "en"): string {
  const lower = available.map((tag) => tag.toLowerCase());
  for (const raw of requested) {
    if (!raw) continue;
    const tag = raw.toLowerCase();
    const exact = lower.indexOf(tag);
    if (exact !== -1) return available[exact]!;
    const lang = tag.split("-")[0]!;
    const byLang = lower.findIndex((a) => a === lang || a.split("-")[0] === lang);
    if (byLang !== -1) return available[byLang]!;
  }
  return fallback;
}

/** Locale tags preferred by the current page: `<html lang>` first, then the browser languages. */
export function detectPreferredLocales(): string[] {
  const tags: string[] = [];
  if (typeof document !== "undefined" && document.documentElement?.lang) tags.push(document.documentElement.lang);
  if (typeof navigator !== "undefined") {
    if (Array.isArray(navigator.languages)) tags.push(...navigator.languages);
    else if (navigator.language) tags.push(navigator.language);
  }
  return tags;
}
