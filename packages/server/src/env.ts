import { PinpointConfigError } from "./errors";

export interface NotionEnvConfig {
  apiKey: string;
  databaseId: string;
  baseUrl?: string;
  projectId?: string;
}

const DASHED_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX32_RE = /[0-9a-f]{32}/gi;

function lastMatch(re: RegExp, input: string): string | undefined {
  const matches = input.match(re);
  return matches?.[matches.length - 1];
}

/**
 * Accepts a Notion id with or without dashes, or a Notion URL, and returns the dashed UUID form.
 * Throws if no id can be found.
 */
export function normalizeNotionId(input: string): string {
  const raw = input.trim();
  let candidate = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      candidate = new URL(raw).pathname;
    } catch {
      candidate = raw;
    }
  }
  const hex = lastMatch(HEX32_RE, candidate) ?? lastMatch(DASHED_UUID_RE, candidate)?.replace(/-/g, "");
  if (!hex) throw new PinpointConfigError("Invalid Notion id: expected a 32-character id or a Notion URL.");
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function defaultEnv(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env ?? {};
}

/**
 * Reads NOTION_API_KEY, NOTION_FEEDBACK_DATABASE_ID and the optional NOTION_API_BASE_URL and
 * PINPOINT_PROJECT_ID. Throws a PinpointConfigError naming missing variables (never their values).
 */
export function resolveNotionConfigFromEnv(env: Record<string, string | undefined> = defaultEnv()): NotionEnvConfig {
  const apiKey = env.NOTION_API_KEY?.trim();
  const databaseIdRaw = env.NOTION_FEEDBACK_DATABASE_ID?.trim();
  const missing = [!apiKey && "NOTION_API_KEY", !databaseIdRaw && "NOTION_FEEDBACK_DATABASE_ID"].filter(Boolean);
  if (missing.length > 0 || !apiKey || !databaseIdRaw) {
    throw new PinpointConfigError(`Pinpoint Feedback is not configured: missing environment variable(s) ${missing.join(", ")}.`);
  }
  let databaseId: string;
  try {
    databaseId = normalizeNotionId(databaseIdRaw);
  } catch {
    throw new PinpointConfigError(
      "NOTION_FEEDBACK_DATABASE_ID is not a valid Notion database id or URL (expected 32 hex characters).",
    );
  }
  const baseUrl = env.NOTION_API_BASE_URL?.trim() || undefined;
  const projectId = env.PINPOINT_PROJECT_ID?.trim() || undefined;
  return { apiKey, databaseId, baseUrl, projectId };
}
