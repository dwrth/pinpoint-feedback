import {
  createId,
  LIMITS,
  type BrowserMetadata,
  type FeedbackPriority,
} from "@pinpoint-feedback/core";
import type { WidgetTranslate } from "./i18n";

export interface Draft {
  /** Generated once per draft and reused for every (re)submission attempt: the server's idempotency key. */
  submissionId: string;
  openedAt: number;
  /** Set on the first submit attempt. */
  createdAt?: string;
  metadata: BrowserMetadata;
  title: string;
  description: string;
  /** Category id. */
  category: string;
  priority: FeedbackPriority;
  name: string;
  email: string;
  /** Honeypot. */
  website: string;
}

export type DraftField = "title" | "description" | "name" | "email";
export type FieldErrors = Partial<Record<DraftField, string>>;

export function createDraft(init: {
  category: string;
  priority: FeedbackPriority;
  metadata: BrowserMetadata;
}): Draft {
  return {
    submissionId: createId(),
    openedAt: Date.now(),
    metadata: init.metadata,
    title: "",
    description: "",
    category: init.category,
    priority: init.priority,
    name: "",
    email: "",
    website: "",
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateDraft(draft: Draft, options: { reporterFields: boolean }, t: WidgetTranslate): FieldErrors {
  const errors: FieldErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = t("validation.titleRequired");
  else if (title.length > LIMITS.titleMax) errors.title = t("validation.titleTooLong", { max: LIMITS.titleMax });
  if (draft.description.trim().length > LIMITS.descriptionMax)
    errors.description = t("validation.descriptionTooLong", { max: LIMITS.descriptionMax });
  if (options.reporterFields) {
    if (draft.name.trim().length > LIMITS.nameMax) errors.name = t("validation.nameTooLong", { max: LIMITS.nameMax });
    const email = draft.email.trim();
    if (email.length > LIMITS.emailMax) errors.email = t("validation.emailTooLong", { max: LIMITS.emailMax });
    else if (email && !EMAIL_RE.test(email)) errors.email = t("validation.emailInvalid");
  }
  return errors;
}

export function isDraftDirty(draft: Draft): boolean {
  return Boolean(draft.title.trim() || draft.description.trim() || draft.name.trim() || draft.email.trim());
}
