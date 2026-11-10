import { CategoryConfigError, defineCategories } from "@pinpoint-feedback/core";
import { describe, expect, it, vi } from "vitest";
import { CATEGORY_LABELS, CATEGORY_OPTIONS, createFeedbackRequestHandler, NotionFeedbackBackend } from "../src/index";
import { FakeNotion, makeBackend, makeRequest, makeSubmission, silentLogger } from "./helpers";

const categories = defineCategories([
  { id: "perf", label: "Performance", color: "orange", emoji: "🚀" },
  { id: "a11y", label: "Accessibility" },
  "bug",
]);

const notionOptions = (fake: FakeNotion) => ({
  apiKey: "secret_test",
  databaseId: "0123456789abcdef0123456789abcdef",
  client: fake.asClient(),
  throttle: { requestsPerSecond: Infinity, maxConcurrent: 3 },
  retry: { baseDelayMs: 1, maxDelayMs: 2 },
});

const callout = (fake: FakeNotion) => fake.pages[0]!.children.find((b) => b.type === "callout").callout;
const optionsOf = (fake: FakeNotion, name = "Category") =>
  fake.schema[name][fake.schema[name].type].options as Array<{ id: string; name: string; color: string }>;

describe("handler categories", () => {
  it("accepts configured categories and rejects others with a hint", async () => {
    const createRecord = vi.fn(async () => ({ id: "rec-1", duplicate: false }));
    const h = createFeedbackRequestHandler({ backend: { createRecord }, categories, logger: silentLogger });

    expect((await h(makeRequest(makeSubmission({ category: "perf" })))).status).toBe(201);
    expect((await h(makeRequest(makeSubmission({ category: "bug" })))).status).toBe(201);

    const res = await h(makeRequest(makeSubmission({ category: "design" })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation");
    const issue = body.error.details.issues.find((i: { path: string }) => i.path === "category");
    expect(issue.message).toMatch(/perf, a11y, bug/);
    expect(issue.message).toMatch(/configure the same categories on the server/);
    expect(createRecord).toHaveBeenCalledTimes(2);
  });

  it("rejects custom ids when using the default categories", async () => {
    const h = createFeedbackRequestHandler({ backend: { createRecord: vi.fn() }, logger: silentLogger });
    expect((await h(makeRequest(makeSubmission({ category: "perf" })))).status).toBe(400);
  });

  it("throws CategoryConfigError at creation for invalid config", () => {
    const backend = { createRecord: vi.fn() };
    expect(() => createFeedbackRequestHandler({ backend, categories: [] })).toThrow(CategoryConfigError);
    expect(() => createFeedbackRequestHandler({ backend, categories: [{ id: "x", label: "A, B" }] })).toThrow(CategoryConfigError);
    expect(() =>
      createFeedbackRequestHandler({ backend, categories: [{ id: "x", label: "X" }, { id: "x", label: "Y" }] }),
    ).toThrow(CategoryConfigError);
    expect(() =>
      createFeedbackRequestHandler({ notion: { apiKey: "k", databaseId: "d", categories: ["nope" as "bug"] } }),
    ).toThrow(CategoryConfigError);
  });

  it("passes its categories to the Notion backend it creates", async () => {
    const fake = new FakeNotion();
    const h = createFeedbackRequestHandler({ notion: notionOptions(fake), categories, logger: silentLogger });
    expect((await h(makeRequest(makeSubmission({ category: "perf" })))).status).toBe(201);
    expect(fake.pages[0]!.properties.Category).toEqual({ select: { name: "Performance" } });
    expect(optionsOf(fake).map((o) => [o.name, o.color])).toEqual([
      ["Performance", "orange"],
      ["Accessibility", "default"],
      ["Bug", "red"],
    ]);
  });

  it("lets notion.categories override the handler categories for the backend", async () => {
    const fake = new FakeNotion();
    const h = createFeedbackRequestHandler({
      notion: { ...notionOptions(fake), categories: [{ id: "perf", label: "Speed" }] },
      categories,
      logger: silentLogger,
    });
    expect((await h(makeRequest(makeSubmission({ category: "perf" })))).status).toBe(201);
    expect(fake.pages[0]!.properties.Category).toEqual({ select: { name: "Speed" } });
  });
});

describe("NotionFeedbackBackend categories", () => {
  it("defaults to the built-in categories", async () => {
    const fake = new FakeNotion();
    const backend = makeBackend(fake);
    expect(backend.categories.map((c) => c.id)).toEqual(["bug", "design", "content", "feature", "other"]);
    await backend.createRecord({ submission: makeSubmission({ category: "feature" }) });
    expect(fake.pages[0]!.properties.Category).toEqual({ select: { name: "Feature request" } });
    expect(callout(fake).icon).toEqual({ type: "emoji", emoji: "✨" });
    expect(optionsOf(fake).map(({ name, color }) => ({ name, color }))).toEqual(CATEGORY_OPTIONS);
    expect(CATEGORY_LABELS.feature).toBe("Feature request");
  });

  it("writes the label, the emoji and a fallback emoji", async () => {
    const fake = new FakeNotion();
    const backend = makeBackend(fake, { categories });
    await backend.createRecord({ submission: makeSubmission({ category: "perf", priority: "low" }) });
    expect(fake.pages[0]!.properties.Category).toEqual({ select: { name: "Performance" } });
    expect(callout(fake).icon).toEqual({ type: "emoji", emoji: "🚀" });
    expect(callout(fake).rich_text[0].text.content).toMatch(/^Performance · Low priority/);

    fake.pages = [];
    await backend.createRecord({ submission: makeSubmission({ category: "a11y" }) });
    expect(fake.pages[0]!.properties.Category).toEqual({ select: { name: "Accessibility" } });
    expect(callout(fake).icon).toEqual({ type: "emoji", emoji: "💬" });
  });

  it("adds missing options to an existing select without dropping existing ones", async () => {
    const fake = new FakeNotion();
    fake.schema.Category = {
      id: "c",
      name: "Category",
      type: "select",
      select: { options: [{ id: "o1", name: "Bug", color: "brown" }, { id: "o2", name: "Legacy", color: "pink" }] },
    };
    const info = vi.fn();
    const backend = makeBackend(fake, { categories, logger: { ...silentLogger, info } });
    const schema = await backend.getSchema();

    const update = fake.calls.find((c) => c.method === "dataSources.update")!;
    expect(update.args.properties.Category).toEqual({
      select: {
        options: [
          { id: "o1", name: "Bug" },
          { id: "o2", name: "Legacy" },
          { name: "Performance", color: "orange" },
          { name: "Accessibility", color: "default" },
        ],
      },
    });
    expect(optionsOf(fake).map((o) => [o.id, o.name, o.color])).toEqual([
      ["o1", "Bug", "brown"],
      ["o2", "Legacy", "pink"],
      [expect.any(String), "Performance", "orange"],
      [expect.any(String), "Accessibility", "default"],
    ]);
    expect(schema.properties.category?.options).toEqual(["Bug", "Legacy", "Performance", "Accessibility"]);
    expect(schema.created).not.toContain("Category");
    expect(info).toHaveBeenCalledWith(expect.stringContaining("Performance, Accessibility"));
  });

  it("does not update the Category select when all options exist", async () => {
    const fake = new FakeNotion();
    const backend = makeBackend(fake, { categories });
    await backend.getSchema();
    const second = makeBackend(fake, { categories: ["bug"] });
    await second.getSchema();
    expect(fake.count("dataSources.update")).toBe(1);
  });

  it("adds options to an existing multi_select", async () => {
    const fake = new FakeNotion();
    fake.schema.Category = { id: "c", name: "Category", type: "multi_select", multi_select: { options: [{ id: "o1", name: "Bug" }] } };
    const backend = makeBackend(fake, { categories });
    await backend.createRecord({ submission: makeSubmission({ category: "perf" }) });
    expect(optionsOf(fake).map((o) => o.name)).toEqual(["Bug", "Performance", "Accessibility"]);
    expect(fake.pages[0]!.properties.Category).toEqual({ multi_select: [{ name: "Performance" }] });
  });

  it("leaves the schema alone when autoSetupSchema is false", async () => {
    const fake = new FakeNotion();
    fake.schema.Category = { id: "c", name: "Category", type: "select", select: { options: [{ id: "o1", name: "Bug" }] } };
    await makeBackend(fake, { categories, autoSetupSchema: false }).getSchema();
    expect(fake.count("dataSources.update")).toBe(0);
  });

  it("warns for a status Category property and only writes existing options", async () => {
    const fake = new FakeNotion();
    fake.schema.Category = { id: "c", name: "Category", type: "status", status: { options: [{ id: "o1", name: "Bug" }] } };
    const warn = vi.fn();
    const backend = makeBackend(fake, { categories, logger: { ...silentLogger, warn } });

    await backend.createRecord({ submission: makeSubmission({ category: "perf" }) });
    await backend.createRecord({ submission: makeSubmission({ category: "bug" }) });

    const update = fake.calls.find((c) => c.method === "dataSources.update");
    expect(update?.args.properties.Category).toBeUndefined();
    const statusWarnings = warn.mock.calls.filter(([m]) => String(m).includes('"Category" is a status property'));
    expect(statusWarnings).toHaveLength(1);
    expect(statusWarnings[0]![0]).toContain('"Performance", "Accessibility"');
    expect(fake.pages[0]!.properties.Category).toBeUndefined();
    expect(fake.pages[1]!.properties.Category).toEqual({ status: { name: "Bug" } });
  });

  it("throws CategoryConfigError for invalid backend categories", () => {
    expect(() => new NotionFeedbackBackend({ apiKey: "k", databaseId: "0123456789abcdef0123456789abcdef", categories: [] })).toThrow(CategoryConfigError);
  });
});
