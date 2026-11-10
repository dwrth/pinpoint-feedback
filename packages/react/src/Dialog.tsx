import {
  createAnnotationEditor,
  DEFAULT_ANNOTATION_COLOR,
  formatCaptureWarning,
  type EditorMessages,
  type AnnotationEditor,
  type AnnotationEditorState,
  type CapturedScreenshot,
  type CategoryDefinition,
  type FeedbackClient,
  type FeedbackSubmission,
  type Reporter,
  type SubmissionFailure,
  type SubmissionFiles,
  type SubmissionSuccess,
  type SubmitProgress,
} from "@pinpoint-feedback/core";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { isDraftDirty, validateDraft, type Draft, type DraftField, type FieldErrors } from "./draft";
import { FeedbackForm } from "./Form";
import { useFocusTrap } from "./hooks";
import { fieldErrorsFromDetails, submissionErrorMessage, useI18n, type WidgetTranslate } from "./i18n";
import {
  AlertIcon,
  CameraIcon,
  CheckIcon,
  ExternalIcon,
  ImageOffIcon,
  InfoIcon,
  MonitorIcon,
  Spinner,
  XIcon,
} from "./icons";
import { strokeWidthsFor, Toolbar, TOOLS } from "./Toolbar";
import type { FeedbackWidgetError } from "./types";

export interface DialogProps {
  screenshot: CapturedScreenshot | null;
  draft: Draft;
  onDraftChange: (update: (draft: Draft) => Draft) => void;
  /** Close and discard the draft. */
  onClose: () => void;
  onRetake: (displayMedia: boolean) => void;
  displayMediaSupported: boolean;
  categories: readonly CategoryDefinition[];
  showReporterFields: boolean;
  reporter?: Reporter;
  projectId?: string;
  getClient: () => FeedbackClient;
  onSubmitted?: (result: SubmissionSuccess) => void;
  onError?: (error: FeedbackWidgetError) => void;
  onSettled: () => void;
  /** Incremented by the widget to ask the dialog to close (respecting unsaved input). */
  closeSignal: number;
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting"; progress?: SubmitProgress; retryAt?: number; hasFiles: boolean }
  | { kind: "success"; result: SubmissionSuccess }
  | { kind: "error"; error: SubmissionFailure["error"] };

const AUTO_CLOSE_MS = 4000;

function useAnnotationEditor(image: Blob | undefined, scale: number, messages: EditorMessages, locale: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<AnnotationEditor | null>(null);
  const [state, setState] = useState<AnnotationEditorState | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!image || !container) return;
    const instance = createAnnotationEditor({
      container,
      image,
      color: DEFAULT_ANNOTATION_COLOR,
      strokeWidth: strokeWidthsFor(scale)[1]!.width,
      messages,
      locale,
    });
    setEditor(instance);
    setState(instance.getState());
    const unsubscribe = instance.subscribe(setState);
    return () => {
      unsubscribe();
      instance.destroy();
      setEditor(null);
      setState(null);
    };
  }, [image, scale, messages, locale]);

  return { containerRef, editor, state };
}

