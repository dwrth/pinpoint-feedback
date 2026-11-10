import { APIErrorCode } from "@notionhq/client";
import { describe, expect, it, vi } from "vitest";
import { NOTION_TEXT_MAX, NotionFileUploader, buildChildren, chunkText, richText, type NotionPropertyNames } from "../src/index";
import { FakeNotion, makeBackend, makeSubmission, notionError, pngBlob, silentLogger } from "./helpers";

const files = (id: string) => ({
  screenshot: { data: pngBlob(), filename: `pinpoint-${id}-original.png`, contentType: "image/png" },
  annotatedScreenshot: { data: pngBlob(), filename: `pinpoint-${id}-annotated.png`, contentType: "image/png" },
});

describe("NotionFeedbackBackend", () => {
  it("creates a page in the data source with properties, uploads and body", async () => {
    const fake = new FakeNotion();
    const backend = makeBackend(fake, { projectId: "web" });
    const submission = makeSubmission();
    const record = await backend.createRecord({ submission, ...files("abc") });
    expect(record).toEqual({ id: "page-3", url: "https://www.notion.so/page-3", duplicate: false });

    expect(fake.calls[0]).toMatchObject({ method: "databases.retrieve", args: { database_id: "01234567-89ab-cdef-0123-456789abcdef" } });
    expect(fake.count("fileUploads.create")).toBe(2);
    expect(fake.calls.find((c) => c.method === "fileUploads.create")!.args).toMatchObject({ mode: "single_part", content_type: "image/png" });

    const page = fake.pages[0]!;
    expect(page.parent).toEqual({ type: "data_source_id", data_source_id: "ds-1" });
    const p = page.properties;
    expect(p.Name.title[0].text.content).toBe(submission.title);
    expect(p.Status).toEqual({ select: { name: "New" } });
    expect(p.Priority).toEqual({ select: { name: "High" } });
    expect(p.Category).toEqual({ select: { name: "Bug" } });
    expect(p["Website URL"]).toEqual({ url: "https://shop.example.com/checkout" });
    expect(p["Reporter Email"]).toEqual({ email: "ada@example.com" });
    expect(p.Viewport.rich_text[0].text.content).toBe("1440×900 @2x");
    expect(p.Browser.rich_text[0].text.content).toBe("Chrome 120");
    expect(p.Project.rich_text[0].text.content).toBe("web");
    expect(p["Submission ID"].rich_text[0].text.content).toBe(submission.submissionId);
    expect(p.Created).toEqual({ date: { start: submission.createdAt } });
    expect(p["Annotated Screenshot"].files[0]).toMatchObject({ type: "file_upload", name: "pinpoint-abc-annotated.png" });
    const annotatedId = p["Annotated Screenshot"].files[0].file_upload.id;

    const images = page.children.filter((b) => b.type === "image");
    expect(images).toHaveLength(2);
    expect(images[0].image).toMatchObject({ type: "file_upload", file_upload: { id: annotatedId } });
    const text = JSON.stringify(page.children);
    expect(text).toContain("A cross-origin iframe could not be captured.");
    expect(text).not.toContain("Cross-origin iframe was not captured");
    expect(text).toContain("#1");
    expect(text).toContain("1 arrow");
    expect(text).toContain("Europe/Berlin");
  });

  it("auto-setup adds only missing properties, keeping the existing title and status type", async () => {
    const fake = new FakeNotion();
    fake.schema = {
      "Feedback": { id: "t", name: "Feedback", type: "title", title: {} },
      Status: { id: "s", name: "Status", type: "status", status: { options: [{ name: "Not started" }, { name: "New" }] } },
      Priority: { id: "p", name: "Priority", type: "select", select: { options: [] } },
      Browser: { id: "b", name: "Browser", type: "number", number: {} },
    };
    const warn = vi.fn();
    const backend = makeBackend(fake, { logger: { ...silentLogger, warn } });
    const schema = await backend.getSchema();
    const update = fake.calls.find((c) => c.method === "dataSources.update")!;
    const added = Object.keys(update.args.properties);
    expect(added).not.toContain("Status");
    expect(added).not.toContain("Priority");
    expect(added).not.toContain("Browser");
    expect(added).not.toContain("Title");
    expect(added).toEqual(expect.arrayContaining(["Description", "Category", "Screenshot", "Submission ID", "Created"]));
    expect(update.args.properties.Category.select.options.map((o: { name: string }) => o.name)).toContain("Feature request");
    expect(schema.properties.title?.name).toBe("Feedback");
    expect(schema.properties.status?.type).toBe("status");
    expect(schema.properties.browser).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"Browser"'));

    await backend.createRecord({ submission: makeSubmission() });
    const p = fake.pages[0]!.properties;
    expect(p.Status).toEqual({ status: { name: "New" } });
    expect(p.Feedback.title[0].text.content).toBe("Button is misaligned");
    expect(p.Browser).toBeUndefined();
    expect(fake.count("dataSources.retrieve")).toBe(1);
  });

  it("skips status when the default is not a status option", async () => {
    const fake = new FakeNotion();
    fake.schema.Status = { id: "s", name: "Status", type: "status", status: { options: [{ name: "Not started" }] } };
    await makeBackend(fake).createRecord({ submission: makeSubmission() });
    expect(fake.pages[0]!.properties.Status).toBeUndefined();
  });

  it("falls back to the first To-do option of a status property and logs the choice once", async () => {
    const fake = new FakeNotion();
    fake.schema.Status = {
      id: "s",
      name: "Status",
      type: "status",
      status: {
        options: [
          { id: "o1", name: "In progress" },
          { id: "o2", name: "Done" },
          { id: "o3", name: "Backlog" },
          { id: "o4", name: "Not started" },
        ],
        groups: [
          { id: "g1", name: "To-do", option_ids: ["o3", "o4"] },
          { id: "g2", name: "In progress", option_ids: ["o1"] },
          { id: "g3", name: "Complete", option_ids: ["o2"] },
        ],
      },
    };
    const info = vi.fn();
    const backend = makeBackend(fake, { logger: { ...silentLogger, info } });
    await backend.createRecord({ submission: makeSubmission() });
    await backend.createRecord({ submission: makeSubmission() });
    expect(fake.pages.map((p) => p.properties.Status)).toEqual([{ status: { name: "Backlog" } }, { status: { name: "Backlog" } }]);
    expect(fake.count("dataSources.update")).toBe(1);
    expect(fake.calls.find((c) => c.method === "dataSources.update")!.args.properties.Status).toBeUndefined();
    const statusLogs = info.mock.calls.filter(([m]) => String(m).includes('"Backlog"'));
    expect(statusLogs).toHaveLength(1);
    expect(statusLogs[0]![0]).toContain("To-do");
  });

  it("prefers statusDefault over the To-do group when it is an option", async () => {
    const fake = new FakeNotion();
    fake.schema.Status = {
      id: "s",
      name: "Status",
      type: "status",
      status: {
        options: [{ id: "o1", name: "Not started" }, { id: "o2", name: "Triage" }],
        groups: [{ id: "g1", name: "To-do", option_ids: ["o1", "o2"] }],
      },
    };
    await makeBackend(fake, { statusDefault: "Triage" }).createRecord({ submission: makeSubmission() });
    expect(fake.pages[0]!.properties.Status).toEqual({ status: { name: "Triage" } });
  });

  it("uses the first status group when no group is named To-do", async () => {
    const fake = new FakeNotion();
    fake.schema.Status = {
      id: "s",
      name: "Status",
      type: "status",
      status: {
        options: [{ id: "o1", name: "Erledigt" }, { id: "o2", name: "Nicht begonnen" }],
        groups: [{ id: "g1", name: "Zu erledigen", option_ids: ["o2"] }, { id: "g2", name: "Abgeschlossen", option_ids: ["o1"] }],
      },
    };
    await makeBackend(fake).createRecord({ submission: makeSubmission() });
    expect(fake.pages[0]!.properties.Status).toEqual({ status: { name: "Nicht begonnen" } });
  });

  it("skips status and warns when a status property has no To-do option", async () => {
    const fake = new FakeNotion();
    fake.schema.Status = {
      id: "s",
      name: "Status",
      type: "status",
      status: { options: [{ id: "o1", name: "Done" }], groups: [{ id: "g1", name: "To-do", option_ids: [] }, { id: "g3", name: "Complete", option_ids: ["o1"] }] },
    };
    const warn = vi.fn();
    await makeBackend(fake, { logger: { ...silentLogger, warn } }).createRecord({ submission: makeSubmission() });
    expect(fake.pages[0]!.properties.Status).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("without a status"));
  });

  it("writes the server projectId over the submission's, and the submission's when the server has none", async () => {
    const fake = new FakeNotion();
    await makeBackend(fake, { projectId: "server" }).createRecord({ submission: makeSubmission({ projectId: "client" }) });
    await makeBackend(fake).createRecord({ submission: makeSubmission({ projectId: "client" }) });
    expect(fake.pages.map((p) => p.properties.Project.rich_text[0].text.content)).toEqual(["server", "client"]);
  });

  it("lists blank canvases in the capture notes", () => {
    const submission = makeSubmission({ capture: { method: "dom", width: 10, height: 10, warnings: [{ code: "blank-canvas", message: "x", count: 2 }] } });
    const text = JSON.stringify(buildChildren(submission, {}));
    expect(text).toContain("2 canvases appeared empty in the screenshot.");
  });

  it("does not modify the schema when autoSetupSchema is false", async () => {
    const fake = new FakeNotion();
    await makeBackend(fake, { autoSetupSchema: false }).createRecord({ submission: makeSubmission() });
    expect(fake.count("dataSources.update")).toBe(0);
    expect(Object.keys(fake.pages[0]!.properties)).toEqual(["Name"]);
    expect(fake.count("dataSources.query")).toBe(0);
  });

  it("honours custom property names", async () => {
    const fake = new FakeNotion();
    const properties: Partial<NotionPropertyNames> = { submissionId: "Idempotency Key", websiteUrl: "Page URL" };
    await makeBackend(fake, { properties }).createRecord({ submission: makeSubmission() });
    expect(fake.pages[0]!.properties["Idempotency Key"]).toBeDefined();
    expect(fake.pages[0]!.properties["Page URL"]).toBeDefined();
  });

  it("finds duplicates by Submission ID", async () => {
    const fake = new FakeNotion();
    const backend = makeBackend(fake);
    const submission = makeSubmission();
    await backend.createRecord({ submission });
    const again = await backend.createRecord({ submission, ...files("x") });
    expect(again).toMatchObject({ id: "page-1", duplicate: true });
    expect(fake.count("fileUploads.create")).toBe(0);
    const query = fake.calls.find((c) => c.method === "dataSources.query")!;
    expect(query.args).toMatchObject({ data_source_id: "ds-1", filter: { property: "Submission ID", rich_text: { equals: submission.submissionId } } });
    expect(await backend.findBySubmissionId("0f8fad5b-d9cb-469f-a165-ffffffffffff")).toBeUndefined();
  });

  it("refreshes the schema once on a Notion validation error", async () => {
    const fake = new FakeNotion();
    const backend = makeBackend(fake);
    fake.failures["pages.create"] = [notionError(400, APIErrorCode.ValidationError)];
    const record = await backend.createRecord({ submission: makeSubmission() });
    expect(record.duplicate).toBe(false);
    expect(fake.count("dataSources.retrieve")).toBe(2);
    expect(fake.count("pages.create")).toBe(2);
  });

  it("appends children beyond 100 blocks in batches", async () => {
    const fake = new FakeNotion();
    const annotations = Array.from({ length: 250 }, (_, i) => ({
      id: `p${i}`, type: "pin" as const, at: { x: i, y: i }, number: i + 1, note: `note ${i}`, color: "#f00", strokeWidth: 2,
    }));
    const submission = makeSubmission({ annotations });
    const expected = buildChildren(submission, {}).length;
    await makeBackend(fake).createRecord({ submission });
    const create = fake.calls.find((c) => c.method === "pages.create")!;
    expect(create.args.children).toHaveLength(100);
    const appends = fake.calls.filter((c) => c.method === "blocks.children.append");
    expect(appends.length).toBe(Math.ceil((expected - 100) / 100));
    for (const a of appends) expect(a.args.children.length).toBeLessThanOrEqual(100);
    expect(fake.pages[0]!.children).toHaveLength(expected);
  });

  it("keeps the full description in the body and truncates the property", async () => {
    const fake = new FakeNotion();
    const description = "a".repeat(4500);
    await makeBackend(fake).createRecord({ submission: makeSubmission({ description }) });
    const page = fake.pages[0]!;
    const prop = page.properties.Description.rich_text;
    expect(prop.map((t: { text: { content: string } }) => t.text.content).join("").length).toBeLessThanOrEqual(2000);
    const para = page.children.find((b) => b.type === "paragraph");
    const body = para.paragraph.rich_text.map((t: { text: { content: string } }) => t.text.content).join("");
    expect(body).toBe(description);
    expect(para.paragraph.rich_text.length).toBe(3);
  });

  it("resolves a data source id passed in place of the database id", async () => {
    const fake = new FakeNotion();
    fake.failures["databases.retrieve"] = [notionError(404, APIErrorCode.ObjectNotFound)];
    const schema = await makeBackend(fake).getSchema();
    expect(schema.dataSourceId).toBe("01234567-89ab-cdef-0123-456789abcdef");
  });

  it("does not cache a failed schema resolution", async () => {
    const fake = new FakeNotion();
    fake.failures["databases.retrieve"] = [notionError(401, APIErrorCode.Unauthorized)];
    const backend = makeBackend(fake);
    await expect(backend.getSchema()).rejects.toMatchObject({ code: "notion_unauthorized" });
    await expect(backend.getSchema()).resolves.toMatchObject({ dataSourceId: "ds-1" });
  });

  it("retries uploads on transient errors", async () => {
    const fake = new FakeNotion();
    fake.failures["fileUploads.send"] = [notionError(503, APIErrorCode.ServiceUnavailable)];
    const uploader = new NotionFileUploader(fake.asClient(), undefined, { baseDelayMs: 1 });
    const res = await uploader.upload({ data: pngBlob(), filename: "x.png", contentType: "image/png" });
    expect(res.filename).toBe("x.png");
    expect(fake.count("fileUploads.create")).toBe(2);
  });
});

describe("rich text", () => {
  it("chunks into 2000-character objects and caps at 100", () => {
    expect(chunkText("x".repeat(4001)).map((c) => c.length)).toEqual([2000, 2000, 1]);
    const rt = richText("y".repeat(NOTION_TEXT_MAX * 101));
    expect(rt).toHaveLength(100);
    expect(rt.every((t) => t.text.content.length <= NOTION_TEXT_MAX)).toBe(true);
    expect(rt[99]!.text.content.endsWith("…")).toBe(true);
  });

  it("does not split surrogate pairs", () => {
    const text = "a".repeat(1999) + "😀" + "b";
    const chunks = chunkText(text);
    expect(chunks[0]).toHaveLength(1999);
    expect(chunks[1]!.startsWith("😀")).toBe(true);
  });
});
