import {
  DEFAULT_CATEGORIES,
  type Annotation,
  type CategoryDefinition,
  type FeedbackCategory,
  type FeedbackPriority,
  type FeedbackSubmission,
} from "@pinpoint-feedback/core";
import type { BlockRequest } from "./client";
import { NOTION_TEXT_MAX, richText, truncate, type RichTextItem } from "./rich-text";
import type { PropertyField, ResolvedProperty, ResolvedSchema } from "./schema";

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
  set("status", options.statusDefault);
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

const labelled = (label: string, text: string, link?: string): RichTextItem[] => [
  ...richText(`${label}: `, { annotations: { bold: true } }),
  ...richText(text, { link, maxItems: 99 }),
];

function descriptionBlocks(description: string): BlockRequest[] {
  if (!description.trim()) return [paragraph(richText("No description provided.", { annotations: { italic: true, color: "gray" } }))];
  const blocks: BlockRequest[] = [];
  for (const para of description.split(/\n{2,}/)) {
    const text = para.trim();
    if (!text) continue;
    const perBlock = 100 * NOTION_TEXT_MAX;
    for (let i = 0; i < text.length; i += perBlock) blocks.push(paragraph(richText(text.slice(i, i + perBlock))));
  }
  return blocks;
}

const SHAPE_LABELS: Record<Exclude<Annotation["type"], "pin" | "text">, [string, string]> = {
  arrow: ["arrow", "arrows"],
  rectangle: ["rectangle", "rectangles"],
  freehand: ["freehand drawing", "freehand drawings"],
};

function annotationBlocks(annotations: Annotation[]): BlockRequest[] {
  const blocks: BlockRequest[] = [];
  const pins = annotations.filter((a) => a.type === "pin").sort((a, b) => a.number - b.number);
  for (const pin of pins) {
    blocks.push(bullet([
      ...richText(`#${pin.number}`, { annotations: { bold: true } }),
      ...richText(pin.note ? ` — ${pin.note}` : " (no note)", pin.note ? {} : { annotations: { italic: true, color: "gray" } }),
    ]));
  }
  for (const a of annotations) {
    if (a.type === "text") blocks.push(bullet(labelled("Text", `“${a.text}”`)));
  }
  const counts = new Map<keyof typeof SHAPE_LABELS, number>();
  for (const a of annotations) {
    if (a.type === "arrow" || a.type === "rectangle" || a.type === "freehand") counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const parts = [...counts].map(([type, n]) => `${n} ${SHAPE_LABELS[type][n === 1 ? 0 : 1]}`);
    blocks.push(bullet(labelled("Shapes", parts.join(", "))));
  }
  return blocks;
}

export function buildChildren(
  s: FeedbackSubmission,
  uploads: UploadRefs,
  categories: readonly CategoryDefinition[] = DEFAULT_CATEGORIES,
): BlockRequest[] {
  const m = s.metadata;
  const category = categoryOf(s, categories);
  const blocks: BlockRequest[] = [];
  const reporter = s.reporter?.name || s.reporter?.email;
  const summary = [
    `${category.label} · ${PRIORITY_LABELS[s.priority]} priority`,
    reporter ? ` · reported by ${reporter}` : "",
  ].join("");
  blocks.push({
    object: "block",
    type: "callout",
    callout: { rich_text: richText(summary), icon: { type: "emoji", emoji: category.emoji ?? DEFAULT_CATEGORY_EMOJI }, color: "gray_background" },
  } as BlockRequest);

  blocks.push(heading("Description"), ...descriptionBlocks(s.description));

  if (uploads.annotatedScreenshot) {
    blocks.push(heading("Annotated screenshot"), image(uploads.annotatedScreenshot.id, "Screenshot with annotations"));
  }
  if (uploads.screenshot) {
    blocks.push(heading("Original screenshot"), image(uploads.screenshot.id, "Original capture without annotations"));
  }

  const annotations = annotationBlocks(s.annotations);
  if (annotations.length > 0) blocks.push(heading("Annotations"), ...annotations);

  const warnings = s.capture?.warnings ?? [];
  if (warnings.length > 0) {
    blocks.push(heading("Capture notes"));
    for (const w of warnings) {
      blocks.push(bullet(richText(w.count && w.count > 1 ? `${w.message} (×${w.count})` : w.message || w.code)));
    }
  }

  blocks.push(heading("Environment"));
  const env: Array<[string, string | undefined, string?]> = [
    ["URL", m.url, m.url],
    ["Page title", m.pageTitle || undefined],
    ["Browser", formatNameVersion(m.browser)],
    ["Operating system", formatNameVersion(m.os)],
    ["Viewport", `${m.viewport.width}×${m.viewport.height}`],
    ["Screen", m.screen.width && m.screen.height ? `${m.screen.width}×${m.screen.height}` : undefined],
    ["Device pixel ratio", String(Math.round(m.devicePixelRatio * 100) / 100)],
    ["Language", m.language],
    ["Timezone", m.timezone],
    ["Referrer", m.referrer, m.referrer],
    ["Capture method", s.capture ? `${s.capture.method === "dom" ? "DOM render" : "Screen capture"} (${s.capture.width}×${s.capture.height})` : undefined],
    ["User agent", m.userAgent || undefined],
  ];
  for (const [label, text, link] of env) {
    if (text) blocks.push(bullet(labelled(label, text, link)));
  }

  blocks.push(paragraph([
    ...richText("Submission ID: ", { annotations: { color: "gray" } }),
    ...richText(s.submissionId, { annotations: { code: true, color: "gray" } }),
  ]));
  return blocks;
}
