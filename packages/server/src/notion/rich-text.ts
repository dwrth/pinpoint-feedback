export const NOTION_TEXT_MAX = 2000;
export const NOTION_RICH_TEXT_ITEMS_MAX = 100;

export interface TextAnnotations {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  color?: "gray" | "default";
}

export interface RichTextItem {
  type: "text";
  text: { content: string; link?: { url: string } | null };
  annotations?: TextAnnotations;
}

/** Splits text into pieces of at most `size` UTF-16 units without breaking surrogate pairs. */
export function chunkText(text: string, size = NOTION_TEXT_MAX): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) {
      const code = text.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end--;
    }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

/** Truncates to `max` UTF-16 units, appending an ellipsis when shortened. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const pieces = chunkText(text, max - 1);
  return `${pieces[0] ?? ""}…`;
}

/**
 * Builds a Notion rich_text array: text objects of ≤2000 characters, at most `maxItems` objects.
 * Text beyond the capacity is truncated.
 */
export function richText(
  text: string,
  options: { annotations?: TextAnnotations; link?: string; maxItems?: number } = {},
): RichTextItem[] {
  if (!text) return [];
  const maxItems = options.maxItems ?? NOTION_RICH_TEXT_ITEMS_MAX;
  const capacity = maxItems * NOTION_TEXT_MAX;
  const content = text.length > capacity ? truncate(text, capacity) : text;
  return chunkText(content).slice(0, maxItems).map((piece) => ({
    type: "text",
    text: { content: piece, ...(options.link ? { link: { url: options.link } } : {}) },
    ...(options.annotations ? { annotations: options.annotations } : {}),
  }));
}
