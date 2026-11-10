/**
 * Messages are plain data so locale bundles can cross the React Server Component boundary:
 * - a string with `{name}` placeholders, or
 * - a plural object keyed by CLDR plural category (`one`, `few`, `other`, …) whose strings may use
 *   `#` for the formatted `count` plus `{name}` placeholders.
 */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type MessageValue = string | PluralForms;

/** The type every translation of a catalog must satisfy (same keys, same kinds). */
export type MessagesOf<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : PluralForms;
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

type PlaceholderNames<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | PlaceholderNames<Rest> : never;

/** Placeholder names a message expects, derived from the English source text. */
export type ParamNames<M> = M extends string
  ? PlaceholderNames<M>
  : M extends { other: infer O extends string }
    ? "count" | PlaceholderNames<O>
    : never;

export type MessageParams = Record<string, string | number>;

const pluralRulesCache = new Map<string, Intl.PluralRules>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();

function pluralRules(locale: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

export function formatNumber(locale: string, value: number, options?: Intl.NumberFormatOptions): string {
  if (options) return new Intl.NumberFormat(locale, options).format(value);
  let nf = numberFormatCache.get(locale);
  if (!nf) {
    nf = new Intl.NumberFormat(locale);
    numberFormatCache.set(locale, nf);
  }
  return nf.format(value);
}

export function formatPercent(locale: string, ratio: number): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(ratio);
}

export function formatList(locale: string, items: readonly string[], type: "conjunction" | "disjunction" = "conjunction"): string {
  return new Intl.ListFormat(locale, { style: "long", type }).format(items);
}

/** Formats one message. Numbers are locale-formatted; unknown placeholders are left as-is. */
export function formatMessage(locale: string, message: MessageValue, params: MessageParams = {}): string {
  let template: string;
  if (typeof message === "string") {
    template = message;
  } else {
    const count = Number(params.count ?? 0);
    template = (message[pluralRules(locale).select(count)] ?? message.other).replace(/#/g, formatNumber(locale, count));
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === "number" ? formatNumber(locale, value) : value;
  });
}

export type Translate<Source> = <K extends keyof Source & string>(
  key: K,
  ...args: [ParamNames<Source[K]>] extends [never] ? [] : [params: Record<ParamNames<Source[K]>, string | number>]
) => string;

/**
 * Creates a typed `t(key, params)` for one catalog section. `Source` is the English catalog
 * (literal types), which defines the keys and required placeholders.
 */
export function createTranslator<Source>(locale: string, messages: MessagesOf<Source>): Translate<Source> {
  const table = messages as unknown as Record<string, MessageValue | undefined>;
  return ((key: string, params?: MessageParams) => {
    const message = table[key];
    if (message === undefined) return key;
    return formatMessage(locale, message, params);
  }) as Translate<Source>;
}
