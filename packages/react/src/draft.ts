import {
  createId,
  LIMITS,
  type BrowserMetadata,
  type FeedbackCategory,
  type FeedbackPriority,
} from "@pinpoint-feedback/core";

export interface Draft {
  /** Generated once per draft and reused for every (re)submission attempt: the server's idempotency key. */
  submissionId: string;
  openedAt: number;
  /** Set on the first submit attempt. */
  createdAt?: string;
  metadata: BrowserMetadata;
  title: string;
  description: string;
  category: FeedbackCategory;
  priority: FeedbackPriority;
  name: string;
  email: string;
  /** Honeypot. */
  website: string;
}

export type DraftField = "title" | "description" | "name" | "email";
export type FieldErrors = Partial<Record<DraftField, string>>;

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Bug",
  design: "Design",
  content: "Content",
  feature: "Feature request",
  other: "Other",
};

export const PRIORITY_LABELS: Record<FeedbackPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export function createDraft(init: {
  category: FeedbackCategory;
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

export function validateDraft(draft: Draft, options: { reporterFields: boolean }): FieldErrors {
  const errors: FieldErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = "Add a short title";
  else if (title.length > LIMITS.titleMax) errors.title = `Keep the title under ${LIMITS.titleMax} characters`;
  if (draft.description.trim().length > LIMITS.descriptionMax)
    errors.description = `Keep the description under ${LIMITS.descriptionMax.toLocaleString("en-US")} characters`;
  if (options.reporterFields) {
    if (draft.name.trim().length > LIMITS.nameMax) errors.name = `Keep the name under ${LIMITS.nameMax} characters`;
    const email = draft.email.trim();
    if (email.length > LIMITS.emailMax) errors.email = `Keep the email under ${LIMITS.emailMax} characters`;
    else if (email && !EMAIL_RE.test(email)) errors.email = "Enter a valid email address";
  }
  return errors;
}

export function isDraftDirty(draft: Draft): boolean {
  return Boolean(draft.title.trim() || draft.description.trim() || draft.name.trim() || draft.email.trim());
}
