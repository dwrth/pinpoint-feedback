import {
  createTranslator,
  detectPreferredLocales,
  en,
  mergeLocale,
  negotiateLocale,
  type LocaleBundle,
  type LocaleOverrides,
  type SubmissionFailure,
  type Translate,
} from "@pinpoint-feedback/core";
import { createContext, useContext, useMemo } from "react";
import type { DraftField, FieldErrors } from "./draft";

export type WidgetTranslate = Translate<typeof en.widget>;

export interface WidgetI18n {
  bundle: LocaleBundle;
  locale: string;
  t: WidgetTranslate;
}

function sections(bundle: LocaleBundle): LocaleOverrides {
  return { widget: bundle.widget, editor: bundle.editor, capture: bundle.capture, report: bundle.report };
}

/**
 * Picks the bundle for `locale`: a single bundle is used as is; for an array the page's
 * preferred languages are negotiated against the bundles' tags (English is always available).
 * Missing keys fall back to English, then `messages` overrides are applied.
 */
export function resolveLocaleBundle(
  locale: LocaleBundle | readonly LocaleBundle[] | undefined,
  messages?: LocaleOverrides,
  preferred: readonly string[] = detectPreferredLocales(),
): LocaleBundle {
  let selected: LocaleBundle = en;
  if (Array.isArray(locale)) {
    const bundles = locale as readonly LocaleBundle[];
    const tags = bundles.map((b) => b.locale);
    if (!tags.some((tag) => tag.toLowerCase() === "en")) tags.push("en");
    const tag = negotiateLocale(tags, preferred, "en");
    selected = bundles.find((b) => b.locale === tag) ?? en;
  } else if (locale) {
    selected = locale as LocaleBundle;
  }
  const complete =
    selected === en ? en : { ...mergeLocale(en, sections(selected)), locale: selected.locale, dir: selected.dir };
  return mergeLocale(complete, messages);
}

function createI18n(bundle: LocaleBundle): WidgetI18n {
  return { bundle, locale: bundle.locale, t: createTranslator<typeof en.widget>(bundle.locale, bundle.widget) };
}

function contentKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

/** Resolves the widget's locale, memoised on content so inline arrays and objects are cheap. */
export function useWidgetI18n(
  locale: LocaleBundle | readonly LocaleBundle[] | undefined,
  messages: LocaleOverrides | undefined,
): WidgetI18n {
  const localeKey = Array.isArray(locale)
    ? (locale as readonly LocaleBundle[]).map((b) => b.locale).join(",")
    : (locale as LocaleBundle | undefined)?.locale ?? "";
  const messagesKey = contentKey(messages);
  return useMemo(() => createI18n(resolveLocaleBundle(locale, messages)), [localeKey, messagesKey]);
}

const I18nContext = createContext<WidgetI18n>(createI18n(en));

export const I18nProvider = I18nContext.Provider;

export function useI18n(): WidgetI18n {
  return useContext(I18nContext);
}

const ERROR_KEYS = {
  network: "error.network",
  timeout: "error.timeout",
  validation: "error.validation",
  rate_limited: "error.rateLimited",
  payload_too_large: "error.payloadTooLarge",
  unsupported_media_type: "error.unsupportedMediaType",
  spam: "error.spam",
  notion_unauthorized: "error.notionUnauthorized",
  notion_not_found: "error.notionNotFound",
  notion_error: "error.notionError",
  server_error: "error.serverError",
  misconfigured: "error.misconfigured",
} as const satisfies Record<SubmissionFailure["error"]["code"], keyof typeof en.widget>;

/** Localized text for a submission error; the server's (English) message is only used for unknown codes. */
export function submissionErrorMessage(t: WidgetTranslate, error: SubmissionFailure["error"]): string {
  const key = (ERROR_KEYS as Record<string, (typeof ERROR_KEYS)[keyof typeof ERROR_KEYS] | undefined>)[error.code];
  if (key) return t(key);
  return error.message || t("error.unknown");
}

const FIELD_BY_PATH: Record<string, DraftField> = {
  title: "title",
  description: "description",
  name: "name",
  email: "email",
  "reporter.name": "name",
  "reporter.email": "email",
};

function fieldMessage(t: WidgetTranslate, field: DraftField, serverMessage: string): string {
  const max = /at most (\d+)/.exec(serverMessage)?.[1];
  if (max) return t(`validation.${field}TooLong`, { max: Number(max) });
  if (field === "title" && /required/.test(serverMessage)) return t("validation.titleRequired");
  return t(`validation.${field}Invalid`);
}

/** Maps server validation issues (`details` as `{ issues }` or a bare array) to localized field errors. */
export function fieldErrorsFromDetails(t: WidgetTranslate, details: unknown): FieldErrors {
  const errors: FieldErrors = {};
  const issues =
    details && typeof details === "object" && "issues" in details ? (details as { issues: unknown }).issues : details;
  if (!Array.isArray(issues)) return errors;
  for (const issue of issues) {
    if (!issue || typeof issue !== "object") continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    if (typeof path !== "string") continue;
    const field = FIELD_BY_PATH[path];
    if (field && !errors[field]) errors[field] = fieldMessage(t, field, typeof message === "string" ? message : "");
  }
  return errors;
}
