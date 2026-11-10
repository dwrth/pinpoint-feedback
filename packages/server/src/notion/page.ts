import {
  createTranslator,
  DEFAULT_CATEGORIES,
  en,
  formatList,
  formatNumber,
  negotiateLocale,
  type Annotation,
  type CaptureWarningCode,
  type LocaleBundle,
  type Translate,
  type CategoryDefinition,
  type FeedbackCategory,
  type FeedbackPriority,
  type FeedbackSubmission,
} from "@pinpoint-feedback/core";
import type { BlockRequest } from "./client";
import { NOTION_TEXT_MAX, richText, truncate, type RichTextItem } from "./rich-text";
import { pickStatusOption, type PropertyField, type ResolvedProperty, type ResolvedSchema } from "./schema";

/** Labels of the built-in categories. */
export const CATEGORY_LABELS = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.id, c.label])) as Record<
  FeedbackCategory,
  string
>;

export const PRIORITY_LABELS: Record<FeedbackPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const DEFAULT_CATEGORY_EMOJI = "💬";

function categoryOf(s: FeedbackSubmission, categories: readonly CategoryDefinition[]): CategoryDefinition {
  return categories.find((c) => c.id === s.category) ?? { id: s.category, label: s.category };
}

export interface UploadRefs {
  screenshot?: { id: string; filename: string };
  annotatedScreenshot?: { id: string; filename: string };
}

export interface BuildPageOptions {
  statusDefault: string;
  descriptionPropertyMaxChars: number;
  projectId?: string;
  /** Resolved category definitions. Default: the built-in categories. */
  categories?: readonly CategoryDefinition[];
}

type PropertyValue = Record<string, unknown>;

function selectName(value: string): string {
  return truncate(value.replace(/,/g, " ").trim(), 100);
}

function choiceValue(prop: ResolvedProperty, value: string): PropertyValue | undefined {
  switch (prop.type) {
    case "select":
      return { select: { name: selectName(value) } };
    case "multi_select":
      return { multi_select: [{ name: selectName(value) }] };
    case "status":
      return prop.options?.includes(value) ? { status: { name: value } } : undefined;
    case "rich_text":
      return { rich_text: richText(value) };
    default:
      return undefined;
  }
}

function value(prop: ResolvedProperty, v: string): PropertyValue | undefined {
  switch (prop.kind) {
    case "title":
      return { title: richText(v) };
    case "text":
      return { rich_text: richText(v) };
    case "choice":
      return choiceValue(prop, v);
    case "url":
      return prop.type === "url" ? { url: v } : { rich_text: richText(v) };
    case "email":
      return prop.type === "email" ? { email: v } : { rich_text: richText(v) };
    case "date":
      return { date: { start: v } };
    default:
      return undefined;
  }
}

export function formatNameVersion(nv: { name: string; version?: string }): string {
  return nv.version ? `${nv.name} ${nv.version}` : nv.name;
}

export function formatViewport(s: FeedbackSubmission): string {
  const dpr = Math.round(s.metadata.devicePixelRatio * 100) / 100;
  return `${s.metadata.viewport.width}×${s.metadata.viewport.height} @${dpr}x`;
}

export function buildProperties(
  schema: ResolvedSchema,
  s: FeedbackSubmission,
  uploads: UploadRefs,
  options: BuildPageOptions,
): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  const set = (field: PropertyField, v: string | undefined) => {
    const prop = schema.properties[field];
    if (!prop || v === undefined || v === "") return;
    const pv = value(prop, v);
    if (pv) out[prop.name] = pv;
  };
  const setFile = (field: PropertyField, ref: { id: string; filename: string } | undefined) => {
    const prop = schema.properties[field];
    if (!prop || !ref) return;
    out[prop.name] = { files: [{ type: "file_upload", file_upload: { id: ref.id }, name: ref.filename }] };
  };

  set("title", s.title);
  set("description", s.description ? truncate(s.description, options.descriptionPropertyMaxChars) : undefined);
  set("status", pickStatusOption(schema.properties.status, options.statusDefault));
  set("priority", PRIORITY_LABELS[s.priority]);
  set("category", categoryOf(s, options.categories ?? DEFAULT_CATEGORIES).label);
  set("websiteUrl", s.metadata.url);
  set("pageTitle", s.metadata.pageTitle);
  setFile("screenshot", uploads.screenshot);
  setFile("annotatedScreenshot", uploads.annotatedScreenshot);
  set("reporterName", s.reporter?.name);
  set("reporterEmail", s.reporter?.email);
  set("browser", formatNameVersion(s.metadata.browser));
  set("os", formatNameVersion(s.metadata.os));
  set("viewport", formatViewport(s));
  set("created", s.createdAt);
  set("project", options.projectId ?? s.projectId);
  set("submissionId", s.submissionId);
  return out;
}

