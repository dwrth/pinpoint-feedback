import {
  DEFAULT_CATEGORIES,
  localizedCategoryLabel,
  resolveCategories,
  type BuiltinCategoryId,
  type CategoryColor,
  type CategoryDefinition,
  type CategoryList,
} from "@pinpoint-feedback/core";
import { useEffect, useMemo } from "react";
import type { WidgetTranslate } from "./i18n";

/** Up to this many categories render as segmented buttons; more use a select. */
export const SEGMENTED_CATEGORIES_MAX = 6;

/** Literal class names so Tailwind picks them up; the variables are defined per theme in styles.css. */
export const CATEGORY_DOT: Record<CategoryColor, string> = {
  default: "bg-(--pp-cat-default)",
  gray: "bg-(--pp-cat-gray)",
  brown: "bg-(--pp-cat-brown)",
  orange: "bg-(--pp-cat-orange)",
  yellow: "bg-(--pp-cat-yellow)",
  green: "bg-(--pp-cat-green)",
  blue: "bg-(--pp-cat-blue)",
  purple: "bg-(--pp-cat-purple)",
  pink: "bg-(--pp-cat-pink)",
  red: "bg-(--pp-cat-red)",
};

const FALLBACK: CategoryDefinition[] = resolveCategories(DEFAULT_CATEGORIES);

function contentKey(list: CategoryList | undefined): string {
  if (list === undefined) return "";
  try {
    return JSON.stringify(list) ?? "";
  } catch {
    return `invalid:${String(list)}`;
  }
}

function resolve(list: CategoryList | undefined): { categories: CategoryDefinition[]; error?: string } {
  if (list === undefined) return { categories: FALLBACK };
  try {
    return { categories: resolveCategories(list) };
  } catch (error) {
    return { categories: FALLBACK, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Resolves the `categories` prop, memoised on its content so inline arrays don't re-resolve
 * every render. Invalid configuration falls back to the built-in categories instead of
 * breaking the host page.
 */
export function useResolvedCategories(list: CategoryList | undefined): CategoryDefinition[] {
  const key = contentKey(list);
  const { categories, error } = useMemo(() => resolve(list), [key]);
  useEffect(() => {
    if (error) {
      console.error(
        `[pinpoint-feedback] Invalid "categories" prop: ${error}. Falling back to the default categories; submissions may be rejected by the server if its list differs.`,
      );
    }
  }, [error]);
  return categories;
}

export function pickCategory(categories: readonly CategoryDefinition[], preferred: string | undefined): string {
  if (preferred && categories.some((c) => c.id === preferred)) return preferred;
  return categories[0]!.id;
}

const BUILTIN_LABELS = new Map<string, string>(DEFAULT_CATEGORIES.map((c) => [c.id, c.label]));

/**
 * Widget label for a category: its `labels` for the locale, else the translated name of a
 * built-in category whose label was not customised, else `label`.
 */
export function categoryLabel(category: CategoryDefinition, locale: string, t: WidgetTranslate): string {
  if (category.labels) return localizedCategoryLabel(category, locale);
  if (BUILTIN_LABELS.get(category.id) === category.label) return t(`category.${category.id as BuiltinCategoryId}`);
  return category.label;
}