function progressText(t: WidgetTranslate, status: Extract<Status, { kind: "submitting" }>, now: number): string {
  const p = status.progress;
  if (!p) return t("progress.preparing");
  switch (p.phase) {
    case "preparing":
      return t("progress.preparing");
    case "queued":
      return t("progress.queued");
    case "sending":
      if (p.attempt > 1) return t("progress.attempt", { attempt: p.attempt, maxAttempts: p.maxAttempts });
      return status.hasFiles ? t("progress.uploading") : t("progress.sending");
    case "retrying": {
      if (status.retryAt === undefined) return t("progress.retrying");
      const seconds = Math.max(1, Math.ceil((status.retryAt - now) / 1000));
      return t("progress.retryingIn", { count: seconds });
    }
    case "done":
      return t("progress.done");
    case "failed":
      return t("progress.failed");
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export default function Dialog(props: DialogProps) {
  const {
    screenshot,
    draft,
    onDraftChange,
    onClose,
    onRetake,
    displayMediaSupported,
    categories,
    showReporterFields,
    reporter,
    projectId,
    getClient,
    onSubmitted,
    onError,
    onSettled,
    closeSignal,
  } = props;

  const { t, bundle, locale } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const confirmKeepRef = useRef<HTMLButtonElement>(null);
  const { containerRef, editor, state } = useAnnotationEditor(
    screenshot?.blob,
    screenshot?.scale ?? 1,
    bundle.editor,
    locale,
  );
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [touched, setTouched] = useState<Partial<Record<DraftField, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [warningsDismissed, setWarningsDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useFocusTrap(panelRef, true);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (confirming) confirmKeepRef.current?.focus();
  }, [confirming]);

  const retryAt = status.kind === "submitting" ? status.retryAt : undefined;
  useEffect(() => {
    if (retryAt === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [retryAt]);

  const succeeded = status.kind === "success";
  useEffect(() => {
    if (!succeeded) return;
    const timer = setTimeout(onClose, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [succeeded, onClose]);

  const reporterFields = showReporterFields && !reporter;
  const validationErrors = validateDraft(draft, { reporterFields }, t);
  const visibleErrors: FieldErrors = { ...serverErrors };
  for (const field of Object.keys(validationErrors) as DraftField[]) {
    if (submitAttempted || (touched[field] && draft[field].trim() !== "")) visibleErrors[field] = validationErrors[field];
  }

  const submitting = status.kind === "submitting";
  const dirty = !succeeded && (isDraftDirty(draft) || (state?.annotationCount ?? 0) > 0);

  const requestClose = useCallback(() => {
    if (dirty) setConfirming(true);
    else onClose();
  }, [dirty, onClose]);

  const lastCloseSignal = useRef(closeSignal);
  useEffect(() => {
    if (closeSignal === lastCloseSignal.current) return;
    lastCloseSignal.current = closeSignal;
    requestClose();
  }, [closeSignal, requestClose]);

  const updateDraft = (patch: Partial<Draft>) => {
    onDraftChange((d) => ({ ...d, ...patch }));
    if (status.kind === "error" && !status.error.retryable) setStatus({ kind: "idle" });
    const changed = Object.keys(patch).filter((k) => k in serverErrors);
    if (changed.length) {
      setServerErrors((errs) => {
        const next = { ...errs };
        for (const k of changed) delete next[k as DraftField];
        return next;
      });
    }
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitAttempted(true);
    setServerErrors({});
    if (Object.keys(validationErrors).length) {
      const first = panelRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      (first ?? titleRef.current)?.focus();
      return;
    }

    const createdAt = draft.createdAt ?? new Date().toISOString();
    if (!draft.createdAt) onDraftChange((d) => ({ ...d, createdAt }));

    const hasFiles = Boolean(screenshot);
    setStatus({ kind: "submitting", hasFiles });

    const files: SubmissionFiles = {};
    let annotations: FeedbackSubmission["annotations"] = [];
    if (screenshot) {
      files.screenshot = screenshot.blob;
      if (editor) {
        try {
          await editor.ready;
          annotations = editor.getAnnotations();
          files.annotatedScreenshot = await editor.exportAnnotated("image/png");
        } catch {
          delete files.annotatedScreenshot;
        }
      }
    }

    const name = draft.name.trim();
    const email = draft.email.trim();
    const submissionReporter: Reporter | undefined = reporter
      ? reporter
      : reporterFields && (name || email)
        ? { ...(name && { name }), ...(email && { email }) }
        : undefined;

    const submission: FeedbackSubmission = {
      submissionId: draft.submissionId,
      title: draft.title.trim(),
      description: draft.description.trim(),
      category: draft.category,
      priority: draft.priority,
      ...(submissionReporter && { reporter: submissionReporter }),
      metadata: draft.metadata,
      annotations,
      ...(screenshot && {
        capture: {
          method: screenshot.method,
          width: screenshot.width,
          height: screenshot.height,
          warnings: screenshot.warnings,
        },
      }),
      ...(projectId && { projectId }),
      createdAt,
      openedAt: draft.openedAt,
      website: draft.website,
    };

    let result;
    try {
      result = await getClient().submit(submission, files, {
        onProgress: (progress) =>
          setStatus({
            kind: "submitting",
            hasFiles,
            progress,
            retryAt:
              progress.phase === "retrying" && progress.retryInMs !== undefined
                ? Date.now() + progress.retryInMs
                : undefined,
          }),
      });
    } catch (error) {
      result = {
        ok: false as const,
        error: {
          code: "network" as const,
          message: error instanceof Error ? error.message : t("error.unknown"),
          retryable: true,
        },
      };
    }

    if (result.ok === true) {
      setStatus({ kind: "success", result });
      onSubmitted?.(result);
    } else {
      setStatus({ kind: "error", error: result.error });
      if (result.error.code === "validation") setServerErrors(fieldErrorsFromDetails(t, result.error.details));
      onError?.({ type: "submit", error: result.error });
    }
    onSettled();
  };

  const onPanelKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || state?.editingText) return;
    event.preventDefault();
    event.stopPropagation();
    if (confirming) setConfirming(false);
    else requestClose();
  };

  const onEditorKeyDown = (event: ReactKeyboardEvent) => {
    if (!editor || event.defaultPrevented || state?.editingText || isTypingTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tool = TOOLS.find((t) => t.key.toLowerCase() === event.key.toLowerCase());
    if (!tool) return;
    event.preventDefault();
    editor.setTool(tool.tool);
  };

  const warnings = screenshot?.warnings ?? [];
  const showWarnings = warnings.length > 0 && !warningsDismissed;
  const errorStatus = status.kind === "error" ? status.error : null;
  const liveMessage =
    status.kind === "submitting"
      ? progressText(t, status, now)
      : status.kind === "success"
        ? t("success.announcement")
        : "";

  return (
    <div className="pp-fade-in fixed inset-0 bg-backdrop" onKeyDown={onPanelKeyDown}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="pp-pop-in fixed inset-0 flex flex-col overflow-hidden bg-surface text-fg sm:inset-4 sm:rounded-xl sm:border sm:border-line sm:shadow-float lg:inset-8"
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
          <h2 id={titleId} className="text-sm font-semibold tracking-tight">
            {t("dialog.title")}
          </h2>
          <span dir="auto" className="hidden min-w-0 truncate font-mono text-2xs text-fg-subtle sm:block">
            {draft.metadata.pageTitle || draft.metadata.url}
          </span>
          <button
            type="button"
            aria-label={t("dialog.close")}
            title={t("common.withShortcut", { label: t("dialog.closeShort"), shortcut: "Esc" })}
            onClick={requestClose}
            className="ms-auto inline-flex size-8 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:bg-muted hover:text-fg"
          >
            <XIcon />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">
          <section
            aria-label={t("dialog.screenshotRegion")}
            className="flex h-[56vh] min-h-72 shrink-0 flex-col border-b border-line bg-canvas sm:h-auto sm:min-h-0 sm:min-w-0 sm:flex-1 sm:border-e sm:border-b-0"
          >
            {screenshot ? (
              <>
                <Toolbar editor={editor} state={state} scale={screenshot.scale} onRetake={() => onRetake(false)} disabled={submitting || succeeded} />
                {showWarnings ? (
                  <div
                    role="note"
                    className="flex items-start gap-2.5 border-b border-line bg-warning-bg px-4 py-2.5 text-xs text-warning"
                  >
                    <InfoIcon size={14} className="mt-px shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t("warnings.title")}</p>
                      <ul className="mt-1 list-disc space-y-0.5 ps-4">
                        {warnings.map((w, i) => (
                          <li key={`${w.code}-${i}`}>{formatCaptureWarning(w, { messages: bundle.capture, locale })}</li>
                        ))}
                      </ul>
                      {displayMediaSupported ? (
                        <button
                          type="button"
                          onClick={() => onRetake(true)}
                          className="mt-2 inline-flex items-center gap-1.5 font-medium underline underline-offset-2 hover:no-underline"
                        >
                          <MonitorIcon size={13} />
                          {t("warnings.useScreenCapture")}
                        </button>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      aria-label={t("warnings.dismiss")}
                      onClick={() => setWarningsDismissed(true)}
                      className="-m-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-warning/10"
                    >
                      <XIcon size={14} />
                    </button>
                  </div>
                ) : null}
                <div
                  onKeyDown={onEditorKeyDown}
                  className="pp-checker relative min-h-0 flex-1 overflow-hidden has-focus-visible:ring-2 has-focus-visible:ring-accent has-focus-visible:ring-inset"
                >
                  <div ref={containerRef} className="absolute inset-0" data-testid="pinpoint-editor" />
                </div>
              </>
            ) : (
              <div className="pp-checker flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="grid size-10 place-items-center rounded-full border border-line bg-surface text-fg-subtle">
                  <ImageOffIcon size={18} />
                </div>
                <div>
                  <p className="text-sm font-medium">{t("noScreenshot.title")}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{t("noScreenshot.description")}</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => onRetake(false)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-medium shadow-[0_1px_1px_rgb(0_0_0/0.04)] transition-colors duration-150 hover:bg-muted"
                  >
                    <CameraIcon size={14} />
                    {t("noScreenshot.capture")}
                  </button>
                  {displayMediaSupported ? (
                    <button
                      type="button"
                      onClick={() => onRetake(true)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-medium shadow-[0_1px_1px_rgb(0_0_0/0.04)] transition-colors duration-150 hover:bg-muted"
                    >
                      <MonitorIcon size={14} />
                      {t("noScreenshot.screenCapture")}
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          <section aria-label={t("dialog.detailsRegion")} className="flex flex-col sm:min-h-0 sm:w-[360px] sm:shrink-0 lg:w-[400px]">
            {status.kind === "success" ? (
              <SuccessView result={status.result} onClose={onClose} />
            ) : (
              <form
                noValidate
                className="flex flex-1 flex-col sm:min-h-0"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <div className="flex-1 px-4 py-4 sm:overflow-y-auto">
                  <FeedbackForm
                    draft={draft}
                    onChange={updateDraft}
                    onBlurField={(field) => setTouched((t) => (t[field] ? t : { ...t, [field]: true }))}
                    errors={visibleErrors}
                    categories={categories}
                    showReporterFields={reporterFields}
                    disabled={submitting}
                    titleRef={titleRef}
                  />
                </div>
                <footer className="sticky bottom-0 flex shrink-0 flex-col gap-3 border-t border-line bg-surface px-4 py-3">
                  {errorStatus ? (
                    <div role="alert" className="flex gap-2.5 rounded-lg bg-danger-bg px-3 py-2.5 text-xs text-danger">
                      <AlertIcon size={14} className="mt-px shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium">{submissionErrorMessage(t, errorStatus)}</p>
                        {errorStatus.retryable ? (
                          <p className="mt-0.5 opacity-90">{t("submit.savedForRetry")}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-3">
                    <p className="min-w-0 flex-1 truncate text-xs text-fg-muted" aria-hidden="true">
                      {status.kind === "submitting" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Spinner size={12} />
                          {progressText(t, status, now)}
                        </span>
                      ) : null}
                    </p>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.12)] transition-[filter,opacity] duration-150 hover:brightness-110 disabled:cursor-progress disabled:opacity-70"
                    >
                      {submitting ? <Spinner size={14} /> : null}
                      {submitting ? t("submit.sending") : errorStatus?.retryable ? t("submit.retry") : t("submit.send")}
                    </button>
                  </div>
                </footer>
              </form>
            )}
          </section>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {liveMessage}
        </div>

        {confirming ? (
          <div className="pp-fade-in absolute inset-0 z-10 grid place-items-center bg-backdrop p-4">
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={`${titleId}-confirm`}
              aria-describedby={`${titleId}-confirm-desc`}
              className="pp-pop-in w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-float"
            >
              <h3 id={`${titleId}-confirm`} className="text-sm font-semibold">
                {t("confirm.title")}
              </h3>
              <p id={`${titleId}-confirm-desc`} className="mt-1 text-sm text-fg-muted">
                {t("confirm.description")}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  ref={confirmKeepRef}
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium transition-colors duration-150 hover:bg-muted"
                >
                  {t("confirm.keep")}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-8 items-center rounded-lg bg-danger px-3 text-sm font-medium text-danger-fg transition-[filter] duration-150 hover:brightness-110"
                >
                  {t("confirm.discard")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SuccessView({ result, onClose }: { result: SubmissionSuccess; onClose: () => void }) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div className="pp-fade-in flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-success-bg text-success">
        <CheckIcon size={22} strokeWidth={2.5} />
      </div>
      <div>
        <p className="text-base font-semibold tracking-tight">{t("success.title")}</p>
        <p className="mt-1 text-sm text-fg-muted">
          {result.duplicate ? t("success.duplicate") : t("success.thanks")}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {result.pageUrl ? (
          <a
            href={result.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium transition-colors duration-150 hover:bg-muted"
          >
            {t("success.openInNotion")}
            <ExternalIcon size={13} className="rtl:-scale-x-100" />
          </a>
        ) : null}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg transition-[filter] duration-150 hover:brightness-110"
        >
          {t("success.done")}
        </button>
      </div>
    </div>
  );
}