const heading = (text: string): BlockRequest => ({
  object: "block",
  type: "heading_2",
  heading_2: { rich_text: richText(text) },
}) as BlockRequest;

const paragraph = (rt: RichTextItem[]): BlockRequest => ({
  object: "block",
  type: "paragraph",
  paragraph: { rich_text: rt },
}) as BlockRequest;

const bullet = (rt: RichTextItem[]): BlockRequest => ({
  object: "block",
  type: "bulleted_list_item",
  bulleted_list_item: { rich_text: rt },
}) as BlockRequest;

const image = (id: string, caption: string): BlockRequest => ({
  object: "block",
  type: "image",
  image: { type: "file_upload", file_upload: { id }, caption: richText(caption) },
}) as BlockRequest;

type EnReport = typeof en.report;

const PRIORITY_KEYS = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
  critical: "priorityCritical",
} as const satisfies Record<FeedbackPriority, keyof EnReport>;

const WARNING_KEYS = {
  "cross-origin-iframe": "warningCrossOriginIframe",
  "cross-origin-image": "warningCrossOriginImage",
  "tainted-canvas": "warningTaintedCanvas",
  "blank-canvas": "warningBlankCanvas",
  video: "warningVideo",
  font: "warningFont",
  downscaled: "warningDownscaled",
  unknown: "warningUnknown",
} as const satisfies Record<CaptureWarningCode, keyof EnReport>;

const SHAPE_KEYS = {
  arrow: "arrowCount",
  rectangle: "rectangleCount",
  freehand: "freehandCount",
} as const satisfies Record<Exclude<Annotation["type"], "pin" | "text">, keyof EnReport>;

interface ReportContext {
  locale: string;
  t: Translate<EnReport>;
  labelled(label: string, text: string, link?: string): RichTextItem[];
  integer(n: number): string;
  size(width: number, height: number): string;
}

function reportContext(bundle: LocaleBundle): ReportContext {
  const locale = bundle.locale;
  const t = createTranslator<EnReport>(locale, bundle.report);
  const integer = (n: number) => formatNumber(locale, n, { useGrouping: false, maximumFractionDigits: 0 });
  return {
    locale,
    t,
    integer,
    size: (width, height) => t("dimensions", { width: integer(width), height: integer(height) }),
    labelled: (label, text, link) => [
      ...richText(t("fieldLabel", { label }), { annotations: { bold: true } }),
      ...richText(text, { link, maxItems: 99 }),
    ],
  };
}

/** Category name for the page body: the per-locale label when the category defines one. */
function localizedCategoryLabel(category: CategoryDefinition, locale: string): string {
  const labels = category.labels;
  if (!labels) return category.label;
  const tags = Object.keys(labels);
  const match = negotiateLocale(tags, [locale], "");
  return (match && labels[match]) || category.label;
}

function formatSubmittedAt(iso: string, locale: string, t: Translate<EnReport>): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
  return t("dateTimeUtc", { dateTime });
}

function descriptionBlocks(description: string, { t }: ReportContext): BlockRequest[] {
  if (!description.trim()) return [paragraph(richText(t("noDescription"), { annotations: { italic: true, color: "gray" } }))];
  const blocks: BlockRequest[] = [];
  for (const para of description.split(/\n{2,}/)) {
    const text = para.trim();
    if (!text) continue;
    const perBlock = 100 * NOTION_TEXT_MAX;
    for (let i = 0; i < text.length; i += perBlock) blocks.push(paragraph(richText(text.slice(i, i + perBlock))));
  }
  return blocks;
}

