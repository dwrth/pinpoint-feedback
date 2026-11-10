/** Elements carrying this attribute (and their subtrees) are never captured. */
export const PINPOINT_IGNORE_ATTRIBUTE = "data-pinpoint-ignore";

export type ExcludePredicate = (element: Element) => boolean;

export function isExcludedElement(element: Element, exclude?: ExcludePredicate): boolean {
  if (element.hasAttribute(PINPOINT_IGNORE_ATTRIBUTE)) return true;
  if (!exclude) return false;
  try {
    return Boolean(exclude(element));
  } catch {
    return false;
  }
}

/** Node filter for modern-screenshot: text and other non-element nodes always pass. */
export function createCaptureFilter(exclude?: ExcludePredicate): (node: Node) => boolean {
  return (node) => node.nodeType !== 1 || !isExcludedElement(node as Element, exclude);
}

function* childElements(element: Element): Iterable<Element> {
  yield* Array.from(element.children);
  if (element.shadowRoot) yield* Array.from(element.shadowRoot.children);
}

/** Top-most excluded elements under `root` (descends into open shadow roots). */
export function collectExcludedElements(root: Element, exclude?: ExcludePredicate): Element[] {
  const result: Element[] = [];
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const element = stack.pop() as Element;
    if (isExcludedElement(element, exclude)) {
      result.push(element);
      continue;
    }
    for (const child of childElements(element)) stack.push(child);
  }
  return result;
}

const HIDE_PROPERTIES: ReadonlyArray<readonly [string, string]> = [
  ["visibility", "hidden"],
  ["opacity", "0"],
  ["transition", "none"],
];

/**
 * Hides excluded elements in the live page (used for pixel-based capture) and returns a
 * function restoring their previous inline styles.
 */
export function hideExcludedElements(root: Element, exclude?: ExcludePredicate): () => void {
  const restores: Array<() => void> = [];
  for (const element of collectExcludedElements(root, exclude)) {
    const style = (element as Partial<ElementCSSInlineStyle>).style;
    if (!style) continue;
    const saved = HIDE_PROPERTIES.map(([name]) => ({
      name,
      value: style.getPropertyValue(name),
      priority: style.getPropertyPriority(name),
    }));
    for (const [name, value] of HIDE_PROPERTIES) style.setProperty(name, value, "important");
    restores.push(() => {
      for (const { name, value, priority } of saved) {
        if (value) style.setProperty(name, value, priority);
        else style.removeProperty(name);
      }
    });
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const restore of restores) restore();
  };
}
