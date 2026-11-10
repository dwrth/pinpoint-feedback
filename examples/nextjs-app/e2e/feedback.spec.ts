import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const MOCK = "http://127.0.0.1:3999";

interface MockPage {
  id: string;
  url: string;
  plain: Record<string, unknown>;
  children: Array<Record<string, any>>;
}

interface MockUpload {
  id: string;
  status: string;
  filename: string;
  content_type: string;
  content_length: number;
  magic: string;
  attachedTo: string[];
}

async function mockPages(request: APIRequestContext): Promise<MockPage[]> {
  return (await (await request.get(`${MOCK}/__mock/pages`)).json()).pages;
}

async function mockSchema(request: APIRequestContext): Promise<Record<string, any>> {
  return (await (await request.get(`${MOCK}/__mock/schema`)).json()).properties;
}

async function mockUploads(request: APIRequestContext): Promise<MockUpload[]> {
  return (await (await request.get(`${MOCK}/__mock/uploads`)).json()).uploads;
}

function blockText(block: Record<string, any>): string {
  const body = block[block.type] ?? {};
  return (body.rich_text ?? []).map((t: any) => t.text?.content ?? "").join("");
}

/** The server rejects submissions sent sooner than 1.5 s after the widget opened (anti-bot check). */
const MIN_FILL_TIME_MS = 2_000;
const openedAt = new WeakMap<Page, number>();

async function waitForHumanFillTime(page: Page) {
  const elapsed = Date.now() - (openedAt.get(page) ?? 0);
  if (elapsed < MIN_FILL_TIME_MS) await page.waitForTimeout(MIN_FILL_TIME_MS - elapsed);
}

let ipCounter = 0;

/** Gives each test its own client IP so the server's per-IP rate limit never interferes. */
async function useDistinctClientIp(page: Page) {
  const ip = `10.0.${Math.floor(Math.random() * 250)}.${++ipCounter}`;
  await page.route("**/api/feedback", (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }),
  );
}

async function openWidget(page: Page): Promise<Locator> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("iframe.embed").scrollIntoViewIfNeeded();

  const button = page.getByRole("button", { name: "Feedback", exact: true });
  await expect(button).toBeVisible();
  await button.click();
  openedAt.set(page, Date.now());

  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("pinpoint-editor").locator("canvas").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Rectangle" })).toBeEnabled();
  return dialog;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

