import { APIErrorCode, APIResponseError } from "@notionhq/client";
import type { FeedbackSubmission } from "@pinpoint-feedback/core";
import { NotionFeedbackBackend, type NotionBackendOptions, type NotionClientLike } from "../src/index";

export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);

export const pngBlob = (type = "image/png") => new Blob([PNG_BYTES], { type });

let counter = 0;
export function uuid(): string {
  counter++;
  const hex = counter.toString(16).padStart(12, "0");
  return `0f8fad5b-d9cb-469f-a165-${hex}`;
}

export function makeSubmission(overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission {
  return {
    submissionId: uuid(),
    title: "Button is misaligned",
    description: "The checkout button overlaps the footer.",
    category: "bug",
    priority: "high",
    reporter: { name: "Ada", email: "ada@example.com" },
    metadata: {
      url: "https://shop.example.com/checkout",
      pageTitle: "Checkout",
      userAgent: "Mozilla/5.0",
      browser: { name: "Chrome", version: "120" },
      os: { name: "macOS", version: "14.1" },
      viewport: { width: 1440, height: 900 },
      screen: { width: 2880, height: 1800 },
      devicePixelRatio: 2,
      language: "en-US",
      timezone: "Europe/Berlin",
    },
    annotations: [
      { id: "a1", type: "pin", at: { x: 10, y: 10 }, number: 1, note: "Here", color: "#ff0000", strokeWidth: 2 },
      { id: "a2", type: "arrow", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: "#ff0000", strokeWidth: 2 },
    ],
    capture: { method: "dom", width: 2880, height: 1800, warnings: [{ code: "cross-origin-iframe", message: "Cross-origin iframe was not captured" }] },
    createdAt: new Date().toISOString(),
    openedAt: Date.now() - 10_000,
    ...overrides,
  };
}

export function makeRequest(
  payload: unknown,
  files: { screenshot?: Blob; annotatedScreenshot?: Blob } = { screenshot: pngBlob(), annotatedScreenshot: pngBlob() },
  init: { headers?: Record<string, string>; method?: string; url?: string } = {},
): Request {
  const form = new FormData();
  form.set("payload", typeof payload === "string" ? payload : JSON.stringify(payload));
  if (files.screenshot) form.set("screenshot", files.screenshot, "s.png");
  if (files.annotatedScreenshot) form.set("annotatedScreenshot", files.annotatedScreenshot, "a.png");
  return new Request(init.url ?? "https://shop.example.com/api/feedback", {
    method: init.method ?? "POST",
    body: form,
    headers: { "x-forwarded-for": "203.0.113.7", ...init.headers },
  });
}

export function notionError(status: number, code: APIErrorCode, headers: Record<string, string> = {}) {
  return new APIResponseError({
    code,
    status,
    message: `${code} happened`,
    headers: new Headers(headers),
    rawBodyText: "{}",
    additional_data: undefined,
    request_id: "req",
  });
}

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface FakePage {
  id: string;
  url: string;
  properties: Record<string, Any>;
  children: Any[];
  parent: Any;
}

export class FakeNotion {
  calls: Array<{ method: string; args: Any }> = [];
  failures: Record<string, unknown[]> = {};
  schema: Record<string, Any> = { Name: { id: "title", name: "Name", type: "title", title: {} } };
  pages: FakePage[] = [];
  createDelayMs = 0;
  private seq = 0;
  private optionSeq = 0;

  private async rec<T>(method: string, args: Any, fn: () => T | Promise<T>): Promise<T> {
    this.calls.push({ method, args });
    const queued = this.failures[method];
    if (queued && queued.length > 0) throw queued.shift();
    return fn();
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  databases = {
    retrieve: (args: Any) =>
      this.rec("databases.retrieve", args, () => ({
        object: "database",
        id: args.database_id,
        data_sources: [{ id: "ds-1", name: "Feedback" }],
      })),
  };

  dataSources = {
    retrieve: (args: Any) =>
      this.rec("dataSources.retrieve", args, () => ({ object: "data_source", id: args.data_source_id, properties: { ...this.schema } })),
    update: (args: Any) =>
      this.rec("dataSources.update", args, () => {
        for (const [name, cfg] of Object.entries<Any>(args.properties)) {
          const type = Object.keys(cfg)[0]!;
          const prev = this.schema[name]?.[type]?.options as Any[] | undefined;
          const config = Array.isArray(cfg[type]?.options)
            ? {
                ...cfg[type],
                options: cfg[type].options.map((o: Any) => {
                  const match = prev?.find((p) => (o.id && p.id === o.id) || p.name === o.name);
                  return { ...match, ...o, id: o.id ?? match?.id ?? `opt-${++this.optionSeq}`, color: o.color ?? match?.color ?? "default" };
                }),
              }
            : cfg[type];
          this.schema[name] = { id: name, name, type, [type]: config };
        }
        return { object: "data_source", id: args.data_source_id, properties: { ...this.schema } };
      }),
    query: (args: Any) =>
      this.rec("dataSources.query", args, () => {
        const { property, rich_text } = args.filter;
        const results = this.pages
          .filter((p) => p.properties[property]?.rich_text?.map((t: Any) => t.text.content).join("") === rich_text.equals)
          .map((p) => ({ object: "page", id: p.id, url: p.url }));
        return { object: "list", results, has_more: false, next_cursor: null };
      }),
  };

  pagesApi = {
    create: (args: Any) =>
      this.rec("pages.create", args, async () => {
        if (this.createDelayMs) await new Promise((r) => setTimeout(r, this.createDelayMs));
        const id = `page-${++this.seq}`;
        const page = { id, url: `https://www.notion.so/${id}`, properties: args.properties, children: [...(args.children ?? [])], parent: args.parent };
        this.pages.push(page);
        return { object: "page", id, url: page.url };
      }),
  };

  blocks = {
    children: {
      append: (args: Any) =>
        this.rec("blocks.children.append", args, () => {
          this.pages.find((p) => p.id === args.block_id)?.children.push(...args.children);
          return { object: "list", results: [] };
        }),
    },
  };

  fileUploads = {
    create: (args: Any) => this.rec("fileUploads.create", args, () => ({ object: "file_upload", id: `upload-${++this.seq}`, status: "pending" })),
    send: (args: Any) => this.rec("fileUploads.send", args, () => ({ object: "file_upload", id: args.file_upload_id, status: "uploaded" })),
  };

  asClient(): NotionClientLike {
    return { databases: this.databases, dataSources: this.dataSources, pages: this.pagesApi, blocks: this.blocks, fileUploads: this.fileUploads } as unknown as NotionClientLike;
  }
}

export const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

export function makeBackend(fake: FakeNotion, options: Partial<NotionBackendOptions> = {}) {
  return new NotionFeedbackBackend({
    apiKey: "secret_test",
    databaseId: "0123456789abcdef0123456789abcdef",
    client: fake.asClient(),
    throttle: { requestsPerSecond: Infinity, maxConcurrent: 3 },
    retry: { baseDelayMs: 1, maxDelayMs: 2 },
    logger: silentLogger,
    ...options,
  });
}
