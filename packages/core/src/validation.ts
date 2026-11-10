import { CATEGORY_ID_PATTERN, DEFAULT_CATEGORIES } from "./categories";
import { isUuid } from "./ids";
import { LIMITS } from "./limits";
import {
  FEEDBACK_PRIORITIES,
  type Annotation,
  type BrowserMetadata,
  type CaptureSummary,
  type CaptureWarning,
  type FeedbackSubmission,
  type NameVersion,
  type Point,
  type Reporter,
} from "./types";

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;
const CAPTURE_WARNING_CODES = new Set([
  "cross-origin-iframe",
  "cross-origin-image",
  "tainted-canvas",
  "blank-canvas",
  "video",
  "font",
  "downscaled",
  "unknown",
]);

type Obj = Record<string, unknown>;

class Ctx {
  issues: ValidationIssue[] = [];
  fail(path: string, message: string): undefined {
    this.issues.push({ path, message });
    return undefined;
  }
}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Strips control characters (except newline/tab) and trims. */
export function sanitizeText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

function str(c: Ctx, v: unknown, path: string, max: number, opts: { required?: boolean } = {}): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (opts.required) return c.fail(path, "is required");
    return undefined;
  }
  if (typeof v !== "string") return c.fail(path, "must be a string");
  const s = sanitizeText(v);
  if (opts.required && s.length === 0) return c.fail(path, "is required");
  if (s.length > max) return c.fail(path, `must be at most ${max} characters`);
  return s;
}

function num(c: Ctx, v: unknown, path: string, min = -1e7, max = 1e7): number | undefined {
  if (!isNum(v)) return c.fail(path, "must be a finite number");
  if (v < min || v > max) return c.fail(path, `must be between ${min} and ${max}`);
  return v;
}

function point(c: Ctx, v: unknown, path: string): Point | undefined {
  if (!isObj(v)) return c.fail(path, "must be a point");
  const x = num(c, v.x, `${path}.x`);
  const y = num(c, v.y, `${path}.y`);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function size(c: Ctx, v: unknown, path: string) {
  if (!isObj(v)) return c.fail(path, "must be an object");
  const width = num(c, v.width, `${path}.width`, 0, 1e6);
  const height = num(c, v.height, `${path}.height`, 0, 1e6);
  return width === undefined || height === undefined ? undefined : { width, height };
}

function nameVersion(c: Ctx, v: unknown, path: string): NameVersion {
  if (!isObj(v)) return { name: "Unknown" };
  return {
    name: str(c, v.name, `${path}.name`, 100) ?? "Unknown",
    version: str(c, v.version, `${path}.version`, 50),
  };
}

function httpUrl(c: Ctx, v: unknown, path: string, required: boolean): string | undefined {
  const s = str(c, v, path, LIMITS.urlMax, { required });
  if (s === undefined) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return c.fail(path, "must be an http(s) URL");
    return u.toString();
  } catch {
    return c.fail(path, "must be a valid URL");
  }
}

function metadata(c: Ctx, v: unknown): BrowserMetadata | undefined {
  if (!isObj(v)) return c.fail("metadata", "is required");
  const url = httpUrl(c, v.url, "metadata.url", true);
  const viewport = size(c, v.viewport, "metadata.viewport");
  const screen = size(c, v.screen, "metadata.screen") ?? { width: 0, height: 0 };
  if (url === undefined || viewport === undefined) return undefined;
  return {
    url,
    pageTitle: str(c, v.pageTitle, "metadata.pageTitle", 500) ?? "",
    referrer: httpUrl(c, v.referrer, "metadata.referrer", false),
    userAgent: str(c, v.userAgent, "metadata.userAgent", 1000) ?? "",
    browser: nameVersion(c, v.browser, "metadata.browser"),
    os: nameVersion(c, v.os, "metadata.os"),
    viewport,
    screen,
    devicePixelRatio: isNum(v.devicePixelRatio) && v.devicePixelRatio > 0 && v.devicePixelRatio < 20 ? v.devicePixelRatio : 1,
    language: str(c, v.language, "metadata.language", 50),
    timezone: str(c, v.timezone, "metadata.timezone", 100),
  };
}

function reporter(c: Ctx, v: unknown): Reporter | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) return c.fail("reporter", "must be an object");
  const name = str(c, v.name, "reporter.name", LIMITS.nameMax);
  const email = str(c, v.email, "reporter.email", LIMITS.emailMax);
  if (email !== undefined && !EMAIL_RE.test(email)) return c.fail("reporter.email", "must be a valid email address");
  if (name === undefined && email === undefined) return undefined;
  return { name, email };
}

