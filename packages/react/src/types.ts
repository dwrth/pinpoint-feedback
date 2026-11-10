import type {
  BrowserMetadata,
  CategoryId,
  CategoryList,
  DEFAULT_CATEGORIES,
  FeedbackClient,
  FeedbackPriority,
  Reporter,
  ScreenshotCapturer,
  SubmissionFailure,
  SubmissionSuccess,
} from "@pinpoint-feedback/core";
import type { ReactNode } from "react";

export type FeedbackWidgetPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";
export type FeedbackWidgetTheme = "light" | "dark" | "system";

export type FeedbackWidgetError =
  | { type: "capture"; error: unknown }
  | { type: "submit"; error: SubmissionFailure["error"] };

export type DefaultCategoryList = typeof DEFAULT_CATEGORIES;

export interface FeedbackWidgetProps<C extends CategoryList = DefaultCategoryList> {
  /** URL of the server handler. Default "/api/feedback". */
  endpoint?: string;
  position?: FeedbackWidgetPosition;
  theme?: FeedbackWidgetTheme;
  /** Any CSS color; used for primary buttons, focus rings and selection. */
  accentColor?: string;
  projectId?: string;
  /** Known reporter. When given, the name/email fields are hidden and this is sent instead. */
  reporter?: Reporter;
  /** Show optional name/email fields. Default true. */
  collectReporter?: boolean;
  buttonLabel?: string;
  /** Keyboard shortcut toggling the widget, e.g. "mod+shift+f" (mod = ⌘ on Apple, Ctrl elsewhere). */
  hotkey?: string | false;
  zIndex?: number;
  /**
   * Categories offered in the form, in order: built-in ids (`"bug"`), `{ id, label }` definitions,
   * or a list from `defineCategories()`. Must match the list given to the server handler.
   * Default: the built-in categories.
   */
  categories?: C;
  /** Id of the preselected category. Default: the first category. */
  defaultCategory?: NoInfer<CategoryId<C>>;
  defaultPriority?: FeedbackPriority;
  capturer?: ScreenshotCapturer;
  client?: FeedbackClient;
  metadata?: () => BrowserMetadata;
  onSubmitted?: (result: SubmissionSuccess) => void;
  onError?: (error: FeedbackWidgetError) => void;
  /** Hide the floating button. The widget can still be opened via `useFeedback().open()` or the hotkey. */
  hidden?: boolean;
}

export interface FeedbackProviderProps<C extends CategoryList = DefaultCategoryList> extends FeedbackWidgetProps<C> {
  children?: ReactNode;
}

export interface FeedbackController {
  /** Captures the page and opens the feedback dialog. */
  open(): void;
  close(): void;
  isOpen: boolean;
  /** Number of submissions saved on this device that have not been confirmed by the server. */
  pendingCount: number;
  retryPending(): Promise<void>;
}
