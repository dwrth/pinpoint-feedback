import { en, mergeLocale, type Annotation, type LocaleBundle, type ReportMessages } from "@pinpoint-feedback/core";
import { describe, expect, it } from "vitest";
import { buildChildren, createFeedbackRequestHandler } from "../src/index";
import { FakeNotion, makeBackend, makeRequest, makeSubmission, silentLogger } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const withLocale = (locale: string, report: Partial<ReportMessages>): LocaleBundle => ({ ...mergeLocale(en, { report }), locale });

const de = withLocale("de", {
  callout: "{category} · {priority}",
  calloutWithReporter: "{category} · {priority} · gemeldet von {reporter}",
  priorityHigh: "Hohe Priorität",
  priorityLow: "Niedrige Priorität",
  headingDescription: "Beschreibung",
  headingAnnotations: "Anmerkungen",
  headingCaptureNotes: "Hinweise zur Aufnahme",
  headingEnvironment: "Umgebung",
  noDescription: "Keine Beschreibung angegeben.",
  pinNoNote: "(keine Notiz)",
  shapesLabel: "Formen",
  quotedText: "„{text}“",
  arrowCount: { one: "# Pfeil", other: "# Pfeile" },
  rectangleCount: { one: "# Rechteck", other: "# Rechtecke" },
  warningCrossOriginIframe: { one: "Ein fremder iframe fehlt.", other: "# fremde iframes fehlen." },
  envBrowser: "Browser",
  envPixelRatio: "Pixelverhältnis",
  envSubmittedAt: "Gesendet am",
  dateTimeUtc: "{dateTime} UTC",
  submissionId: "Einreichungs-ID",
});

const pl = withLocale("pl", {
  rectangleCount: { one: "# prostokąt", few: "# prostokąty", many: "# prostokątów", other: "# prostokąta" },
  warningVideo: { one: "# wideo (one)", few: "# wideo (few)", many: "# wideo (many)", other: "# wideo (other)" },
});

const textOf = (block: Any): string => (block[block.type]?.rich_text ?? []).map((r: Any) => r.text.content).join("");
const texts = (blocks: Any[]) => blocks.map(textOf);
const rect = (id: string): Annotation => ({ id, type: "rectangle", x: 0, y: 0, width: 5, height: 5, color: "#f00", strokeWidth: 2 });
const arrow = (id: string): Annotation => ({ id, type: "arrow", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: "#f00", strokeWidth: 2 });

