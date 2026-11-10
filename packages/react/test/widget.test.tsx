import type { SubmissionResult } from "@pinpoint-feedback/core";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackProvider, FeedbackWidget, useFeedback } from "../src";
import { withPropertyFallbacks } from "../src/ShadowRoot";
import {
  deferred,
  editors,
  fakeAnnotations,
  makeCapturer,
  makeClient,
  makeScreenshot,
  metadata,
  shadow,
  shadowRoot,
} from "./helpers";

const displayMedia = vi.hoisted(() => ({ supported: false, capture: null as null | (() => Promise<unknown>) }));

vi.mock("@pinpoint-feedback/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pinpoint-feedback/core")>();
  const helpers = await import("./helpers");
  class CaptureError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  class DisplayMediaScreenshotCapturer {
    readonly id = "display-media";
    isSupported() {
      return displayMedia.supported;
    }
    capture() {
      return displayMedia.capture ? displayMedia.capture() : Promise.resolve(helpers.makeScreenshot({ method: "display-media" }));
    }
  }
  return {
    ...actual,
    PINPOINT_IGNORE_ATTRIBUTE: "data-pinpoint-ignore",
    CaptureError,
    DisplayMediaScreenshotCapturer,
    createDefaultCapturer: vi.fn(() => helpers.makeCapturer().capturer),
    createAnnotationEditor: vi.fn(helpers.createFakeEditor),
    collectBrowserMetadata: vi.fn(() => helpers.metadata),
    createFeedbackClient: vi.fn(() => helpers.makeClient().client),
  };
});

class FakeCaptureError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const OK: SubmissionResult = {
  ok: true,
  submissionId: "x",
  pageId: "page-1",
  pageUrl: "https://notion.so/page-1",
  duplicate: false,
};

