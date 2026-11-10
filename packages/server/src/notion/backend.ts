import { Client } from "@notionhq/client";
import {
  en,
  mergeLocale,
  resolveCategories,
  type CategoryDefinition,
  type CategoryList,
  type FeedbackBackend,
  type FeedbackRecord,
  type FeedbackRecordInput,
  type FileUploader,
  type LocaleBundle,
  type LocaleOverrides,
} from "@pinpoint-feedback/core";
import { normalizeNotionId } from "../env";
import { NotionBackendError } from "../errors";
import type { AppendChildrenArgs, CreatePageArgs, NotionClientLike, QueryDataSourceArgs } from "./client";
import { buildChildren, buildProperties, type UploadRefs } from "./page";
import {
  NotionRequestQueue,
  toNotionBackendError,
  withNotionRetry,
  type NotionRetryOptions,
  type NotionThrottleOptions,
} from "./reliability";
import { DEFAULT_PROPERTY_NAMES, resolveSchema, type NotionPropertyNames, type ResolvedSchema } from "./schema";
import { NotionFileUploader } from "./uploader";

export interface NotionBackendOptions {
  apiKey: string;
  /** Database id (with or without dashes) or a Notion database URL. */
  databaseId: string;
  /** Injected client (tests or custom configuration). When set, apiKey/baseUrl/timeoutMs are ignored. */
  client?: NotionClientLike | Client;
  /** Notion API base URL, e.g. a local mock server. */
  baseUrl?: string;
  properties?: Partial<NotionPropertyNames>;
  /**
   * Categories written to the Category property (as their label) and used for the page callout icon.
   * Missing options are added to the Category select when `autoSetupSchema` is on. Default: the built-in categories.
   * When the backend is created by `createFeedbackRequestHandler`, defaults to the handler's `categories`.
   */
  categories?: CategoryList;
  /**
   * Language of the page body (headings, labels, summaries, dates). Only the `report` section is used.
   * Property names and select options are never translated. Default: English. When the backend is created
   * by `createFeedbackRequestHandler`, defaults to the handler's `locale`.
   */
  locale?: LocaleBundle;
  /** Overrides applied on top of `locale` (only `report` is used). Defaults to the handler's `messages`. */
  messages?: LocaleOverrides;
  /** Add missing properties to the data source on first use. Default true. */
  autoSetupSchema?: boolean;
  /** Initial status for new feedback. Default "New". */
  statusDefault?: string;
  /** Per-request timeout for Notion calls. Default 30000. */
  timeoutMs?: number;
  /** Characters of the description kept in the Description property; the page body always has the full text. Default 2000. */
  descriptionPropertyMaxChars?: number;
  /** Overrides the project written to the Project property. */
  projectId?: string;
  throttle?: NotionThrottleOptions;
  retry?: NotionRetryOptions;
  uploader?: FileUploader;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export const NOTION_CHILDREN_PER_REQUEST = 100;

function urlOf(value: object): string | undefined {
  return "url" in value && typeof value.url === "string" ? value.url : undefined;
}

/** Stores feedback as pages in a Notion database (via its first data source). */
export class NotionFeedbackBackend implements FeedbackBackend {
  readonly databaseId: string;
  private readonly client: NotionClientLike;
  private readonly names: NotionPropertyNames;
  readonly categories: readonly CategoryDefinition[];
  readonly locale: LocaleBundle;
  private readonly autoSetup: boolean;
  private readonly statusDefault: string;
  private readonly descriptionMax: number;
  private readonly projectId?: string;
  private readonly queue: NotionRequestQueue;
  private readonly retry: NotionRetryOptions;
  private readonly uploader: FileUploader;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;
  private schemaPromise?: Promise<ResolvedSchema>;

  constructor(options: NotionBackendOptions) {
    if (!options.client && !options.apiKey) throw new TypeError("NotionFeedbackBackend requires an apiKey.");
    this.databaseId = normalizeNotionId(options.databaseId);
    this.client = (options.client as NotionClientLike | undefined) ??
      new Client({ auth: options.apiKey, baseUrl: options.baseUrl, timeoutMs: options.timeoutMs ?? 30_000, retry: false });
    this.names = { ...DEFAULT_PROPERTY_NAMES, ...options.properties };
    this.categories = resolveCategories(options.categories);
    this.locale = mergeLocale(options.locale ?? en, options.messages);
    this.autoSetup = options.autoSetupSchema ?? true;
    this.statusDefault = options.statusDefault ?? "New";
    this.descriptionMax = options.descriptionPropertyMaxChars ?? 2000;
    this.projectId = options.projectId;
    this.queue = new NotionRequestQueue(options.throttle);
    this.retry = options.retry ?? {};
    this.uploader = options.uploader ?? new NotionFileUploader(this.client, this.queue, this.retry);
    this.logger = options.logger ?? console;
  }