describe("localized report", () => {
  it("renders the page body in another locale", () => {
    const s = makeSubmission({
      description: "",
      createdAt: "2026-03-05T14:07:00.000Z",
      annotations: [
        { id: "p", type: "pin", at: { x: 1, y: 1 }, number: 1, color: "#f00", strokeWidth: 2 },
        { id: "t", type: "text", at: { x: 1, y: 1 }, text: "Hallo", color: "#f00", strokeWidth: 2, fontSize: 16 },
        arrow("a1"),
        arrow("a2"),
        rect("r1"),
      ],
      metadata: { ...makeSubmission().metadata, devicePixelRatio: 1.5, viewport: { width: 1440, height: 900 } },
    });
    const out = texts(buildChildren(s, {}, undefined, de));
    expect(out[0]).toBe("Bug · Hohe Priorität · gemeldet von Ada");
    expect(out).toEqual(expect.arrayContaining(["Beschreibung", "Keine Beschreibung angegeben.", "Anmerkungen", "Umgebung"]));
    expect(out).toContain("#1 (keine Notiz)");
    expect(out).toContain("Text: „Hallo“");
    expect(out).toContain("Formen: 2 Pfeile und 1 Rechteck");
    expect(out).toContain("Pixelverhältnis: 1,5");
    expect(out).toContain("Viewport: 1440×900");
    expect(out).toContain("Gesendet am: 05.03.2026, 14:07 UTC");
    expect(out.at(-1)).toBe(`Einreichungs-ID: ${s.submissionId}`);
  });

  it("uses CLDR plural categories of the locale", () => {
    const count = (n: number) =>
      texts(buildChildren(makeSubmission({ annotations: Array.from({ length: n }, (_, i) => rect(`r${i}`)) }), {}, undefined, pl)).find(
        (t) => t.includes("prostok"),
      );
    expect(count(1)).toBe("Shapes: 1 prostokąt");
    expect(count(3)).toBe("Shapes: 3 prostokąty");
    expect(count(5)).toBe("Shapes: 5 prostokątów");
    expect(count(22)).toBe("Shapes: 22 prostokąty");

    const video = (n: number) =>
      texts(
        buildChildren(makeSubmission({ capture: { method: "dom", width: 1, height: 1, warnings: [{ code: "video", count: n, message: "x" }] } }), {}, undefined, pl),
      ).find((t) => t.includes("wideo"));
    expect(video(2)).toBe("2 wideo (few)");
    expect(video(12)).toBe("12 wideo (many)");
  });

  it("renders capture warnings from code and count, not the client message", () => {
    const s = makeSubmission({
      capture: {
        method: "display-media",
        width: 1920,
        height: 1080,
        warnings: [
          { code: "cross-origin-iframe", count: 3, message: "IGNORED" },
          { code: "cross-origin-image", count: 1, message: "IGNORED" },
          { code: "font", message: "IGNORED" },
          { code: "downscaled", message: "IGNORED" },
          { code: "made-up" as Any, count: 2, message: "IGNORED" },
        ],
      },
    });
    const out = texts(buildChildren(s, {}));
    const notes = out.slice(out.indexOf("Capture notes") + 1, out.indexOf("Environment"));
    expect(notes).toEqual([
      "3 cross-origin iframes could not be captured.",
      "A cross-origin image could not be loaded for the screenshot.",
      en.report.warningFont.other,
      en.report.warningDownscaled.other,
      "2 elements could not be captured.",
    ]);
    expect(out).toContain("Capture method: Screen capture (1920×1080)");
    expect(texts(buildChildren(s, {}, undefined, de))).toContain("3 fremde iframes fehlen.");
  });

  it("formats the submission time with Intl in UTC and skips invalid dates", () => {
    const at = (createdAt: string, locale: LocaleBundle = en) =>
      texts(buildChildren(makeSubmission({ createdAt }), {}, undefined, locale)).find((t) => /^(Submitted at|Gesendet am):/.test(t));
    expect(at("2026-03-05T23:30:00.000Z")).toBe("Submitted at: Mar 5, 2026, 11:30 PM UTC");
    expect(at("2026-03-05T23:30:00.000+02:00", de)).toBe("Gesendet am: 05.03.2026, 21:30 UTC");
    expect(at("not a date")).toBeUndefined();
  });

  it("uses per-locale category labels in the body but the plain label in the Category property", async () => {
    const fake = new FakeNotion();
    const categories = [{ id: "perf", label: "Performance", labels: { de: "Leistung" } }];
    await makeBackend(fake, { locale: { ...de, locale: "de-AT" }, categories }).createRecord({
      submission: makeSubmission({ category: "perf", priority: "low", reporter: undefined }),
    });
    const page = fake.pages[0]!;
    expect(textOf(page.children[0])).toBe("Leistung · Niedrige Priorität");
    expect(page.properties.Category).toEqual({ select: { name: "Performance" } });
  });

  it("never localizes property names or select option names", async () => {
    const run = async (locale?: LocaleBundle) => {
      const fake = new FakeNotion();
      await makeBackend(fake, { locale }).createRecord({ submission: makeSubmission({ submissionId: "0f8fad5b-d9cb-469f-a165-0000000000aa", createdAt: "2026-03-05T14:07:00.000Z" }) });
      const schema = Object.fromEntries(
        Object.entries<Any>(fake.schema).map(([name, cfg]) => [name, (cfg[cfg.type]?.options ?? []).map((o: Any) => o.name)]),
      );
      return { properties: fake.pages[0]!.properties, schema };
    };
    const english = await run();
    const german = await run(de);
    expect(german).toEqual(english);
    expect(german.properties.Priority).toEqual({ select: { name: "High" } });
    expect(german.properties.Category).toEqual({ select: { name: "Bug" } });
    expect(german.properties.Status).toEqual({ select: { name: "New" } });
  });
});

describe("locale options precedence", () => {
  const notionOptions = (fake: FakeNotion) => ({
    apiKey: "secret_test",
    databaseId: "0123456789abcdef0123456789abcdef",
    client: fake.asClient(),
    throttle: { requestsPerSecond: Infinity, maxConcurrent: 3 },
    retry: { baseDelayMs: 1, maxDelayMs: 2 },
  });
  const submitWith = async (options: Parameters<typeof createFeedbackRequestHandler>[0] & { fake: FakeNotion }) => {
    const { fake, ...rest } = options;
    const h = createFeedbackRequestHandler({ logger: silentLogger, ...rest });
    expect((await h(makeRequest(makeSubmission({ reporter: undefined })))).status).toBe(201);
    return texts(fake.pages[0]!.children);
  };

  it("passes the handler locale and messages to the Notion backend", async () => {
    const fake = new FakeNotion();
    const out = await submitWith({ fake, notion: notionOptions(fake), locale: de, messages: { report: { headingEnvironment: "System" } } });
    expect(out[0]).toBe("Bug · Hohe Priorität");
    expect(out).toContain("Beschreibung");
    expect(out).toContain("System");
    expect(out).not.toContain("Umgebung");
  });

  it("lets notion.locale and notion.messages override the handler options", async () => {
    const fake = new FakeNotion();
    const out = await submitWith({
      fake,
      notion: { ...notionOptions(fake), locale: en, messages: { report: { headingDescription: "Details" } } },
      locale: de,
      messages: { report: { headingEnvironment: "System" } },
    });
    expect(out[0]).toBe("Bug · High priority");
    expect(out).toContain("Details");
    expect(out).toContain("Environment");
    expect(out).not.toContain("System");
  });

  it("applies handler messages on top of notion.locale when notion.messages is unset", async () => {
    const fake = new FakeNotion();
    const out = await submitWith({ fake, notion: { ...notionOptions(fake), locale: de }, messages: { report: { headingDescription: "Text" } } });
    expect(out).toContain("Text");
    expect(out).toContain("Umgebung");
  });

  it("keeps API error messages in English", async () => {
    const fake = new FakeNotion();
    const h = createFeedbackRequestHandler({ notion: notionOptions(fake), locale: de, logger: silentLogger });
    const body = await (await h(makeRequest("{"))).json();
    expect(body.error).toMatchObject({ code: "validation", message: "The submission data is not valid JSON." });
  });
});
