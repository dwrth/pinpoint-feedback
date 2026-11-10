import type { MessagesOf } from "./format";

/**
 * Capture texts. `placeholder.*` labels are drawn into the screenshot itself; `warning.*`
 * describe content that could not be captured faithfully.
 */
export const enCapture = {
  "placeholder.iframe": "Cross-origin iframe — content not captured",
  "placeholder.object": "Embedded object — content not captured",
  "placeholder.canvas": "Protected canvas — content not captured",
  "placeholder.video": "Video — frame not captured",

  "warning.crossOriginIframe": {
    one: "# cross-origin iframe could not be captured because the browser does not allow reading its content.",
    other: "# cross-origin iframes could not be captured because the browser does not allow reading their content.",
  },
  "warning.crossOriginImage": {
    one: "# cross-origin image could not be loaded for the screenshot (blocked by CORS or unreachable).",
    other: "# cross-origin images could not be loaded for the screenshot (blocked by CORS or unreachable).",
  },
  "warning.taintedCanvas": {
    one: "# canvas could not be captured because it contains cross-origin data.",
    other: "# canvases could not be captured because they contain cross-origin data.",
  },
  "warning.blankCanvas": {
    one: "# canvas appeared empty in the screenshot. WebGL content is often not readable after it has been drawn; try screen capture.",
    other: "# canvases appeared empty in the screenshot. WebGL content is often not readable after it has been drawn; try screen capture.",
  },
  "warning.video": {
    one: "# video may not match what was playing.",
    other: "# videos may not match what was playing.",
  },
  "warning.videoNotCaptured": {
    one: "# video could not be captured.",
    other: "# videos could not be captured.",
  },
  "warning.videoStill": {
    one: "# video was captured as a still image (current frame or poster), which may not match what was playing.",
    other: "# videos were captured as still images (current frame or poster), which may not match what was playing.",
  },
  "warning.embeddedObject": {
    one: "# embedded object (<object>/<embed>) could not be captured.",
    other: "# embedded objects (<object>/<embed>) could not be captured.",
  },
  "warning.imageFailed": {
    one: "# image could not be loaded for the screenshot.",
    other: "# images could not be loaded for the screenshot.",
  },
  "warning.unknown": {
    one: "# element could not be captured exactly.",
    other: "# elements could not be captured exactly.",
  },
  "warning.unknownGeneric": "Some content could not be captured exactly.",
  "warning.font": "Web fonts could not be embedded; text in the screenshot may use a fallback font.",
  "warning.downscaled": "The screenshot was downscaled to stay within the maximum image size.",
  "warning.sharedScreen":
    "A whole screen was shared instead of this tab; the screenshot may show other content and annotation positions do not map to the page.",
  "warning.sharedWindow":
    "A window was shared instead of this tab; the screenshot may show other content and annotation positions do not map to the page.",
  "warning.labelledPlaceholders": "Affected areas are shown as labelled placeholders.",
  "warning.hatchedPlaceholders": "Affected areas are shown as hatched placeholders.",
  "warning.leftBlank": "Affected areas are left blank.",
} as const;

export type CaptureMessages = MessagesOf<typeof enCapture>;