beforeEach(() => {
  editors.length = 0;
  displayMedia.supported = false;
  displayMedia.capture = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function openDialog() {
  fireEvent.click(shadow().getByRole("button", { name: /feedback/i }));
  return shadow().findByRole("dialog", {}, { timeout: 3000 });
}

function fillTitle(value: string) {
  fireEvent.change(shadow().getByLabelText("Title"), { target: { value } });
}

describe("FeedbackWidget", () => {
  it("renders the button into a shadow root on an ignored host", () => {
    const { client } = makeClient();
    render(<FeedbackWidget client={client} />);
    const host = document.body.querySelector("[data-pinpoint-ignore]");
    expect(host).not.toBeNull();
    expect(host!.shadowRoot).not.toBeNull();
    expect(host!.shadowRoot!.querySelector("style")).not.toBeNull();
    expect(shadow().getByRole("button", { name: "Feedback" })).toBeTruthy();
    expect(document.body.querySelector("button")).toBeNull();
  });

  it("applies the theme attribute and accent color", async () => {
    const { client } = makeClient();
    const { rerender } = render(<FeedbackWidget client={client} theme="dark" accentColor="#ff0066" />);
    const container = () => shadowRoot().querySelector<HTMLElement>(".pp-root")!;
    await waitFor(() => expect(container().getAttribute("data-theme")).toBe("dark"));
    expect(container().style.getPropertyValue("--pp-accent")).toBe("#ff0066");
    rerender(<FeedbackWidget client={client} theme="light" />);
    await waitFor(() => expect(container().getAttribute("data-theme")).toBe("light"));
  });

  it("follows the system color scheme", async () => {
    const listeners: Array<() => void> = [];
    const mql = {
      matches: true,
      addEventListener: (_: string, l: () => void) => listeners.push(l),
      removeEventListener: vi.fn(),
    };
    const spy = vi.spyOn(window, "matchMedia").mockReturnValue(mql as unknown as MediaQueryList);
    const { client } = makeClient();
    render(<FeedbackWidget client={client} theme="system" />);
    const container = () => shadowRoot().querySelector<HTMLElement>(".pp-root")!;
    await waitFor(() => expect(container().getAttribute("data-theme")).toBe("dark"));
    mql.matches = false;
    act(() => listeners.forEach((l) => l()));
    await waitFor(() => expect(container().getAttribute("data-theme")).toBe("light"));
    spy.mockRestore();
  });

  it("captures on click and opens the dialog with the annotation editor", async () => {
    const { client } = makeClient();
    const { capturer, capture } = makeCapturer();
    render(<FeedbackWidget client={client} capturer={capturer} />);
    const dialog = await openDialog();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(typeof capture.mock.calls[0]![0]!.exclude).toBe("function");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(editors).toHaveLength(1);
    expect(editors[0]!.options.image).toBeInstanceOf(Blob);
    expect(editors[0]!.options.strokeWidth).toBe(6);
    expect(shadow().getByText(metadata.url)).toBeTruthy();
    expect(shadow().getByRole("button", { name: "Rectangle" })).toBeTruthy();
  });

  it("drives the editor from the toolbar and keyboard shortcuts", async () => {
    const { client } = makeClient();
    const { capturer } = makeCapturer();
    render(<FeedbackWidget client={client} capturer={capturer} />);
    await openDialog();
    const editor = editors[0]!.editor;
    const arrow = shadow().getByRole("button", { name: "Arrow" }) as HTMLButtonElement;
    await waitFor(() => expect(arrow.disabled).toBe(false));
    fireEvent.click(arrow);
    expect(editor.setTool).toHaveBeenCalledWith("arrow");
    await waitFor(() => expect(arrow.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.keyDown(shadow().getByTestId("pinpoint-editor"), { key: "r" });
    expect(editor.setTool).toHaveBeenCalledWith("rectangle");
    fireEvent.click(shadow().getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(shadow().getByRole("button", { name: /reset zoom/i }).textContent).toBe("125%"));
  });

  it("requires a title before submitting", async () => {
    const { client, submit } = makeClient();
    const { capturer } = makeCapturer();
    render(<FeedbackWidget client={client} capturer={capturer} />);
    await openDialog();
    fireEvent.click(shadow().getByRole("button", { name: "Send feedback" }));
    expect(await shadow().findByText("Add a short title")).toBeTruthy();
    expect(shadow().getByLabelText("Title").getAttribute("aria-invalid")).toBe("true");
    expect(submit).not.toHaveBeenCalled();
  });

  it("validates the optional email format", async () => {
    const { client, submit } = makeClient();
    const { capturer } = makeCapturer();
    render(<FeedbackWidget client={client} capturer={capturer} />);
    await openDialog();
    fillTitle("Broken");
    fireEvent.change(shadow().getByLabelText(/^Email/), { target: { value: "nope" } });
    fireEvent.click(shadow().getByRole("button", { name: "Send feedback" }));
    expect(await shadow().findByText("Enter a valid email address")).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it("builds the submission and shows success only after the server confirms", async () => {
    const pending = deferred<SubmissionResult>();
    const { client, submit } = makeClient([pending.promise]);
    const { capturer } = makeCapturer();
    const screenshot = makeScreenshot({
      warnings: [{ code: "cross-origin-iframe", message: "1 cross-origin iframe couldn't be captured", count: 1 }],
    });
    vi.mocked(capturer.capture).mockResolvedValueOnce(screenshot);
    const onSubmitted = vi.fn();
    render(
      <FeedbackWidget
        client={client}
        capturer={capturer}
        projectId="web"
        onSubmitted={onSubmitted}
        defaultCategory="design"
      />,
    );
    await openDialog();
    expect(shadow().getByText("1 cross-origin iframe couldn't be captured")).toBeTruthy();
    fillTitle("  Button misaligned ");
    fireEvent.change(shadow().getByLabelText(/Description/), { target: { value: "It overlaps" } });
    fireEvent.click(shadow().getByLabelText(/High/));
    fireEvent.change(shadow().getByLabelText(/^Name/), { target: { value: "Ada" } });
    fireEvent.change(shadowRoot().querySelector('input[name="website"]')!, { target: { value: "spam.example" } });
    fireEvent.click(shadow().getByRole("button", { name: "Send feedback" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const [submission, files, options] = submit.mock.calls[0]!;
    expect(submission).toMatchObject({
      title: "Button misaligned",
      description: "It overlaps",
      category: "design",
      priority: "high",
      reporter: { name: "Ada" },
      metadata,
      annotations: fakeAnnotations,
      capture: { method: "dom", width: 1280, height: 800, warnings: screenshot.warnings },
      projectId: "web",
      website: "spam.example",
    });
    expect(submission.submissionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof submission.openedAt).toBe("number");
    expect(new Date(submission.createdAt).toISOString()).toBe(submission.createdAt);
    expect(files.screenshot).toBe(screenshot.blob);
    expect(await files.annotatedScreenshot!.text()).toBe("annotated");
    expect(editors[0]!.editor.exportAnnotated).toHaveBeenCalledWith("image/png");

    act(() => options!.onProgress!({ phase: "sending", attempt: 1, maxAttempts: 3 }));
    expect(shadow().getAllByText("Uploading screenshots…").length).toBeGreaterThan(0);
    act(() => options!.onProgress!({ phase: "retrying", attempt: 1, maxAttempts: 3, retryInMs: 3000 }));
    expect(shadow().getAllByText("Retrying in 3s…").length).toBeGreaterThan(0);
    expect(shadow().queryByText("Sent to Notion")).toBeNull();
    expect(onSubmitted).not.toHaveBeenCalled();

    await act(async () => pending.resolve({ ...OK, submissionId: submission.submissionId }));
    expect(await shadow().findByText("Sent to Notion")).toBeTruthy();
    expect(shadow().getByRole("link", { name: /open in notion/i }).getAttribute("href")).toBe(OK.ok && OK.pageUrl);
    expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ ok: true, pageId: "page-1" }));
  });

  it("keeps input and offers retry with the same submission id on retryable failure", async () => {
    const failure: SubmissionResult = {
      ok: false,
      error: { code: "network", message: "You appear to be offline.", retryable: true },
    };
    const { client, submit } = makeClient([failure, OK]);
    const { capturer } = makeCapturer();
    const onError = vi.fn();
    render(<FeedbackWidget client={client} capturer={capturer} onError={onError} />);
    await openDialog();
    fillTitle("Checkout broken");
    fireEvent.click(shadow().getByRole("button", { name: "Send feedback" }));

    expect(await shadow().findByText("You appear to be offline.")).toBeTruthy();
    expect(shadow().getByText(/saved on this device and will be retried automatically/)).toBeTruthy();
    expect((shadow().getByLabelText("Title") as HTMLInputElement).value).toBe("Checkout broken");
    expect(shadow().queryByText("Sent to Notion")).toBeNull();
    expect(onError).toHaveBeenCalledWith({ type: "submit", error: failure.ok ? undefined : failure.error });

    fireEvent.click(shadow().getByRole("button", { name: "Retry" }));
    expect(await shadow().findByText("Sent to Notion")).toBeTruthy();
    expect(submit).toHaveBeenCalledTimes(2);
    const first = submit.mock.calls[0]![0];
    const second = submit.mock.calls[1]![0];
    expect(second.submissionId).toBe(first.submissionId);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.openedAt).toBe(first.openedAt);
  });

  it("allows editing and resubmitting after a non-retryable failure", async () => {
    const failure: SubmissionResult = {
      ok: false,
      error: {
        code: "validation",
        message: "Some fields are invalid.",
        retryable: false,
        details: [{ path: "title", message: "is too short" }],
      },
    };
    const { client, submit } = makeClient([failure, OK]);
    const { capturer } = makeCapturer();
    render(<FeedbackWidget client={client} capturer={capturer} />);
    await openDialog();
    fillTitle("x");
    fireEvent.click(shadow().getByRole("button", { name: "Send feedback" }));
    expect(await shadow().findByText("Some fields are invalid.")).toBeTruthy();
    expect(shadow().getByText("Title is too short")).toBeTruthy();
    expect(shadow().queryByRole("button", { name: "Retry" })).toBeNull();
    fillTitle("A longer title");
    expect(shadow().queryByText("Title is too short")).toBeNull();
    fireEvent.click(shadow().getByRole("button", { name: "Send feedback" }));
    expect(await shadow().findByText("Sent to Notion")).toBeTruthy();
    expect(submit.mock.calls[1]![0].title).toBe("A longer title");
  });

  it("offers to continue without a screenshot when capture fails", async () => {
    displayMedia.supported = true;
    const { client, submit } = makeClient([OK]);
    const { capturer } = makeCapturer(async () => {
      throw new FakeCaptureError("failed", "Rendering the page failed.");
    });
    const onError = vi.fn();
    render(<FeedbackWidget client={client} capturer={capturer} onError={onError} />);
    fireEvent.click(shadow().getByRole("button", { name: /feedback/i }));
    expect(await shadow().findByText("Rendering the page failed.")).toBeTruthy();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ type: "capture" }));
    expect(shadow().getByRole("button", { name: /try screen capture/i })).toBeTruthy();
    fireEvent.click(shadow().getByRole("button", { name: /continue without screenshot/i }));

    await shadow().findByRole("dialog", {}, { timeout: 3000 });
    expect(shadow().getByText("No screenshot attached")).toBeTruthy();
    expect(editors).toHaveLength(0);
    fillTitle("No image");
    fireEvent.click(shadow().getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const [submission, files] = submit.mock.calls[0]!;
    expect(files).toEqual({});
    expect(submission.capture).toBeUndefined();
    expect(submission.annotations).toEqual([]);
  });

  it("falls back to screen capture from the error panel", async () => {
    displayMedia.supported = true;
    const { client } = makeClient();
    const { capturer } = makeCapturer(async () => {
      throw new FakeCaptureError("failed", "Nope.");
    });
    render(<FeedbackWidget client={client} capturer={capturer} />);
    fireEvent.click(shadow().getByRole("button", { name: /feedback/i }));
    fireEvent.click(await shadow().findByRole("button", { name: /try screen capture/i }));
    await shadow().findByRole("dialog", {}, { timeout: 3000 });
    expect(editors).toHaveLength(1);
  });

  it("returns to idle when the capture is cancelled", async () => {
    const { client } = makeClient();
    const { capturer, capture } = makeCapturer(async () => {
      throw new FakeCaptureError("cancelled", "User cancelled");
    });
    render(<FeedbackWidget client={client} capturer={capturer} />);
    fireEvent.click(shadow().getByRole("button", { name: /feedback/i }));
    await waitFor(() => expect(capture).toHaveBeenCalled());
    expect(await shadow().findByRole("button", { name: "Feedback" })).toBeTruthy();
    expect(shadow().queryByRole("dialog")).toBeNull();
    expect(shadow().queryByRole("alertdialog")).toBeNull();
  });

  it("asks before discarding unsaved input on Escape and restores focus", async () => {
    const { client } = makeClient();
    const { capturer } = makeCapturer();
    render(<FeedbackWidget client={client} capturer={capturer} />);
    const dialog = await openDialog();
    fillTitle("Something");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(shadow().getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(shadow().getByRole("button", { name: "Keep editing" }));
    expect(shadow().getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(shadow().getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(shadow().queryByRole("dialog")).toBeNull());
    const button = shadow().getByRole("button", { name: "Feedback" });
    await waitFor(() => expect(shadowRoot().activeElement).toBe(button));
    expect(editors[0]!.editor.destroy).toHaveBeenCalled();
  });

  it("closes immediately on Escape when nothing was entered", async () => {
    const { client } = makeClient();
    const { capturer } = makeCapturer();
    render(<FeedbackWidget client={client} capturer={capturer} />);
    const dialog = await openDialog();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(shadow().queryByRole("dialog")).toBeNull());
  });

  it("retries pending submissions on mount and when coming online, showing a badge", async () => {
    const { client, pending, retryPending } = makeClient();
    pending.mockResolvedValue([{ submission: {} as never, files: {}, attempts: 1 }]);
    render(<FeedbackWidget client={client} />);
    await waitFor(() => expect(retryPending).toHaveBeenCalledTimes(1));
    expect(await shadow().findByRole("button", { name: "Feedback, 1 unsent" })).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(retryPending).toHaveBeenCalledTimes(2));
    expect(retryPending).toHaveBeenLastCalledWith({ force: true });
  });

  it("hides reporter fields when a reporter is provided and sends it", async () => {
    const { client, submit } = makeClient([OK]);
    const { capturer } = makeCapturer();
    render(<FeedbackWidget client={client} capturer={capturer} reporter={{ email: "dev@example.com" }} />);
    await openDialog();
    expect(shadow().queryByLabelText(/^Email/)).toBeNull();
    fillTitle("Hi");
    fireEvent.click(shadow().getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]![0].reporter).toEqual({ email: "dev@example.com" });
  });

  it("submits anonymously when name and email are empty", async () => {
    const { client, submit } = makeClient([OK]);
    const { capturer } = makeCapturer();
    render(<FeedbackWidget client={client} capturer={capturer} />);
    await openDialog();
    fillTitle("Anon");
    fireEvent.click(shadow().getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]![0].reporter).toBeUndefined();
    expect(submit.mock.calls[0]![0].website).toBe("");
  });

  it("opens with the hotkey", async () => {
    const { client } = makeClient();
    const { capturer, capture } = makeCapturer();
    render(<FeedbackWidget client={client} capturer={capturer} hotkey="ctrl+shift+f" />);
    fireEvent.keyDown(window, { key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    await shadow().findByRole("dialog", {}, { timeout: 3000 });
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe("FeedbackProvider / useFeedback", () => {
  function Trigger() {
    const feedback = useFeedback();
    return (
      <div>
        <button onClick={feedback.open}>Report a problem</button>
        <span data-testid="open-state">{feedback.isOpen ? "open" : "closed"}</span>
      </div>
    );
  }

  it("opens the widget programmatically", async () => {
    const { client } = makeClient();
    const { capturer, capture } = makeCapturer();
    const view = render(
      <FeedbackProvider client={client} capturer={capturer} hidden>
        <Trigger />
      </FeedbackProvider>,
    );
    expect(shadow().queryByRole("button", { name: "Feedback" })).toBeNull();
    expect(view.getByTestId("open-state").textContent).toBe("closed");
    fireEvent.click(view.getByText("Report a problem"));
    await shadow().findByRole("dialog", {}, { timeout: 3000 });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(view.getByTestId("open-state").textContent).toBe("open");
  });

  it("throws outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow(/FeedbackProvider/);
    spy.mockRestore();
  });
});

describe("withPropertyFallbacks", () => {
  it("re-declares @property initial values for shadow roots", () => {
    const css =
      "@property --tw-border-style{syntax:\"*\";inherits:false;initial-value:solid}@property --tw-shadow-color{syntax:\"*\";inherits:false}.a{color:red}";
    const out = withPropertyFallbacks(css);
    expect(out).toContain(":host,*,::before,::after,::backdrop{--tw-border-style:solid}");
    expect(out).not.toContain("--tw-shadow-color:");
  });
});

describe("stroke presets", () => {
  it("scale with the capture pixel ratio", async () => {
    const { strokeWidthsFor } = await import("../src/Toolbar");
    expect(strokeWidthsFor(1).map((s) => s.width)).toEqual([3, 6, 10]);
    expect(strokeWidthsFor(2).map((s) => s.width)).toEqual([6, 12, 20]);
  });
});
