import { defineLocale, en, type LocaleBundle, type SubmissionResult } from "@pinpoint-feedback/core";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackWidget } from "../src";
import { resolveLocaleBundle } from "../src/i18n";
import { editors, makeCapturer, makeClient, makeScreenshot, shadow, shadowRoot } from "./helpers";

vi.mock("@pinpoint-feedback/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pinpoint-feedback/core")>();
  const helpers = await import("./helpers");
  class DisplayMediaScreenshotCapturer {
    readonly id = "display-media";
    isSupported() {
      return false;
    }
    capture() {
      return Promise.resolve(helpers.makeScreenshot());
    }
  }
  return {
    ...actual,
    PINPOINT_IGNORE_ATTRIBUTE: "data-pinpoint-ignore",
    DisplayMediaScreenshotCapturer,
    createDefaultCapturer: vi.fn(() => helpers.makeCapturer().capturer),
    createAnnotationEditor: vi.fn(helpers.createFakeEditor),
    collectBrowserMetadata: vi.fn(() => helpers.metadata),
    createFeedbackClient: vi.fn(() => helpers.makeClient().client),
  };
});

const de = defineLocale({
  ...en,
  locale: "de",
  dir: "ltr",
  widget: {
    ...en.widget,
    "launcher.label": "Feedback geben",
    "dialog.title": "Feedback senden",
    "submit.send": "Absenden",
    "field.title": "Titel",
    "field.category": "Kategorie",
    "category.bug": "Fehler",
    "error.notionUnauthorized": "Das Feedback-Postfach ist nicht richtig verbunden.",
  },
  capture: {
    ...en.capture,
    "warning.crossOriginIframe": { one: "# fremder iframe fehlt.", other: "# fremde iframes fehlen." },
  },
});

const ar = defineLocale({ ...en, locale: "ar", dir: "rtl", widget: { ...en.widget, "launcher.label": "ملاحظات" } });

const OK: SubmissionResult = { ok: true, submissionId: "x", pageId: "p", duplicate: false };

function container(): HTMLElement {
  return shadowRoot().querySelector(".pp-root") as HTMLElement;
}

async function openDialog(name: string | RegExp) {
  fireEvent.click(shadow().getByRole("button", { name }));
  return shadow().findByRole("dialog", {}, { timeout: 3000 });
}

let htmlLang = "";
beforeEach(() => {
  editors.length = 0;
  htmlLang = document.documentElement.lang;
});

afterEach(() => {
  cleanup();
  document.documentElement.lang = htmlLang;
});

describe("resolveLocaleBundle", () => {
  it("defaults to English", () => {
    expect(resolveLocaleBundle(undefined, undefined, ["de"])).toBe(en);
  });

  it("uses a single bundle regardless of preferences", () => {
    expect(resolveLocaleBundle(de, undefined, ["fr"]).locale).toBe("de");
  });

  it.each([
    [["de-AT"], "de"],
    [["ar-EG", "de"], "ar"],
    [["ja"], "en"],
    [["en-GB", "de"], "en"],
    [[], "en"],
  ])("negotiates %j from an array → %s", (preferred, expected) => {
    expect(resolveLocaleBundle([de, ar], undefined, preferred).locale).toBe(expected);
  });

  it("fills keys missing from a bundle with English and applies overrides", () => {
    const partial = { ...de, widget: { "launcher.label": "Feedback geben" } } as unknown as LocaleBundle;
    const bundle = resolveLocaleBundle(partial, { widget: { "submit.send": "Los" } });
    expect(bundle.locale).toBe("de");
    expect(bundle.widget["launcher.label"]).toBe("Feedback geben");
    expect(bundle.widget["dialog.title"]).toBe("Send feedback");
    expect(bundle.widget["submit.send"]).toBe("Los");
    expect(bundle.editor).toEqual(en.editor);
  });
});

