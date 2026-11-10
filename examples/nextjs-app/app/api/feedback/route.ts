import { createFeedbackHandler } from "pinpoint-feedback/nextjs/server";
import { demoBackend, isDemoMode } from "../../../demo";
import { categories } from "../../../feedback.config";

export const runtime = "nodejs";

const notion = createFeedbackHandler({ categories });
const demo = createFeedbackHandler({ categories, backend: demoBackend });

export function POST(request: Request): Promise<Response> {
  return (isDemoMode() ? demo : notion)(request);
}
