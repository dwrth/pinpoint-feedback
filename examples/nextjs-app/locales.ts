import { negotiateLocale, type LocaleBundle, type LocaleOverrides } from "pinpoint-feedback";
import en from "pinpoint-feedback/locales/en";
import ar from "pinpoint-feedback/locales/ar";
import de from "pinpoint-feedback/locales/de";
import es from "pinpoint-feedback/locales/es";
import fr from "pinpoint-feedback/locales/fr";
import it from "pinpoint-feedback/locales/it";
import ja from "pinpoint-feedback/locales/ja";
import nl from "pinpoint-feedback/locales/nl";
import pl from "pinpoint-feedback/locales/pl";
import ptBR from "pinpoint-feedback/locales/pt-BR";
import zhCN from "pinpoint-feedback/locales/zh-CN";

/** Request header through which proxy.ts forwards `?lang=`. */
export const LANG_HEADER = "x-demo-lang";

/**
 * Widget languages offered by the demo. Each built-in language is its own entry point, so
 * only the imported ones are bundled, e.g. `import de from "pinpoint-feedback/locales/de"`.
 */
export const locales: readonly LocaleBundle[] = [en, de, fr, es, it, ptBR, nl, pl, ja, zhCN, ar];

/** Per-language tweaks applied on top of the built-in texts (`messages` prop). */
export const messageOverrides: Partial<Record<string, LocaleOverrides>> = {
  en: { widget: { "field.titlePlaceholder": "e.g. The revenue chart legend overlaps the data" } },
};

function parseAcceptLanguage(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => part.split(";")[0]!.trim())
    .filter((tag) => tag && tag !== "*");
}

/** Picks the page language from `?lang=` (forwarded by proxy.ts), then the Accept-Language header. */
export function pickLocale(requested: string | null, acceptLanguage: string | null): LocaleBundle {
  const preferred = [...(requested ? [requested] : []), ...parseAcceptLanguage(acceptLanguage)];
  const tag = negotiateLocale(
    locales.map((bundle) => bundle.locale),
    preferred,
    "en",
  );
  return locales.find((bundle) => bundle.locale === tag) ?? en;
}
