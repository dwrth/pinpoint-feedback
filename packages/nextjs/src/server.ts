import "server-only";

import {
  createFeedbackRequestHandler,
  resolveNotionConfigFromEnv,
  type FeedbackHandlerOptions,
} from "@pinpoint-feedback/server";
import type { SubmissionFailure } from "@pinpoint-feedback/core";

export type { FeedbackHandlerOptions } from "@pinpoint-feedback/server";

export type FeedbackRouteHandler = (request: Request) => Promise<Response>;

export interface NextFeedbackHandlerOptions extends Partial<FeedbackHandlerOptions> {
  /** Environment to read Notion settings from. Defaults to `process.env`, read on the first request. */
  env?: Record<string, string | undefined>;
}

type Resolved = { ok: true; options: FeedbackHandlerOptions } | { ok: false; message: string };

function readProcessEnv(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

function resolveOptions({ env, ...options }: NextFeedbackHandlerOptions): Resolved {
  if (options.backend) return { ok: true, options: options as FeedbackHandlerOptions };

  const source = env ?? readProcessEnv();
  const hasExplicitNotion = Boolean(options.notion?.apiKey && options.notion?.databaseId);
  let fromEnv: ReturnType<typeof resolveNotionConfigFromEnv> | undefined;
  try {
    fromEnv = resolveNotionConfigFromEnv(source);
  } catch (error) {
    if (!hasExplicitNotion) return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const { projectId: envProjectId, ...envNotion } = fromEnv ?? {};
  const notion = { ...envNotion, ...options.notion } as NonNullable<FeedbackHandlerOptions["notion"]>;
  return {
    ok: true,
    options: { ...options, notion, projectId: options.projectId ?? envProjectId } as FeedbackHandlerOptions,
  };
}

function misconfigured(): Response {
  const body: SubmissionFailure = {
    ok: false,
    error: {
      code: "misconfigured",
      message: "The feedback service is not configured. Please contact the site owner.",
      retryable: false,
    },
  };
  return Response.json(body, { status: 500, headers: { "cache-control": "no-store" } });
}

/**
 * Creates a Next.js route handler for feedback submissions.
 *
 * Notion credentials are read from `NOTION_API_KEY` / `NOTION_FEEDBACK_DATABASE_ID`
 * (plus optional `NOTION_API_BASE_URL` and `PINPOINT_PROJECT_ID`) when the first request
 * arrives, so `next build` works without them. Explicit options take precedence.
 *
 * ```ts
 * // app/api/feedback/route.ts
 * export const POST = createFeedbackHandler();
 * ```
 */
export function createFeedbackHandler(options: NextFeedbackHandlerOptions = {}): FeedbackRouteHandler {
  let handler: FeedbackRouteHandler | undefined;

  return async function feedbackRouteHandler(request: Request): Promise<Response> {
    if (!handler) {
      const resolved = resolveOptions(options);
      if (!resolved.ok) {
        (options.logger ?? console).error(`[pinpoint-feedback] ${resolved.message}`);
        return misconfigured();
      }
      try {
        handler = createFeedbackRequestHandler(resolved.options);
      } catch (error) {
        (options.logger ?? console).error("[pinpoint-feedback] Failed to create feedback handler", error);
        return misconfigured();
      }
    }
    return handler(request);
  };
}

/**
 * Same as {@link createFeedbackHandler}, returned as `{ POST, OPTIONS }` sharing one handler,
 * for endpoints that receive cross-origin submissions (see `allowedOrigins`).
 *
 * ```ts
 * export const { POST, OPTIONS } = createFeedbackRouteHandlers({ allowedOrigins: ["https://example.com"] });
 * ```
 */
export function createFeedbackRouteHandlers(options: NextFeedbackHandlerOptions = {}): {
  POST: FeedbackRouteHandler;
  OPTIONS: FeedbackRouteHandler;
} {
  const handler = createFeedbackHandler(options);
  return { POST: handler, OPTIONS: handler };
}
