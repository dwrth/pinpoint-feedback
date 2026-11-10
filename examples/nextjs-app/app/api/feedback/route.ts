import { createFeedbackHandler } from "pinpoint-feedback/nextjs/server";
import { categories } from "../../../feedback.config";

export const runtime = "nodejs";

export const POST = createFeedbackHandler({ categories });