function annotation(c: Ctx, v: unknown, path: string): Annotation | undefined {
  if (!isObj(v)) return c.fail(path, "must be an object");
  const id = str(c, v.id, `${path}.id`, 100, { required: true });
  const color = str(c, v.color, `${path}.color`, 64, { required: true });
  if (color !== undefined && !COLOR_RE.test(color)) return c.fail(`${path}.color`, "must be a CSS color");
  const strokeWidth = num(c, v.strokeWidth, `${path}.strokeWidth`, 0, 200);
  if (id === undefined || color === undefined || strokeWidth === undefined) return undefined;
  const base = { id, color, strokeWidth };
  switch (v.type) {
    case "pin": {
      const at = point(c, v.at, `${path}.at`);
      const number = num(c, v.number, `${path}.number`, 1, 10_000);
      const note = str(c, v.note, `${path}.note`, LIMITS.textAnnotationMax);
      return at && number !== undefined ? { ...base, type: "pin", at, number, note } : undefined;
    }
    case "freehand": {
      if (!Array.isArray(v.points)) return c.fail(`${path}.points`, "must be an array");
      if (v.points.length > LIMITS.freehandPointsMax) return c.fail(`${path}.points`, "has too many points");
      const pts = v.points.map((p, i) => point(c, p, `${path}.points[${i}]`));
      return pts.every(Boolean) ? { ...base, type: "freehand", points: pts as Point[] } : undefined;
    }
    case "arrow": {
      const from = point(c, v.from, `${path}.from`);
      const to = point(c, v.to, `${path}.to`);
      return from && to ? { ...base, type: "arrow", from, to } : undefined;
    }
    case "rectangle": {
      const x = num(c, v.x, `${path}.x`);
      const y = num(c, v.y, `${path}.y`);
      const width = num(c, v.width, `${path}.width`);
      const height = num(c, v.height, `${path}.height`);
      return x !== undefined && y !== undefined && width !== undefined && height !== undefined
        ? { ...base, type: "rectangle", x, y, width, height }
        : undefined;
    }
    case "text": {
      const at = point(c, v.at, `${path}.at`);
      const text = str(c, v.text, `${path}.text`, LIMITS.textAnnotationMax, { required: true });
      const fontSize = num(c, v.fontSize, `${path}.fontSize`, 4, 400);
      return at && text !== undefined && fontSize !== undefined ? { ...base, type: "text", at, text, fontSize } : undefined;
    }
    default:
      return c.fail(`${path}.type`, "is not a known annotation type");
  }
}

function captureSummary(c: Ctx, v: unknown): CaptureSummary | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) return c.fail("capture", "must be an object");
  if (v.method !== "dom" && v.method !== "display-media") return c.fail("capture.method", "is invalid");
  const width = num(c, v.width, "capture.width", 0, 1e6);
  const height = num(c, v.height, "capture.height", 0, 1e6);
  const warnings: CaptureWarning[] = [];
  if (Array.isArray(v.warnings)) {
    for (const [i, w] of v.warnings.slice(0, 50).entries()) {
      if (!isObj(w) || typeof w.code !== "string" || !CAPTURE_WARNING_CODES.has(w.code)) continue;
      warnings.push({
        code: w.code as CaptureWarning["code"],
        message: str(c, w.message, `capture.warnings[${i}].message`, 500) ?? "",
        count: isNum(w.count) ? w.count : undefined,
      });
    }
  }
  if (width === undefined || height === undefined) return undefined;
  return { method: v.method, width, height, warnings };
}

/**
 * Validates and normalises an untrusted submission payload.
 * Used by the server handler; also usable client-side before sending.
 */
export interface ValidateSubmissionOptions {
  /** Accepted category ids. Defaults to the built-in categories. */
  categories?: readonly string[];
}

const DEFAULT_CATEGORY_IDS: readonly string[] = DEFAULT_CATEGORIES.map((c) => c.id);

export function validateSubmission(
  input: unknown,
  options: ValidateSubmissionOptions = {},
): ValidationResult<FeedbackSubmission> {
  const c = new Ctx();
  const categoryIds = options.categories ?? DEFAULT_CATEGORY_IDS;
  if (!isObj(input)) return { ok: false, issues: [{ path: "", message: "payload must be an object" }] };

  if (!isUuid(input.submissionId)) c.fail("submissionId", "must be a UUID");
  const title = str(c, input.title, "title", LIMITS.titleMax, { required: true });
  const description = str(c, input.description, "description", LIMITS.descriptionMax) ?? "";
  const category =
    typeof input.category === "string" && CATEGORY_ID_PATTERN.test(input.category) && categoryIds.includes(input.category)
      ? input.category
      : c.fail(
          "category",
          `must be one of ${categoryIds.join(", ")}` +
            (typeof input.category === "string" && CATEGORY_ID_PATTERN.test(input.category)
              ? ` (got "${input.category}"; configure the same categories on the server handler)`
              : ""),
        );
  const priority = FEEDBACK_PRIORITIES.includes(input.priority as never)
    ? (input.priority as FeedbackSubmission["priority"])
    : c.fail("priority", `must be one of ${FEEDBACK_PRIORITIES.join(", ")}`);
  const meta = metadata(c, input.metadata);
  const rep = reporter(c, input.reporter);
  const projectId = str(c, input.projectId, "projectId", LIMITS.projectIdMax);
  const capture = captureSummary(c, input.capture);

  let annotations: Annotation[] = [];
  if (input.annotations !== undefined) {
    if (!Array.isArray(input.annotations)) c.fail("annotations", "must be an array");
    else if (input.annotations.length > LIMITS.annotationsMax) c.fail("annotations", "has too many items");
    else annotations = input.annotations.map((a, i) => annotation(c, a, `annotations[${i}]`)).filter(Boolean) as Annotation[];
  }

  let createdAt = new Date().toISOString();
  if (typeof input.createdAt === "string" && !Number.isNaN(Date.parse(input.createdAt))) {
    createdAt = new Date(input.createdAt).toISOString();
  }

  const openedAt = isNum(input.openedAt) ? input.openedAt : undefined;
  const website = typeof input.website === "string" ? input.website : undefined;

  if (c.issues.length > 0 || !title || !category || !priority || !meta) {
    return { ok: false, issues: c.issues };
  }

  return {
    ok: true,
    value: {
      submissionId: (input.submissionId as string).toLowerCase(),
      title,
      description,
      category,
      priority,
      reporter: rep,
      metadata: meta,
      annotations,
      capture,
      projectId,
      createdAt,
      openedAt,
      website,
    },
  };
}
