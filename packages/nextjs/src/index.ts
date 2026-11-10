// Client boundary: vite.config.ts prepends the "use client" directive to the built entry.
import { createElement, type ReactElement } from "react";
import {
  FeedbackProvider as BaseFeedbackProvider,
  FeedbackWidget as BaseFeedbackWidget,
  type FeedbackProviderProps,
  type FeedbackWidgetProps,
} from "@pinpoint-feedback/react";

export { useFeedback } from "@pinpoint-feedback/react";
export type {
  FeedbackController,
  FeedbackProviderProps,
  FeedbackWidgetError,
  FeedbackWidgetPosition,
  FeedbackWidgetProps,
  FeedbackWidgetTheme,
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

function withDefaults<P extends FeedbackWidgetProps>(props: P): P {
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
 * ```tsx
 * <FeedbackProvider position="bottom-right" theme="light" />
 * ```
 */
export function FeedbackProvider(props: FeedbackProviderProps): ReactElement {
  return createElement(BaseFeedbackProvider, withDefaults(props));
}

export function FeedbackWidget(props: FeedbackWidgetProps): ReactElement {
  return createElement(BaseFeedbackWidget, withDefaults(props));
}
