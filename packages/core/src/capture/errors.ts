export type CaptureErrorCode = "cancelled" | "unsupported" | "failed" | "aborted";

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;

  constructor(code: CaptureErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CaptureError";
    this.code = code;
  }
}

export function isCaptureError(error: unknown, code?: CaptureErrorCode): error is CaptureError {
  return error instanceof CaptureError && (code === undefined || error.code === code);
}

export function abortError(signal?: AbortSignal): CaptureError {
  return new CaptureError("aborted", "Screenshot capture was aborted.", { cause: signal?.reason });
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}
