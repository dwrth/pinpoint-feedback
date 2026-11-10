import { enCapture, type CaptureMessages } from "../i18n/capture";
import { createTranslator, type Translate } from "../i18n/format";
import type { CaptureWarning } from "../types";

export interface CaptureLocaleOptions {
  /** Texts for placeholders and warnings. Default: English (`en.capture`). */
  messages?: CaptureMessages;
  /** BCP 47 tag used for plural rules and number formatting. Default "en". */
  locale?: string;
}

export type CaptureTranslate = Translate<typeof enCapture>;

export function captureTranslator(options: CaptureLocaleOptions = {}): CaptureTranslate {
  return createTranslator<typeof enCapture>(options.locale ?? "en", options.messages ?? enCapture);
}

/**
 * User-facing text for a warning, derived from `code` and `count` only, so that warnings
 * from any capturer can be shown in the reader's language (`warning.message` is not used).
 */
export function formatCaptureWarning(warning: Pick<CaptureWarning, "code" | "count">, options: CaptureLocaleOptions = {}): string {
  const t = captureTranslator(options);
  const count = warning.count ?? 1;
  switch (warning.code) {
    case "cross-origin-iframe":
      return t("warning.crossOriginIframe", { count });
    case "cross-origin-image":
      return t("warning.crossOriginImage", { count });
    case "tainted-canvas":
      return t("warning.taintedCanvas", { count });
    case "video":
      return t("warning.video", { count });
    case "font":
      return t("warning.font");
    case "downscaled":
      return t("warning.downscaled");
    default:
      return warning.count === undefined ? t("warning.unknownGeneric") : t("warning.unknown", { count });
  }
}