async function annotate(page: Page, dialog: Locator) {
  const editor = dialog.getByTestId("pinpoint-editor");
  const box = (await editor.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  await dialog.getByRole("button", { name: "Pin", exact: true }).click();
  const pin = at(0.3, 0.35);
  await page.mouse.click(pin.x, pin.y);

  await dialog.getByRole("button", { name: "Rectangle" }).click();
  await drag(page, at(0.5, 0.3), at(0.75, 0.6));
}

test("offers the categories from feedback.config.ts", async ({ page }) => {
  const dialog = await openWidget(page);
  const radios = dialog.locator("fieldset", { hasText: "Category" }).getByRole("radio");
  await expect(radios).toHaveCount(4);
  for (const name of ["Bug", "Performance", "Accessibility", "Feature request"]) {
    await expect(dialog.getByRole("radio", { name, exact: true })).toHaveCount(1);
  }
  await expect(dialog.getByRole("radio", { name: "Bug", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "Design", exact: true })).toHaveCount(0);
});

async function fillForm(dialog: Locator, values: { title: string; description: string; category: string; priority: string }) {
  await dialog.getByRole("textbox", { name: /^Title/ }).fill(values.title);
  await dialog.getByRole("textbox", { name: /^Description/ }).fill(values.description);
  await dialog.locator("fieldset", { hasText: "Category" }).locator("label").filter({ hasText: new RegExp(`^${values.category}$`) }).click();
  await dialog.locator("fieldset", { hasText: "Priority" }).locator("label").filter({ hasText: new RegExp(`^${values.priority}$`) }).click();
  await expect(dialog.getByRole("radio", { name: values.category, exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: values.priority, exact: true })).toBeChecked();
}

test.beforeEach(async ({ request, page }) => {
  await request.post(`${MOCK}/__mock/reset`);
  await useDistinctClientIp(page);
});

test("captures, annotates and files feedback in Notion", async ({ page, request, baseURL }) => {
  const dialog = await openWidget(page);
  await annotate(page, dialog);
  await fillForm(dialog, {
    title: "Pricing cards overlap on tablet",
    description: "The Team plan card overlaps the Scale card.\n\nSeen at 1280px wide.",
    category: "Performance",
    priority: "High",
  });
  await dialog.getByRole("textbox", { name: /^Name/ }).fill("Ada Lovelace");
  await dialog.getByRole("textbox", { name: /^Email/ }).fill("ada@example.com");

  await waitForHumanFillTime(page);
  const responsePromise = page.waitForResponse((r) => r.url().endsWith("/api/feedback") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Send feedback" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const result = await response.json();
  expect(result).toMatchObject({ ok: true, duplicate: false });

  await expect(dialog.getByText("Sent to Notion", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Open in Notion/ })).toHaveAttribute("href", result.pageUrl);

  const pages = await mockPages(request);
  expect(pages).toHaveLength(1);
  const created = pages[0]!;
  expect(created.id).toBe(result.pageId);
  expect(created.plain).toMatchObject({
    Title: "Pricing cards overlap on tablet",
    Category: "Performance",
    Priority: "High",
    Status: "New",
    "Reporter Name": "Ada Lovelace",
    "Reporter Email": "ada@example.com",
    "Page Title": "Northwind Analytics",
    "Submission ID": result.submissionId,
  });
  expect(created.plain.Description).toContain("The Team plan card overlaps the Scale card.");
  const categoryOptions = (await mockSchema(request)).Category.select.options as Array<{ name: string; color?: string }>;
  expect(categoryOptions).toContainEqual(expect.objectContaining({ name: "Performance", color: "orange" }));
  expect(String(created.plain["Website URL"]).startsWith(baseURL!)).toBe(true);
  expect(created.plain.Browser).toMatch(/Chrom/);
  expect(created.plain.Viewport).toMatch(/^1280×800 @\d/);
  expect(created.plain.Created).toEqual(expect.any(String));

  const uploads = await mockUploads(request);
  expect(uploads).toHaveLength(2);
  for (const upload of uploads) {
    expect(upload.status).toBe("attached");
    expect(upload.content_length).toBeGreaterThan(1000);
    expect(["image/png", "image/jpeg", "image/webp"]).toContain(upload.content_type);
    if (upload.content_type === "image/png") expect(upload.magic.startsWith("89504e47")).toBe(true);
    expect(upload.filename).toContain(result.submissionId.slice(0, 8));
  }
  const screenshotIds = created.plain.Screenshot as string[];
  const annotatedIds = created.plain["Annotated Screenshot"] as string[];
  expect(screenshotIds).toHaveLength(1);
  expect(annotatedIds).toHaveLength(1);
  expect(new Set([...screenshotIds, ...annotatedIds])).toEqual(new Set(uploads.map((u) => u.id)));

  const texts = created.children.map(blockText);
  const images = created.children.filter((b) => b.type === "image").map((b) => b.image.file_upload.id);
  expect(images.sort()).toEqual(uploads.map((u) => u.id).sort());
  expect(texts).toContain("Annotations");
  expect(texts.some((t) => t.startsWith("#1"))).toBe(true);
  expect(texts.some((t) => /1 rectangle/.test(t))).toBe(true);
  expect(texts.some((t) => t.includes(`Submission ID: ${result.submissionId}`))).toBe(true);
  expect(texts).toContain("Capture notes");
  expect(texts.join("\n")).toMatch(/iframe/i);
});

test("shows retry UI on server failure, keeps input, and does not duplicate on retry", async ({ page, request }) => {
  await request.post(`${MOCK}/__mock/fail`, { data: { status: 500 } });

  const submissionIds = new Set<string>();
  page.on("request", (req) => {
    if (!req.url().endsWith("/api/feedback") || req.method() !== "POST") return;
    const id = req.postData()?.match(/"submissionId"\s*:\s*"([^"]+)"/)?.[1];
    if (id) submissionIds.add(id);
  });

  const dialog = await openWidget(page);
  await annotate(page, dialog);
  const values = {
    title: "Contact form button is misaligned",
    description: "The Request demo button sits lower than the inputs.",
    category: "Bug",
    priority: "Medium",
  };
  await fillForm(dialog, values);
  await waitForHumanFillTime(page);
  await dialog.getByRole("button", { name: "Send feedback" }).click();

  const alert = dialog.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 90_000 });
  const retry = dialog.getByRole("button", { name: "Retry" });
  await expect(retry).toBeVisible();
  await expect(dialog.getByText("Sent to Notion", { exact: true })).toHaveCount(0);

  await expect(dialog.getByRole("textbox", { name: /^Title/ })).toHaveValue(values.title);
  await expect(dialog.getByRole("textbox", { name: /^Description/ })).toHaveValue(values.description);
  await expect(dialog.getByRole("radio", { name: values.category, exact: true })).toBeChecked();
  await expect(dialog.getByTestId("pinpoint-editor").locator("canvas").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Undo" })).toBeEnabled();

  expect(await mockPages(request)).toHaveLength(0);

  await request.delete(`${MOCK}/__mock/fail`);
  await retry.click();
  await expect(dialog.getByText("Sent to Notion", { exact: true })).toBeVisible({ timeout: 60_000 });

  const pages = await mockPages(request);
  expect(pages).toHaveLength(1);
  expect(pages[0]!.plain.Title).toBe(values.title);
  expect(submissionIds.size).toBe(1);
  expect(pages[0]!.plain["Submission ID"]).toBe([...submissionIds][0]);
});

