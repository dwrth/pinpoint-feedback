import {
  collectBrowserMetadata,
  createDefaultCapturer,
  DisplayMediaScreenshotCapturer,
  formatNumber,
  PINPOINT_IGNORE_ATTRIBUTE,
  type CapturedScreenshot,
  type CategoryList,
  type FeedbackClient,
  type ScreenshotCapturer,
} from "@pinpoint-feedback/core";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickCategory, useResolvedCategories } from "./categories";
import { createDraft, type Draft } from "./draft";
import { formatHotkey, getDefaultClient, nextFrames, useHotkey, useResolvedTheme } from "./hooks";
import { I18nProvider, useWidgetI18n, type WidgetTranslate } from "./i18n";
import { AlertIcon, CameraIcon, MessageIcon, MonitorIcon, Spinner } from "./icons";
import { ShadowPortal } from "./ShadowRoot";
import type { DefaultCategoryList, FeedbackController, FeedbackWidgetPosition, FeedbackWidgetProps } from "./types";

const loadDialog = () => import("./Dialog");
const Dialog = lazy(loadDialog);

type Phase =
  | { kind: "idle" }
  | { kind: "capturing"; displayMedia: boolean }
  | { kind: "capture-error"; code?: string; triedDisplayMedia: boolean }
  | { kind: "open" };

/** Page corners stay physical in RTL: they place the widget relative to the viewport, not to text. */
const CORNER: Record<FeedbackWidgetPosition, string> = {
  "bottom-right": "bottom-4 right-4 sm:bottom-5 sm:right-5",
  "bottom-left": "bottom-4 left-4 sm:bottom-5 sm:left-5",
  "top-right": "top-4 right-4 sm:top-5 sm:right-5",
  "top-left": "top-4 left-4 sm:top-5 sm:left-5",
};

const CARD_OFFSET: Record<FeedbackWidgetPosition, string> = {
  "bottom-right": "bottom-4 right-4 sm:bottom-18 sm:right-5",
  "bottom-left": "bottom-4 left-4 sm:bottom-18 sm:left-5",
  "top-right": "top-4 right-4 sm:top-18 sm:right-5",
  "top-left": "top-4 left-4 sm:top-18 sm:left-5",
};

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return undefined;
}

function captureErrorMessage(t: WidgetTranslate, code: string | undefined): string {
  return code === "unsupported" ? t("captureError.unsupported") : t("captureError.failed");
}

function isDisplayMediaSupported(): boolean {
  try {
    return new DisplayMediaScreenshotCapturer().isSupported();
  } catch {
    return false;
  }
}

export interface WidgetInternalProps extends Omit<FeedbackWidgetProps<CategoryList>, "defaultCategory"> {
  defaultCategory?: string;
  onController?: (controller: FeedbackController) => void;
}