  private call<T>(fn: () => Promise<T>): Promise<T> {
    return withNotionRetry(() => this.queue.run(fn), this.retry);
  }

  /** Resolves (and caches) the data source and property mapping, creating missing properties if enabled. */
  getSchema(refresh = false): Promise<ResolvedSchema> {
    if (refresh || !this.schemaPromise) {
      const promise = resolveSchema({
        client: this.client,
        databaseId: this.databaseId,
        names: this.names,
        autoSetup: this.autoSetup,
        logger: this.logger,
        categories: this.categories,
        call: (fn) => this.call(fn),
      }).catch((error: unknown) => {
        if (this.schemaPromise === promise) this.schemaPromise = undefined;
        throw toNotionBackendError(error);
      });
      this.schemaPromise = promise;
    }
    return this.schemaPromise;
  }

  async findBySubmissionId(submissionId: string): Promise<FeedbackRecord | undefined> {
    const schema = await this.getSchema();
    return this.find(schema, submissionId);
  }

  private async find(schema: ResolvedSchema, submissionId: string): Promise<FeedbackRecord | undefined> {
    const prop = schema.properties.submissionId;
    if (!prop || prop.type !== "rich_text") return undefined;
    const res = await this.call(() =>
      this.client.dataSources.query({
        data_source_id: schema.dataSourceId,
        filter: { property: prop.name, rich_text: { equals: submissionId } },
        page_size: 1,
      } as QueryDataSourceArgs),
    );
    const page = res.results.find((r) => r.object === "page");
    if (!page) return undefined;
    return { id: page.id, url: urlOf(page), duplicate: true };
  }

  async createRecord(input: FeedbackRecordInput): Promise<FeedbackRecord> {
    const s = input.submission;
    let schema = await this.getSchema();

    const existing = await this.find(schema, s.submissionId);
    if (existing) return existing;

    const [screenshot, annotatedScreenshot] = await Promise.all([
      input.screenshot ? this.upload(input.screenshot) : undefined,
      input.annotatedScreenshot ? this.upload(input.annotatedScreenshot) : undefined,
    ]);
    const uploads: UploadRefs = { screenshot, annotatedScreenshot };
    const children = buildChildren(s, uploads, this.categories, this.locale);
    const first = children.slice(0, NOTION_CHILDREN_PER_REQUEST);
    const rest = children.slice(NOTION_CHILDREN_PER_REQUEST);

    const create = (sch: ResolvedSchema) =>
      withNotionRetry<{ id: string; url?: string }>(
        async () => {
          const created = await this.queue.run(() =>
            this.client.pages.create({
              parent: { type: "data_source_id", data_source_id: sch.dataSourceId },
              properties: buildProperties(sch, s, uploads, {
                statusDefault: this.statusDefault,
                descriptionPropertyMaxChars: this.descriptionMax,
                projectId: this.projectId,
                categories: this.categories,
              }),
              children: first,
            } as CreatePageArgs),
          );
          return { id: created.id, url: urlOf(created) };
        },
        {
          ...this.retry,
          beforeRetry: async () => {
            const found = await this.find(sch, s.submissionId).catch(() => undefined);
            return found ? { id: found.id, url: found.url } : undefined;
          },
        },
      );

    let page: { id: string; url?: string };
    try {
      page = await create(schema);
    } catch (error) {
      if (!(error instanceof NotionBackendError) || error.notionCode !== "validation_error") throw error;
      this.logger.warn("[pinpoint] Notion rejected the page; refreshing the database schema and retrying once.");
      schema = await this.getSchema(true);
      page = await create(schema);
    }

    for (let i = 0; i < rest.length; i += NOTION_CHILDREN_PER_REQUEST) {
      const batch = rest.slice(i, i + NOTION_CHILDREN_PER_REQUEST);
      try {
        await this.call(() =>
          this.client.blocks.children.append({ block_id: page.id, children: batch } as AppendChildrenArgs),
        );
      } catch (error) {
        this.logger.error(
          `[pinpoint] Feedback page ${page.id} was created but ${rest.length - i} content block(s) could not be appended: ${toNotionBackendError(error).message}`,
        );
        break;
      }
    }

    return { id: page.id, url: page.url, duplicate: false };
  }

  private async upload(file: NonNullable<FeedbackRecordInput["screenshot"]>) {
    try {
      return await this.uploader.upload(file);
    } catch (error) {
      throw toNotionBackendError(error);
    }
  }
}
