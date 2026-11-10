import { createId } from "../src/ids";
import type { FeedbackSubmission } from "../src/types";

export function makeSubmission(overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission {
  return {
    submissionId: createId(),
    title: "Button is misaligned",
    description: "It overlaps the footer",
    category: "bug",
    priority: "medium",
    annotations: [],
    createdAt: new Date().toISOString(),
    metadata: {
      url: "https://example.com/page",
      pageTitle: "Example",
      userAgent: "test",
      browser: { name: "Chrome", version: "120" },
      os: { name: "macOS" },
      viewport: { width: 1280, height: 800 },
      screen: { width: 1440, height: 900 },
      devicePixelRatio: 2,
    },
    ...overrides,
  };
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function success(submissionId: string, duplicate = false) {
  return { ok: true, submissionId, pageId: "page-1", pageUrl: "https://notion.so/page-1", duplicate };
}
