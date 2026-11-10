import type { SubmissionErrorCode } from "@pinpoint-feedback/core";

export interface PinpointErrorInit {
  code: SubmissionErrorCode;
  message: string;
  status: number;
  retryable: boolean;
  retryAfter?: number;
  details?: unknown;
  cause?: unknown;
}

export class PinpointServerError extends Error {
  readonly code: SubmissionErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfter?: number;
  readonly details?: unknown;

  constructor(init: PinpointErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "PinpointServerError";
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable;
    this.retryAfter = init.retryAfter;
    this.details = init.details;
  }
}

/** Thrown when required configuration (e.g. environment variables) is missing or invalid. */
export class PinpointConfigError extends PinpointServerError {
  constructor(message: string) {
    super({ code: "misconfigured", message, status: 500, retryable: false });
    this.name = "PinpointConfigError";
  }
}

/** A failed Notion operation, mapped to the submission error vocabulary. */
export class NotionBackendError extends PinpointServerError {
  /** Notion's own error code (e.g. "object_not_found"), when known. */
  readonly notionCode?: string;

  constructor(init: PinpointErrorInit & { notionCode?: string }) {
    super(init);
    this.name = "NotionBackendError";
    this.notionCode = init.notionCode;
  }
}