export function Widget({
  endpoint = "/api/feedback",
  position = "bottom-right",
  theme = "system",
  accentColor,
  projectId,
  reporter,
  collectReporter = true,
  buttonLabel: buttonLabelProp,
  hotkey = false,
  zIndex = 2147483000,
  categories: categoriesProp,
  defaultCategory,
  defaultPriority = "medium",
  capturer,
  client,
  maxFileBytes,
  metadata,
  onSubmitted,
  onError,
  hidden = false,
  locale,
  messages,
  onController,
}: WidgetInternalProps) {
  const i18n = useWidgetI18n(locale, messages);
  const { t, bundle } = i18n;
  const buttonLabel = buttonLabelProp ?? t("launcher.label");
  const resolvedTheme = useResolvedTheme(theme);
  const categories = useResolvedCategories(categoriesProp);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [screenshot, setScreenshot] = useState<CapturedScreenshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [closeSignal, setCloseSignal] = useState(0);
  const [displayMediaSupported, setDisplayMediaSupported] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const defaultCapturerRef = useRef<ScreenshotCapturer | null>(null);
  const busyRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const latest = useRef({ client, endpoint, maxFileBytes, capturer, metadata, onError, defaultCategory, defaultPriority, categories, bundle });
  latest.current = { client, endpoint, maxFileBytes, capturer, metadata, onError, defaultCategory, defaultPriority, categories, bundle };

  const getClient = useCallback(
    (): FeedbackClient => latest.current.client ?? getDefaultClient(latest.current.endpoint, latest.current.maxFileBytes),
    [],
  );

  useEffect(() => {
    setDisplayMediaSupported(isDisplayMediaSupported());
  }, []);

  const refreshPending = useCallback(async () => {
    try {
      setPendingCount((await getClient().pending()).length);
    } catch {
      setPendingCount(0);
    }
  }, [getClient]);

  const retryPending = useCallback(async (force = false) => {
    try {
      const target = getClient();
      const pending = await target.pending();
      if (pending.length) await target.retryPending(force ? { force } : undefined);
    } catch {
      /* failures stay in the outbox */
    } finally {
      await refreshPending();
    }
  }, [getClient, refreshPending]);

  useEffect(() => {
    void retryPending();
    const onOnline = () => void retryPending(true);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [retryPending, client, endpoint, maxFileBytes]);

  const capture = useCallback(async (useDisplayMedia: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    void loadDialog();
    const { capturer: custom, metadata: getMetadata } = latest.current;
    const hadDialog = phaseRef.current.kind === "open";
    setPhase({ kind: "capturing", displayMedia: useDisplayMedia });
    setDraft(
      (d) =>
        d ??
        createDraft({
          category: pickCategory(latest.current.categories, latest.current.defaultCategory),
          priority: latest.current.defaultPriority,
          metadata: (getMetadata ?? collectBrowserMetadata)(),
        }),
    );
    try {
      await nextFrames(2);
      const instance = useDisplayMedia
        ? new DisplayMediaScreenshotCapturer()
        : (custom ?? (defaultCapturerRef.current ??= createDefaultCapturer()));
      const { bundle: active } = latest.current;
      const shot = await instance.capture({
        exclude: (el: Element) => el.hasAttribute(PINPOINT_IGNORE_ATTRIBUTE),
        messages: active.capture,
        locale: active.locale,
      });
      setScreenshot(shot);
      setPhase({ kind: "open" });
    } catch (error) {
      const code = errorCode(error);
      if (code === "cancelled" || code === "aborted") {
        if (hadDialog) setPhase({ kind: "open" });
        else {
          setDraft(null);
          setPhase({ kind: "idle" });
        }
      } else {
        latest.current.onError?.({ type: "capture", error });
        setPhase({ kind: "capture-error", code, triedDisplayMedia: useDisplayMedia });
      }
    } finally {
      busyRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    setPhase({ kind: "idle" });
    setDraft(null);
    setScreenshot(null);
  }, []);

  const open = useCallback(() => {
    if (phaseRef.current.kind === "idle") void capture(false);
  }, [capture]);

  const continueWithoutScreenshot = () => {
    setScreenshot(null);
    setPhase({ kind: "open" });
  };

  const cancelCaptureError = () => {
    if (screenshot) setPhase({ kind: "open" });
    else reset();
  };

  useHotkey(hotkey, () => {
    const current = phaseRef.current.kind;
    if (current === "idle") void capture(false);
    else if (current === "open") setCloseSignal((n) => n + 1);
    else if (current === "capture-error") cancelCaptureError();
  });

  const prevPhase = useRef(phase.kind);
  useEffect(() => {
    if (phase.kind === "idle" && prevPhase.current !== "idle") {
      buttonRef.current?.focus({ preventScroll: true });
    }
    prevPhase.current = phase.kind;
  }, [phase.kind]);

  const isOpen = phase.kind !== "idle";
  const controller = useMemo<FeedbackController>(
    () => ({ open, close: reset, isOpen, pendingCount, retryPending: () => retryPending(true) }),
    [open, reset, isOpen, pendingCount, retryPending],
  );
  useEffect(() => {
    onController?.(controller);
  }, [controller, onController]);

  const errorCardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase.kind === "capture-error") errorCardRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [phase.kind]);

  const label = hotkey ? t("common.withShortcut", { label: buttonLabel, shortcut: formatHotkey(hotkey) }) : buttonLabel;
  const showButton = !hidden && (phase.kind === "idle" || phase.kind === "capture-error");

  return (
    <ShadowPortal zIndex={zIndex} theme={resolvedTheme} accentColor={accentColor} lang={bundle.locale} dir={bundle.dir}>
      <I18nProvider value={i18n}>
        {showButton ? (
          <button
            ref={buttonRef}
            type="button"
            aria-label={pendingCount ? t("launcher.labelWithPending", { label: buttonLabel, count: pendingCount }) : buttonLabel}
            aria-haspopup="dialog"
            aria-keyshortcuts={hotkey || undefined}
            title={label}
            onClick={() => void capture(false)}
            onPointerEnter={() => void loadDialog()}
            onFocus={() => void loadDialog()}
            className={`group pp-fade-in fixed ${CORNER[position]} inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm font-medium text-fg shadow-float transition-[transform,background-color,box-shadow] duration-150 ease-out hover:-translate-y-px hover:bg-subtle active:translate-y-0 sm:h-10 sm:ps-3.5 sm:pe-4`}
          >
            <span className="grid size-5 place-items-center text-accent">
              <MessageIcon size={18} />
            </span>
            <span className="hidden sm:inline">{buttonLabel}</span>
            {pendingCount ? (
              <span
                aria-hidden="true"
                className="absolute -top-1 -end-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-accent px-1 text-2xs font-semibold text-accent-fg ring-2 ring-surface tabular-nums"
              >
                {formatNumber(bundle.locale, pendingCount)}
              </span>
            ) : null}
          </button>
        ) : null}

        {phase.kind === "capturing" && !phase.displayMedia ? (
          <div
            role="status"
            className={`pp-delayed-in fixed ${CORNER[position]} inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm text-fg-muted shadow-float`}
          >
            <Spinner size={14} />
            {t("launcher.capturing")}
          </div>
        ) : null}

        {phase.kind === "capture-error" ? (
          <div
            ref={errorCardRef}
            role="alertdialog"
            aria-labelledby="pp-capture-error-title"
            aria-describedby="pp-capture-error-desc"
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelCaptureError();
            }}
            className={`pp-pop-in fixed ${CARD_OFFSET[position]} w-[min(360px,calc(100vw-32px))] rounded-xl border border-line bg-surface p-4 text-fg shadow-float`}
          >
            <div className="flex gap-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-full bg-danger-bg text-danger">
                <AlertIcon size={16} />
              </div>
              <div className="min-w-0">
                <h2 id="pp-capture-error-title" className="text-sm font-semibold">
                  {t("captureError.title")}
                </h2>
                <p id="pp-capture-error-desc" className="mt-0.5 text-sm break-words text-fg-muted">
                  {captureErrorMessage(t, phase.code)}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {displayMediaSupported && !phase.triedDisplayMedia ? (
                <button
                  type="button"
                  onClick={() => void capture(true)}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg transition-[filter] duration-150 hover:brightness-110"
                >
                  <MonitorIcon size={14} />
                  {t("captureError.tryScreenCapture")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={continueWithoutScreenshot}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium transition-colors duration-150 hover:bg-muted"
              >
                <CameraIcon size={14} className="opacity-60" />
                {t("captureError.continueWithout")}
              </button>
              <button
                type="button"
                onClick={cancelCaptureError}
                className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium text-fg-muted transition-colors duration-150 hover:bg-muted hover:text-fg"
              >
                {t("captureError.cancel")}
              </button>
            </div>
          </div>
        ) : null}

        {phase.kind === "open" && draft ? (
          <Suspense fallback={null}>
            <Dialog
              screenshot={screenshot}
              draft={draft}
              onDraftChange={(update) => setDraft((d) => (d ? update(d) : d))}
              onClose={reset}
              onRetake={(displayMedia) => void capture(displayMedia)}
              displayMediaSupported={displayMediaSupported}
              categories={categories}
              showReporterFields={collectReporter}
              reporter={reporter}
              projectId={projectId}
              getClient={getClient}
              onSubmitted={onSubmitted}
              onError={onError}
              onSettled={refreshPending}
              closeSignal={closeSignal}
            />
          </Suspense>
        ) : null}
      </I18nProvider>
    </ShadowPortal>
  );
}

/**
 * Standalone feedback widget. Pass `categories` inline or from `defineCategories()`;
 * `defaultCategory` is checked against the ids in that list.
 */
export function FeedbackWidget<const C extends CategoryList = DefaultCategoryList>(props: FeedbackWidgetProps<C>) {
  return <Widget {...props} />;
}
