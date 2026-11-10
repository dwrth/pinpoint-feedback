// Client boundary: vite.config.ts prepends the "use client" directive to the built entry.
import type { CategoryList } from "@pinpoint-feedback/core";
import { createElement, type ReactElement } from "react";
import {
  FeedbackProvider as BaseFeedbackProvider,
  FeedbackWidget as BaseFeedbackWidget,
  type DefaultCategoryList,
  type FeedbackProviderProps,
  type FeedbackWidgetProps,
} from "@pinpoint-feedback/react";

export { useFeedback } from "@pinpoint-feedback/react";
export type {
  CategoryColor,
  CategoryDefinition,
  CategoryId,
  CategoryInput,
  CategoryList,
  DefaultCategoryList,
  FeedbackController,
  FeedbackProviderProps,
  FeedbackWidgetError,
  FeedbackWidgetPosition,
  FeedbackWidgetProps,
  FeedbackWidgetTheme,
  LocaleBundle,
  LocaleOverrides,
  TextDirection,
} from "@pinpoint-feedback/react";

export const DEFAULT_FEEDBACK_ENDPOINT = "/api/feedback";

/**
 * `process.env.NEXT_PUBLIC_*` must be accessed literally so that Next.js can inline the
 * values into the client bundle at build time.
 */
function readPublicEnv(): { endpoint?: string; projectId?: string } {
  try {
    return {
      endpoint: process.env.NEXT_PUBLIC_PINPOINT_ENDPOINT || undefined,
      projectId: process.env.NEXT_PUBLIC_PINPOINT_PROJECT_ID || undefined,
    };
  } catch {
    return {};
  }
}

function withDefaults<P extends FeedbackWidgetProps<CategoryList>>(props: P): P {
  const env = readPublicEnv();
  return {
    ...props,
    endpoint: props.endpoint ?? env.endpoint ?? DEFAULT_FEEDBACK_ENDPOINT,
    projectId: props.projectId ?? env.projectId,
  };
}

/**
 * Feedback widget for the Next.js App Router. Can be rendered directly from a Server
 * Component layout; `children` are optional.
 *
 * Pass `categories` as a plain array (e.g. from a shared `feedback.config.ts` built with
 * `defineCategories` from `"pinpoint-feedback"`) so the same list reaches the route handler.
 *
 * Locale bundles are plain data, so they can be imported in the Server Component and passed down:
 *
 * ```tsx
 * import de from "pinpoint-feedback/locales/de";
 *
 * <FeedbackProvider position="bottom-right" theme="light" categories={categories} defaultCategory="bug" locale={de} />
 * ```
 */
export function FeedbackProvider<const C extends CategoryList = DefaultCategoryList>(
  props: FeedbackProviderProps<C>,
): ReactElement {
  return createElement(BaseFeedbackProvider<C>, withDefaults(props));
}

export function FeedbackWidget<const C extends CategoryList = DefaultCategoryList>(
  props: FeedbackWidgetProps<C>,
): ReactElement {
  return createElement(BaseFeedbackWidget<C>, withDefaults(props));
}
