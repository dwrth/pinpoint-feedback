export const LIMITS = {
  titleMax: 200,
  descriptionMax: 10_000,
  nameMax: 120,
  emailMax: 254,
  projectIdMax: 100,
  urlMax: 2_000,
  annotationsMax: 500,
  freehandPointsMax: 5_000,
  textAnnotationMax: 1_000,
  /** Max JSON payload size in bytes. */
  payloadMaxBytes: 512 * 1024,
  /**
   * Max size per screenshot in bytes. Notion's single-part upload limit is 20 MB on paid
   * workspaces and 5 MB on free workspaces; default to the safe value.
   */
  fileMaxBytes: 5 * 1024 * 1024,
  /** Submissions faster than this after opening the widget are treated as bots. */
  minFillTimeMs: 1_500,
} as const;

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Multipart field names used by the HTTP transport and server handler. */
export const FORM_FIELDS = {
  payload: "payload",
  screenshot: "screenshot",
  annotatedScreenshot: "annotatedScreenshot",
} as const;
