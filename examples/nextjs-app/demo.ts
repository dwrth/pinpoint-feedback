import type { FeedbackBackend, LocaleOverrides } from "pinpoint-feedback";

/**
 * Without Notion credentials the hosted demo still runs the whole flow (capture, annotation,
 * server-side validation, spam and rate-limit checks) but stores nothing, and says so.
 */
export function isDemoMode(env: Record<string, string | undefined> = process.env): boolean {
  return !(env.NOTION_API_KEY && env.NOTION_FEEDBACK_DATABASE_ID);
}

export const demoBackend: FeedbackBackend = {
  async createRecord({ submission }) {
    return { id: `demo-${submission.submissionId}`, duplicate: false };
  },
};

type DemoTexts = { title: string; thanks: string; announcement: string };

const texts: Record<string, DemoTexts> = {
  en: {
    title: "Demo: not stored",
    thanks: "This demo validated your report but doesn't send it to Notion.",
    announcement: "Demo report validated. Nothing was stored.",
  },
  de: {
    title: "Demo: nicht gespeichert",
    thanks: "Diese Demo hat den Bericht geprüft, sendet ihn aber nicht an Notion.",
    announcement: "Demo-Bericht geprüft. Es wurde nichts gespeichert.",
  },
  fr: {
    title: "Démo : non enregistré",
    thanks: "Cette démo a validé votre rapport mais ne l’envoie pas à Notion.",
    announcement: "Rapport de démo validé. Rien n’a été enregistré.",
  },
  es: {
    title: "Demo: no guardado",
    thanks: "Esta demo validó tu informe, pero no lo envía a Notion.",
    announcement: "Informe de demo validado. No se guardó nada.",
  },
  it: {
    title: "Demo: non salvato",
    thanks: "Questa demo ha convalidato la segnalazione ma non la invia a Notion.",
    announcement: "Segnalazione demo convalidata. Non è stato salvato nulla.",
  },
  "pt-BR": {
    title: "Demo: não salvo",
    thanks: "Esta demo validou seu relato, mas não o envia ao Notion.",
    announcement: "Relato de demo validado. Nada foi salvo.",
  },
  nl: {
    title: "Demo: niet opgeslagen",
    thanks: "Deze demo heeft je melding gecontroleerd, maar stuurt hem niet naar Notion.",
    announcement: "Demomelding gecontroleerd. Er is niets opgeslagen.",
  },
  pl: {
    title: "Demo: nie zapisano",
    thanks: "To demo sprawdziło zgłoszenie, ale nie wysyła go do Notion.",
    announcement: "Zgłoszenie demo sprawdzone. Nic nie zapisano.",
  },
  ja: {
    title: "デモ：保存されていません",
    thanks: "このデモはレポートを検証しましたが、Notion には送信しません。",
    announcement: "デモのレポートを検証しました。何も保存されていません。",
  },
  "zh-CN": {
    title: "演示：未保存",
    thanks: "此演示已验证你的反馈，但不会发送到 Notion。",
    announcement: "演示反馈已验证，未保存任何内容。",
  },
  ar: {
    title: "عرض تجريبي: لم يُحفظ",
    thanks: "تحقّق هذا العرض التجريبي من بلاغك لكنه لا يرسله إلى Notion.",
    announcement: "تم التحقق من البلاغ التجريبي. لم يُحفظ أي شيء.",
  },
};

export function demoMessages(locale: string): LocaleOverrides {
  const t = texts[locale] ?? texts.en!;
  return { widget: { "success.title": t.title, "success.thanks": t.thanks, "success.announcement": t.announcement } };
}

export function withDemoMessages(locale: string, overrides: LocaleOverrides | undefined): LocaleOverrides {
  const demo = demoMessages(locale);
  return { ...overrides, widget: { ...overrides?.widget, ...demo.widget } };
}
