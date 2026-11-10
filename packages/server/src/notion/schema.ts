import type { NotionClientLike, UpdateDataSourceArgs } from "./client";

/** Names of the Notion database properties written by the backend. */
export interface NotionPropertyNames {
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  websiteUrl: string;
  pageTitle: string;
  screenshot: string;
  annotatedScreenshot: string;
  reporterName: string;
  reporterEmail: string;
  browser: string;
  os: string;
  viewport: string;
  created: string;
  project: string;
  submissionId: string;
}

export const DEFAULT_PROPERTY_NAMES: NotionPropertyNames = {
  title: "Title",
  description: "Description",
  status: "Status",
  priority: "Priority",
  category: "Category",
  websiteUrl: "Website URL",
  pageTitle: "Page Title",
  screenshot: "Screenshot",
  annotatedScreenshot: "Annotated Screenshot",
  reporterName: "Reporter Name",
  reporterEmail: "Reporter Email",
  browser: "Browser",
  os: "Operating System",
  viewport: "Viewport",
  created: "Created",
  project: "Project",
  submissionId: "Submission ID",
};

export type PropertyField = keyof NotionPropertyNames;
export type ValueKind = "title" | "text" | "choice" | "url" | "email" | "date" | "files";

type PropertyConfig = NonNullable<UpdateDataSourceArgs["properties"]>[string];

type Color = "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";
const options = (list: Array<[string, Color]>) => list.map(([name, color]) => ({ name, color }));

export const STATUS_OPTIONS = options([
  ["New", "blue"],
  ["In progress", "yellow"],
  ["Resolved", "green"],
  ["Won't fix", "gray"],
]);
export const PRIORITY_OPTIONS = options([
  ["Low", "gray"],
  ["Medium", "blue"],
  ["High", "orange"],
  ["Critical", "red"],
]);
export const CATEGORY_OPTIONS = options([
  ["Bug", "red"],
  ["Design", "purple"],
  ["Content", "yellow"],
  ["Feature request", "green"],
  ["Other", "gray"],
]);

const ACCEPTS: Record<ValueKind, readonly string[]> = {
  title: ["title"],
  text: ["rich_text"],
  choice: ["select", "status", "multi_select", "rich_text"],
  url: ["url", "rich_text"],
  email: ["email", "rich_text"],
  date: ["date"],
  files: ["files"],
};

interface FieldSpec {
  kind: ValueKind;
  create: PropertyConfig;
  accepts?: readonly string[];
}

const FIELD_SPECS: Record<Exclude<PropertyField, "title">, FieldSpec> = {
  description: { kind: "text", create: { rich_text: {} } },
  status: { kind: "choice", create: { select: { options: STATUS_OPTIONS } }, accepts: ["select", "status"] },
  priority: { kind: "choice", create: { select: { options: PRIORITY_OPTIONS } } },
  category: { kind: "choice", create: { select: { options: CATEGORY_OPTIONS } } },
  websiteUrl: { kind: "url", create: { url: {} } },
  pageTitle: { kind: "text", create: { rich_text: {} } },
  screenshot: { kind: "files", create: { files: {} } },
  annotatedScreenshot: { kind: "files", create: { files: {} } },
  reporterName: { kind: "text", create: { rich_text: {} } },
  reporterEmail: { kind: "email", create: { email: {} } },
  browser: { kind: "text", create: { rich_text: {} } },
  os: { kind: "text", create: { rich_text: {} } },
  viewport: { kind: "text", create: { rich_text: {} } },
  created: { kind: "date", create: { date: {} } },
  project: { kind: "choice", create: { rich_text: {} }, accepts: ["rich_text", "select"] },
  submissionId: { kind: "text", create: { rich_text: {} } },
};

export interface ResolvedProperty {
  name: string;
  /** Notion property type as it exists in the data source. */
  type: string;
  kind: ValueKind;
  /** Option names for select/status properties. */
  options?: string[];
}

