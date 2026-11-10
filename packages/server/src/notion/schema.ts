import { DEFAULT_CATEGORIES, type CategoryColor, type CategoryDefinition } from "@pinpoint-feedback/core";
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

const options = (list: Array<[string, CategoryColor]>) => list.map(([name, color]) => ({ name, color }));

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

export function categoryOptions(categories: readonly CategoryDefinition[]): Array<{ name: string; color: CategoryColor }> {
  return options(categories.map((c) => [c.label, c.color ?? "default"]));
}

/** Category select options for the built-in categories. */
export const CATEGORY_OPTIONS = categoryOptions(DEFAULT_CATEGORIES);

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
  /** Option groups of a status property, with their option names in Notion's order. */
  groups?: StatusGroup[];
}

export interface StatusGroup {
  name: string;
  options: string[];
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

interface RawOption {
  id?: string;
  name: string;
}

interface RawProperty {
  type: string;
  options?: RawOption[];
  groups?: Array<{ name: string; optionIds: string[] }>;
}

function readGroups(cfg: Obj): RawProperty["groups"] {
  if (!Array.isArray(cfg.groups)) return undefined;
  return cfg.groups.flatMap((g) =>
    isObj(g) && typeof g.name === "string"
      ? [{ name: g.name, optionIds: Array.isArray(g.option_ids) ? g.option_ids.filter((id): id is string => typeof id === "string") : [] }]
      : [],
  );
}

function readProperties(value: unknown): Record<string, RawProperty> {
  const out: Record<string, RawProperty> = {};
  if (!isObj(value)) return out;
  for (const [name, prop] of Object.entries(value)) {
    if (!isObj(prop) || typeof prop.type !== "string") continue;
    const cfg = prop[prop.type];
    const opts = isObj(cfg) && Array.isArray(cfg.options)
      ? cfg.options.flatMap((o): RawOption[] =>
          isObj(o) && typeof o.name === "string" ? [{ name: o.name, ...(typeof o.id === "string" ? { id: o.id } : {}) }] : [],
        )
      : undefined;
    const groups = prop.type === "status" && isObj(cfg) ? readGroups(cfg) : undefined;
    out[name] = { type: prop.type, options: opts, ...(groups ? { groups } : {}) };
  }
  return out;
}

const SELECT_TYPES = ["select", "multi_select"];

function resolveGroups(prop: RawProperty): StatusGroup[] {
  const byId = new Map(prop.options?.flatMap((o) => (o.id ? [[o.id, o.name] as const] : [])));
  return (prop.groups ?? []).map((g) => ({
    name: g.name,
    options: g.optionIds.flatMap((id) => {
      const name = byId.get(id);
      return name === undefined ? [] : [name];
    }),
  }));
}

const isToDoGroup = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "") === "todo";

/**
 * Status value written to new pages: `preferred` when the property can hold it, otherwise (for a Notion
 * status property) the first option of its To-do group, which Notion always lists first. Undefined when
 * neither exists; options are never created.
 */
export function pickStatusOption(prop: ResolvedProperty | undefined, preferred: string): string | undefined {
  if (!prop) return undefined;
  if (prop.type !== "status") return preferred || undefined;
  if (preferred && prop.options?.includes(preferred)) return preferred;
  const toDo = prop.groups?.find((g) => isToDoGroup(g.name)) ?? prop.groups?.[0];
  return toDo?.options[0];
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
  categories?: readonly CategoryDefinition[];
}): Promise<ResolvedSchema> {
  const { client, databaseId, names, autoSetup, logger, call } = args;
  const categories = args.categories ?? DEFAULT_CATEGORIES;
  const dataSourceId = await resolveDataSourceId(client, databaseId, call);
  const ds = await call(() => client.dataSources.retrieve({ data_source_id: dataSourceId }));
  let existing = readProperties(isObj(ds) ? ds.properties : undefined);

  const specs: Record<Exclude<PropertyField, "title">, FieldSpec> = {
    ...FIELD_SPECS,
    category: { ...FIELD_SPECS.category, create: { select: { options: categoryOptions(categories) } } },
  };
  const wanted = Object.entries(specs) as Array<[Exclude<PropertyField, "title">, FieldSpec]>;

  const missing: Record<string, PropertyConfig> = {};
  for (const [field, spec] of wanted) {
    const name = names[field];
    if (!existing[name] && !(name in missing)) missing[name] = spec.create;
  }

  const categoryName = names.category;
  const categoryProp = existing[categoryName];
  const optionNames = new Set(categoryProp?.options?.map((o) => o.name));
  const absentOptions = categoryOptions(categories).filter((o) => !optionNames.has(o.name));
  let optionUpdate: { name: string; type: string; options: Array<RawOption & { color?: CategoryColor }> } | undefined;
  if (categoryProp && absentOptions.length > 0) {
    if (SELECT_TYPES.includes(categoryProp.type)) {
      if (autoSetup) {
        optionUpdate = {
          name: categoryName,
          type: categoryProp.type,
          options: [...(categoryProp.options ?? []), ...absentOptions],
        };
      }
    } else if (categoryProp.type === "status") {
      logger.warn(
        `[pinpoint] Notion property "${categoryName}" is a status property without the option(s) ${absentOptions
          .map((o) => `"${o.name}"`)
          .join(", ")}; feedback in those categories is saved without a category. Add the options in Notion or use a select property.`,
      );
    }
  }

  const created: string[] = [];
  const missingNames = Object.keys(missing);
  if (autoSetup && (missingNames.length > 0 || optionUpdate)) {
    const changes: Record<string, PropertyConfig> = { ...missing };
    if (optionUpdate) {
      const { options: opts } = optionUpdate;
      changes[optionUpdate.name] = optionUpdate.type === "multi_select" ? { multi_select: { options: opts } } : { select: { options: opts } };
    }
    const updated = await call(() =>
      client.dataSources.update({ data_source_id: dataSourceId, properties: changes } as UpdateDataSourceArgs),
    );
    const after = readProperties(isObj(updated) ? updated.properties : undefined);
    if (Object.keys(after).length > 0) existing = { ...existing, ...after };
    else {
      for (const name of missingNames) {
        const cfg = missing[name] as Obj;
        const type = Object.keys(cfg)[0] ?? "rich_text";
        const opts = isObj(cfg[type]) ? (cfg[type] as Obj).options : undefined;
        existing[name] = { type, options: Array.isArray(opts) ? (opts as RawOption[]).map(({ name: n }) => ({ name: n })) : undefined };
      }
      if (optionUpdate) existing[optionUpdate.name] = { type: optionUpdate.type, options: optionUpdate.options };
    }
    if (missingNames.length > 0) {
      created.push(...missingNames);
      logger.info(`[pinpoint] Added missing Notion properties: ${missingNames.join(", ")}`);
    }
    if (optionUpdate) {
      logger.info(
        `[pinpoint] Added missing options to Notion property "${optionUpdate.name}": ${absentOptions.map((o) => o.name).join(", ")}`,
      );
    }
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
    properties[field] = {
      name,
      type: prop.type,
      kind: spec.kind,
      options: prop.options?.map((o) => o.name),
      ...(prop.groups ? { groups: resolveGroups(prop) } : {}),
    };
  }

  if (!properties.submissionId) {
    logger.warn(
      `[pinpoint] No usable "${names.submissionId}" rich_text property; duplicate detection in Notion is disabled.`,
    );
  }

  return { databaseId, dataSourceId, properties, created, skipped };
}