function annotationBlocks(annotations: Annotation[], ctx: ReportContext): BlockRequest[] {
  const { t, locale, labelled } = ctx;
  const blocks: BlockRequest[] = [];
  const pins = annotations.filter((a) => a.type === "pin").sort((a, b) => a.number - b.number);
  for (const pin of pins) {
    blocks.push(bullet([
      ...richText(t("pinNumber", { number: ctx.integer(pin.number) }), { annotations: { bold: true } }),
      ...(pin.note
        ? richText(` — ${pin.note}`)
        : richText(` ${t("pinNoNote")}`, { annotations: { italic: true, color: "gray" } })),
    ]));
  }
  for (const a of annotations) {
    if (a.type === "text") blocks.push(bullet(labelled(t("textAnnotationLabel"), t("quotedText", { text: a.text }))));
  }
  const counts = new Map<keyof typeof SHAPE_KEYS, number>();
  for (const a of annotations) {
    if (a.type === "arrow" || a.type === "rectangle" || a.type === "freehand") counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const parts = [...counts].map(([type, count]) => t(SHAPE_KEYS[type], { count }));
    blocks.push(bullet(labelled(t("shapesLabel"), formatList(locale, parts))));
  }
  return blocks;
}

export function buildChildren(
  s: FeedbackSubmission,
  uploads: UploadRefs,
  categories: readonly CategoryDefinition[] = DEFAULT_CATEGORIES,
  locale: LocaleBundle = en,
): BlockRequest[] {
  const ctx = reportContext(locale);
  const { t, labelled } = ctx;
  const m = s.metadata;
  const category = categoryOf(s, categories);
  const blocks: BlockRequest[] = [];
  const reporter = s.reporter?.name || s.reporter?.email;
  const summaryParams = { category: localizedCategoryLabel(category, ctx.locale), priority: t(PRIORITY_KEYS[s.priority]) };
  const summary = reporter ? t("calloutWithReporter", { ...summaryParams, reporter }) : t("callout", summaryParams);
  blocks.push({
    object: "block",
    type: "callout",
    callout: { rich_text: richText(summary), icon: { type: "emoji", emoji: category.emoji ?? DEFAULT_CATEGORY_EMOJI }, color: "gray_background" },
  } as BlockRequest);

  blocks.push(heading(t("headingDescription")), ...descriptionBlocks(s.description, ctx));

  if (uploads.annotatedScreenshot) {
    blocks.push(heading(t("headingAnnotatedScreenshot")), image(uploads.annotatedScreenshot.id, t("captionAnnotatedScreenshot")));
  }
  if (uploads.screenshot) {
    blocks.push(heading(t("headingOriginalScreenshot")), image(uploads.screenshot.id, t("captionOriginalScreenshot")));
  }

  const annotations = annotationBlocks(s.annotations, ctx);
  if (annotations.length > 0) blocks.push(heading(t("headingAnnotations")), ...annotations);

  const warnings = s.capture?.warnings ?? [];
  if (warnings.length > 0) {
    blocks.push(heading(t("headingCaptureNotes")));
    for (const w of warnings) {
      const key = WARNING_KEYS[w.code] ?? WARNING_KEYS.unknown;
      blocks.push(bullet(richText(t(key, { count: w.count && w.count > 0 ? w.count : 1 }))));
    }
  }

  blocks.push(heading(t("headingEnvironment")));
  const captureMethod = s.capture
    ? t("captureMethodWithSize", {
        method: t(s.capture.method === "dom" ? "captureMethodDom" : "captureMethodDisplayMedia"),
        size: ctx.size(s.capture.width, s.capture.height),
      })
    : undefined;
  const env: Array<[string, string | undefined, string?]> = [
    [t("envUrl"), m.url, m.url],
    [t("envPageTitle"), m.pageTitle || undefined],
    [t("envBrowser"), formatNameVersion(m.browser)],
    [t("envOs"), formatNameVersion(m.os)],
    [t("envViewport"), ctx.size(m.viewport.width, m.viewport.height)],
    [t("envScreen"), m.screen.width && m.screen.height ? ctx.size(m.screen.width, m.screen.height) : undefined],
    [t("envPixelRatio"), formatNumber(ctx.locale, m.devicePixelRatio, { maximumFractionDigits: 2 })],
    [t("envLanguage"), m.language],
    [t("envTimezone"), m.timezone],
    [t("envReferrer"), m.referrer, m.referrer],
    [t("envCaptureMethod"), captureMethod],
    [t("envSubmittedAt"), formatSubmittedAt(s.createdAt, ctx.locale, t)],
    [t("envUserAgent"), m.userAgent || undefined],
  ];
  for (const [label, text, link] of env) {
    if (text) blocks.push(bullet(labelled(label, text, link)));
  }

  blocks.push(paragraph([
    ...richText(t("fieldLabel", { label: t("submissionId") }), { annotations: { color: "gray" } }),
    ...richText(s.submissionId, { annotations: { code: true, color: "gray" } }),
  ]));
  return blocks;
}