export interface ResolvedSchema {
  databaseId: string;
  dataSourceId: string;
  properties: Partial<Record<PropertyField, ResolvedProperty>>;
  /** Properties that were created by auto-setup. */
  created: string[];
  /** Fields skipped because the existing property type is incompatible or missing. */
  skipped: PropertyField[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

interface RawProperty {
  type: string;
  options?: string[];
}

function readProperties(value: unknown): Record<string, RawProperty> {
  const out: Record<string, RawProperty> = {};
  if (!isObj(value)) return out;
  for (const [name, prop] of Object.entries(value)) {
    if (!isObj(prop) || typeof prop.type !== "string") continue;
    const cfg = prop[prop.type];
    const opts = isObj(cfg) && Array.isArray(cfg.options)
      ? cfg.options.flatMap((o) => (isObj(o) && typeof o.name === "string" ? [o.name] : []))
      : undefined;
    out[name] = { type: prop.type, options: opts };
  }
  return out;
}

export interface SchemaLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

/** Looks up a database's first data source id. Falls back to treating the id as a data source id. */
export async function resolveDataSourceId(
  client: NotionClientLike,
  databaseId: string,
  call: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<string> {
  let database: unknown;
  try {
    database = await call(() => client.databases.retrieve({ database_id: databaseId }));
  } catch (error) {
    if (isObj(error) && (error.notionCode ?? error.code) === "object_not_found") {
      const ds = await call(() => client.dataSources.retrieve({ data_source_id: databaseId })).catch(() => undefined);
      if (ds && isObj(ds) && ds.object === "data_source") return databaseId;
    }
    throw error;
  }
  const sources = isObj(database) && Array.isArray(database.data_sources) ? database.data_sources : [];
  const first = sources[0];
  if (!isObj(first) || typeof first.id !== "string") {
    throw Object.assign(new Error("The Notion database has no data sources the integration can access."), {
      code: "object_not_found",
    });
  }
  return first.id;
}

export async function resolveSchema(args: {
  client: NotionClientLike;
  databaseId: string;
  names: NotionPropertyNames;
  autoSetup: boolean;
  logger: SchemaLogger;
  call: <T>(fn: () => Promise<T>) => Promise<T>;
}): Promise<ResolvedSchema> {
  const { client, databaseId, names, autoSetup, logger, call } = args;
  const dataSourceId = await resolveDataSourceId(client, databaseId, call);
  const ds = await call(() => client.dataSources.retrieve({ data_source_id: dataSourceId }));
  let existing = readProperties(isObj(ds) ? ds.properties : undefined);

  const missing: Record<string, PropertyConfig> = {};
  const wanted: Array<[Exclude<PropertyField, "title">, FieldSpec]> = Object.entries(FIELD_SPECS) as Array<
    [Exclude<PropertyField, "title">, FieldSpec]
  >;
  for (const [field, spec] of wanted) {
    const name = names[field];
    if (!existing[name] && !(name in missing)) missing[name] = spec.create;
  }

  const created: string[] = [];
  const missingNames = Object.keys(missing);
  if (autoSetup && missingNames.length > 0) {
    const updated = await call(() =>
      client.dataSources.update({ data_source_id: dataSourceId, properties: missing } as UpdateDataSourceArgs),
    );
    const after = readProperties(isObj(updated) ? updated.properties : undefined);
    if (Object.keys(after).length > 0) existing = { ...existing, ...after };
    else {
      for (const name of missingNames) {
        const cfg = missing[name] as Obj;
        const type = Object.keys(cfg)[0] ?? "rich_text";
        existing[name] = { type };
      }
    }
    created.push(...missingNames);
    logger.info(`[pinpoint] Added missing Notion properties: ${missingNames.join(", ")}`);
  }

  const properties: Partial<Record<PropertyField, ResolvedProperty>> = {};
  const skipped: PropertyField[] = [];

  const titleEntry = existing[names.title]?.type === "title"
    ? names.title
    : Object.entries(existing).find(([, p]) => p.type === "title")?.[0];
  if (titleEntry) properties.title = { name: titleEntry, type: "title", kind: "title" };
  else skipped.push("title");

  for (const [field, spec] of wanted) {
    const name = names[field];
    const prop = existing[name];
    if (!prop) {
      skipped.push(field);
      continue;
    }
    const accepts = spec.accepts ?? ACCEPTS[spec.kind];
    if (!accepts.includes(prop.type)) {
      logger.warn(
        `[pinpoint] Notion property "${name}" has type "${prop.type}" but ${accepts.join(" or ")} was expected; it will not be filled.`,
      );
      skipped.push(field);
      continue;
    }
    properties[field] = { name, type: prop.type, kind: spec.kind, options: prop.options };
  }

  if (!properties.submissionId) {
    logger.warn(
      `[pinpoint] No usable "${names.submissionId}" rich_text property; duplicate detection in Notion is disabled.`,
    );
  }

  return { databaseId, dataSourceId, properties, created, skipped };
}
