export type CategoryColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export interface CategoryDefinition<Id extends string = string> {
  /** Stable identifier sent over the wire. Letters, digits, "-" and "_"; max 50 chars. */
  id: Id;
  /** Human-readable label shown in the widget and written to Notion as the select option name. */
  label: string;
  /** Notion select option color, used when the option is created. */
  color?: CategoryColor;
  /** Emoji used as the icon of the summary callout on the Notion page. */
  emoji?: string;
  /**
   * Widget labels per locale tag, e.g. `{ de: "Leistung" }`. Notion always stores `label`,
   * so select options stay stable across languages.
   */
  labels?: Readonly<Record<string, string>>;
}

export const DEFAULT_CATEGORIES = [
  { id: "bug", label: "Bug", color: "red", emoji: "🐞" },
  { id: "design", label: "Design", color: "purple", emoji: "🎨" },
  { id: "content", label: "Content", color: "blue", emoji: "📝" },
  { id: "feature", label: "Feature request", color: "green", emoji: "✨" },
  { id: "other", label: "Other", color: "gray", emoji: "💬" },
] as const satisfies readonly CategoryDefinition[];

export type BuiltinCategoryId = (typeof DEFAULT_CATEGORIES)[number]["id"];

/** A category list entry: a full definition, or the id of a built-in category. */
export type CategoryInput = CategoryDefinition | BuiltinCategoryId;
export type CategoryList = readonly CategoryInput[];

/** Union of the category ids in a list, e.g. `CategoryId<typeof categories>`. */
export type CategoryId<C extends CategoryList> = C[number] extends infer E
  ? E extends string
    ? E
    : E extends { id: infer I extends string }
      ? I
      : never
  : never;

export const CATEGORY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/;
export const CATEGORY_LABEL_MAX = 100;
export const CATEGORIES_MAX = 50;

export class CategoryConfigError extends Error {
  override name = "CategoryConfigError";
}

const BUILTIN_BY_ID = new Map<string, CategoryDefinition>(DEFAULT_CATEGORIES.map((c) => [c.id, c]));

/**
 * Normalises a category list: expands built-in ids to definitions and checks ids, labels
 * and uniqueness. Throws CategoryConfigError on invalid configuration.
 */
export function resolveCategories(list: CategoryList = DEFAULT_CATEGORIES): CategoryDefinition[] {
  if (!Array.isArray(list) || list.length === 0) throw new CategoryConfigError("categories must be a non-empty array");
  if (list.length > CATEGORIES_MAX) throw new CategoryConfigError(`at most ${CATEGORIES_MAX} categories are supported`);
  const seen = new Set<string>();
  return list.map((entry, i) => {
    const def = typeof entry === "string" ? BUILTIN_BY_ID.get(entry) : entry;
    if (!def) throw new CategoryConfigError(`categories[${i}]: "${String(entry)}" is not a built-in category; pass { id, label } instead`);
    if (typeof def.id !== "string" || !CATEGORY_ID_PATTERN.test(def.id)) {
      throw new CategoryConfigError(`categories[${i}]: id must match ${CATEGORY_ID_PATTERN}`);
    }
    const label = typeof def.label === "string" ? def.label.trim() : "";
    if (!label || label.length > CATEGORY_LABEL_MAX || label.includes(",")) {
      throw new CategoryConfigError(
        `categories[${i}]: label must be 1-${CATEGORY_LABEL_MAX} characters without commas (Notion select option names cannot contain commas)`,
      );
    }
    if (seen.has(def.id)) throw new CategoryConfigError(`categories[${i}]: duplicate id "${def.id}"`);
    seen.add(def.id);
    return {
      id: def.id,
      label,
      ...(def.color ? { color: def.color } : {}),
      ...(def.emoji ? { emoji: def.emoji } : {}),
      ...(def.labels ? { labels: def.labels } : {}),
    };
  });
}

/** Display label for a locale: exact tag, then language-only tag, then `label`. */
export function localizedCategoryLabel(category: CategoryDefinition, locale: string): string {
  const labels = category.labels;
  if (!labels) return category.label;
  const lower = locale.toLowerCase();
  const lang = lower.split("-")[0]!;
  for (const [tag, text] of Object.entries(labels)) if (tag.toLowerCase() === lower && text) return text;
  for (const [tag, text] of Object.entries(labels)) if (tag.toLowerCase().split("-")[0] === lang && text) return text;
  return category.label;
}

/**
 * Declares a category list once so it can be shared by the widget and the server handler.
 * Validates eagerly and preserves literal id types.
 */
export function defineCategories<const C extends CategoryList>(categories: C): C {
  resolveCategories(categories);
  return categories;
}