test("rejects an invalid payload without touching Notion", async ({ request }) => {
  const res = await request.post("/api/feedback", { multipart: { payload: "{}" } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.code).toBe("validation");
  expect(await mockPages(request)).toHaveLength(0);
});

test("rejects a category that is not configured on the server", async ({ request, baseURL }) => {
  const submission = (category: string) => ({
    submissionId: crypto.randomUUID(),
    title: "Category check",
    description: "",
    category,
    priority: "medium",
    metadata: {
      url: `${baseURL}/`,
      pageTitle: "Northwind Analytics",
      userAgent: "playwright",
      browser: { name: "Playwright" },
      os: { name: "Test" },
      viewport: { width: 1280, height: 800 },
      screen: { width: 1280, height: 800 },
      devicePixelRatio: 1,
    },
    annotations: [],
    createdAt: new Date().toISOString(),
    website: "",
  });
  const headers = { "x-forwarded-for": `10.1.0.${++ipCounter}` };

  const rejected = await request.post("/api/feedback", {
    headers,
    multipart: { payload: JSON.stringify(submission("design")) },
  });
  expect(rejected.status()).toBe(400);
  const body = await rejected.json();
  expect(body.error.code).toBe("validation");
  expect(body.error.details.issues).toEqual([expect.objectContaining({ path: "category" })]);
  expect(await mockPages(request)).toHaveLength(0);

  const accepted = await request.post("/api/feedback", {
    headers,
    multipart: { payload: JSON.stringify(submission("a11y")) },
  });
  expect(accepted.status()).toBe(201);
  const pages = await mockPages(request);
  expect(pages).toHaveLength(1);
  expect(pages[0]!.plain.Category).toBe("Accessibility");
});