describe("FeedbackWidget locale", () => {
  it("renders English with lang/dir on the shadow container by default", () => {
    render(<FeedbackWidget client={makeClient().client} />);
    expect(shadow().getByRole("button", { name: "Feedback" })).toBeTruthy();
    expect(container().getAttribute("lang")).toBe("en");
    expect(container().getAttribute("dir")).toBe("ltr");
  });

  it("uses a single bundle and passes its messages to the capturer and editor", async () => {
    const { capturer, capture } = makeCapturer();
    render(<FeedbackWidget client={makeClient().client} capturer={capturer} locale={de} />);
    expect(container().getAttribute("lang")).toBe("de");
    const dialog = await openDialog("Feedback geben");
    expect(dialog.textContent).toContain("Feedback senden");
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ messages: de.capture, locale: "de" }));
    expect(editors[0]!.options.messages).toEqual(de.editor);
    expect(editors[0]!.options.locale).toBe("de");
  });

  it("negotiates from an array using <html lang>", () => {
    document.documentElement.lang = "de-CH";
    render(<FeedbackWidget client={makeClient().client} locale={[de, ar]} />);
    expect(shadow().getByRole("button", { name: "Feedback geben" })).toBeTruthy();
    expect(container().getAttribute("lang")).toBe("de");
  });

  it("falls back to English when no bundle matches", () => {
    document.documentElement.lang = "ja";
    render(<FeedbackWidget client={makeClient().client} locale={[de]} />);
    expect(shadow().getByRole("button", { name: "Feedback" })).toBeTruthy();
    expect(container().getAttribute("lang")).toBe("en");
  });

  it("sets dir=rtl for right-to-left locales", () => {
    render(<FeedbackWidget client={makeClient().client} locale={ar} />);
    expect(container().getAttribute("dir")).toBe("rtl");
    expect(container().getAttribute("lang")).toBe("ar");
  });

  it("applies messages overrides on top of the locale", async () => {
    render(
      <FeedbackWidget
        client={makeClient().client}
        capturer={makeCapturer().capturer}
        locale={de}
        messages={{ widget: { "launcher.label": "Melden", "dialog.title": "Problem melden" } }}
      />,
    );
    const dialog = await openDialog("Melden");
    expect(dialog.textContent).toContain("Problem melden");
    expect(dialog.textContent).toContain("Absenden");
  });

  it("renders capture warnings from code and count in the active locale", async () => {
    const screenshot = makeScreenshot({
      warnings: [{ code: "cross-origin-iframe", count: 2, message: "English fallback text" }],
    });
    const { capturer } = makeCapturer(async () => screenshot);
    render(<FeedbackWidget client={makeClient().client} capturer={capturer} locale={de} />);
    const dialog = await openDialog("Feedback geben");
    expect(dialog.textContent).toContain("2 fremde iframes fehlen.");
    expect(dialog.textContent).not.toContain("English fallback text");
  });

  it("localizes known submission error codes and keeps server text for unknown ones", async () => {
    const failures: SubmissionResult[] = [
      { ok: false, error: { code: "notion_unauthorized", message: "Notion rejected the API token.", retryable: false } },
      { ok: false, error: { code: "teapot" as never, message: "I'm a teapot.", retryable: false } },
    ];
    const { client, submit } = makeClient(failures);
    render(<FeedbackWidget client={client} capturer={makeCapturer().capturer} locale={de} />);
    await openDialog("Feedback geben");
    fireEvent.change(shadow().getByLabelText("Titel"), { target: { value: "Kaputt" } });
    fireEvent.click(shadow().getByRole("button", { name: "Absenden" }));
    expect(await shadow().findByText("Das Feedback-Postfach ist nicht richtig verbunden.")).toBeTruthy();
    expect(shadow().queryByText("Notion rejected the API token.")).toBeNull();
    fireEvent.click(shadow().getByRole("button", { name: "Absenden" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(await shadow().findByText("I'm a teapot.")).toBeTruthy();
  });

  it("shows category labels for the active locale and still submits the id", async () => {
    const { client, submit } = makeClient([OK]);
    render(
      <FeedbackWidget
        client={client}
        capturer={makeCapturer().capturer}
        locale={de}
        categories={[{ id: "perf", label: "Performance", labels: { de: "Leistung" } }, "bug", { id: "design", label: "UI" }]}
      />,
    );
    await openDialog("Feedback geben");
    expect(shadow().getByRole("radio", { name: "Leistung" })).toBeTruthy();
    expect(shadow().getByRole("radio", { name: "Fehler" })).toBeTruthy();
    expect(shadow().queryByRole("radio", { name: "Performance" })).toBeNull();
    expect(shadow().getByRole("radio", { name: "UI" })).toBeTruthy();
    fireEvent.click(shadow().getByRole("radio", { name: "Leistung" }));
    fireEvent.change(shadow().getByLabelText("Titel"), { target: { value: "Langsam" } });
    fireEvent.click(shadow().getByRole("button", { name: "Absenden" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]![0].category).toBe("perf");
  });

  it("formats the zoom level and pending badge with Intl", async () => {
    const { client, pending } = makeClient();
    pending.mockResolvedValue([
      { submission: {} as never, files: {}, attempts: 1 },
      { submission: {} as never, files: {}, attempts: 1 },
    ]);
    render(<FeedbackWidget client={client} capturer={makeCapturer().capturer} locale={de} />);
    expect(await shadow().findByRole("button", { name: "Feedback geben, 2 unsent reports" })).toBeTruthy();
    await openDialog(/Feedback geben/);
    const zoom = shadow().getByRole("button", { name: /^Reset zoom to/ });
    await waitFor(() => expect(zoom.textContent).toBe(new Intl.NumberFormat("de", { style: "percent" }).format(1)));
    expect(zoom.getAttribute("aria-label")).toBe(`Reset zoom to ${zoom.textContent}`);
  });
});
