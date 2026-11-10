import { CaptureError, abortError } from "./errors";

/** Settles with `task`, or rejects with CaptureError("aborted") / ("failed") on abort / timeout. */
export function raceCapture<T>(task: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(new CaptureError("failed", `${what} timed out after ${Math.round(timeoutMs)} ms.`));
      }, timeoutMs);
    }
    task.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return raceCapture(new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms))), signal, 0, "Delay");
}

/** Resolves after `count` animation frames (falls back to timers when rAF is throttled or missing). */
export async function waitForAnimationFrames(count: number, signal?: AbortSignal): Promise<void> {
  for (let i = 0; i < count; i++) {
    await raceCapture(
      new Promise<void>((resolve) => {
        const fallback = setTimeout(resolve, 100);
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => {
            clearTimeout(fallback);
            resolve();
          });
        }
      }),
      signal,
      0,
      "Animation frame",
    );
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new CaptureError("failed", "Could not encode the screenshot as PNG."));
    }, "image/png");
  });
}
