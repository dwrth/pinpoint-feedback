import type { MessagesOf } from "./format";

/**
 * Text of the Notion page body written by the server. Database property names and select
 * option names (Status, Priority, Category) are the schema and are never translated.
 */
export const enReport = {
  callout: "{category} · {priority}",
  calloutWithReporter: "{category} · {priority} · reported by {reporter}",
  priorityLow: "Low priority",
  priorityMedium: "Medium priority",
  priorityHigh: "High priority",
  priorityCritical: "Critical priority",

  headingDescription: "Description",
  headingAnnotatedScreenshot: "Annotated screenshot",
  headingOriginalScreenshot: "Original screenshot",
  headingAnnotations: "Annotations",
  headingCaptureNotes: "Capture notes",
  headingEnvironment: "Environment",

  noDescription: "No description provided.",
  captionAnnotatedScreenshot: "Screenshot with annotations",
  captionOriginalScreenshot: "Original capture without annotations",

  fieldLabel: "{label}: ",
  pinNumber: "#{number}",
  pinNoNote: "(no note)",
  textAnnotationLabel: "Text",
  quotedText: "“{text}”",
  shapesLabel: "Shapes",
  arrowCount: { one: "# arrow", other: "# arrows" },
  rectangleCount: { one: "# rectangle", other: "# rectangles" },
  freehandCount: { one: "# freehand drawing", other: "# freehand drawings" },

  warningCrossOriginIframe: {
    one: "A cross-origin iframe could not be captured.",
    other: "# cross-origin iframes could not be captured.",
  },
  warningCrossOriginImage: {
    one: "A cross-origin image could not be loaded for the screenshot.",
    other: "# cross-origin images could not be loaded for the screenshot.",
  },
  warningTaintedCanvas: {
    one: "A canvas with cross-origin data could not be captured.",
    other: "# canvases with cross-origin data could not be captured.",
  },
  warningVideo: {
    one: "A video could not be captured or was captured as a still image.",
    other: "# videos could not be captured or were captured as still images.",
  },
  warningFont: {
    one: "Web fonts could not be embedded; text may use a fallback font.",
    other: "Web fonts could not be embedded; text may use a fallback font.",
  },
  warningDownscaled: {
    one: "The screenshot was downscaled to stay within the maximum image size.",
    other: "The screenshot was downscaled to stay within the maximum image size.",
  },
  warningUnknown: {
    one: "An element could not be captured.",
    other: "# elements could not be captured.",
  },

  envUrl: "URL",
  envPageTitle: "Page title",
  envBrowser: "Browser",
  envOs: "Operating system",
  envViewport: "Viewport",
  envScreen: "Screen",
  envPixelRatio: "Device pixel ratio",
  envLanguage: "Language",
  envTimezone: "Timezone",
  envReferrer: "Referrer",
  envCaptureMethod: "Capture method",
  envUserAgent: "User agent",
  envSubmittedAt: "Submitted at",
  dimensions: "{width}×{height}",
  captureMethodDom: "DOM render",
  captureMethodDisplayMedia: "Screen capture",
  captureMethodWithSize: "{method} ({size})",
  dateTimeUtc: "{dateTime} UTC",
  submissionId: "Submission ID",
} as const;

export type ReportMessages = MessagesOf<typeof enReport>;

/** Notes for translators on keys whose meaning is not obvious from the English text. */
export const enReportContext: Partial<Record<keyof typeof enReport, string>> = {
  callout:
    "Summary line at the top of the Notion page. {category} is the category name, {priority} one of the priority* messages.",
  calloutWithReporter: "Like callout, plus the reporter's name or email address.",
  priorityLow: "Inserted as {priority} into callout. Whole phrase, so adjectives can agree with the word for priority.",
  fieldLabel:
    "Bold prefix before a value, e.g. 'Browser: Chrome 120'. Keep the trailing space if your language puts a space after the colon.",
  pinNumber: "Numbered pin marker on the screenshot; the pin's note follows after a dash.",
  pinNoNote: "Shown after a pin number when the reporter left no note.",
  textAnnotationLabel: "Label for a text annotation the reporter typed onto the screenshot.",
  quotedText: "Wraps the text of a text annotation in your language's quotation marks.",
  shapesLabel: "Label before the list of shape counts, e.g. 'Shapes: 2 arrows and 1 rectangle'.",
  freehandCount: "A freehand stroke drawn with the pen tool.",
  warningCrossOriginIframe: "An embedded page from another website that the browser does not let the screenshot read.",
  warningTaintedCanvas: "A <canvas> element containing data from another website.",
  warningFont: "Count is usually 1; use the same text in all forms if no count fits.",
  warningDownscaled: "Count is usually 1; use the same text in all forms if no count fits.",
  warningUnknown: "Other page elements (embedded objects, images) that could not be captured.",
  envViewport: "Size of the visible browser area in CSS pixels.",
  envPixelRatio: "window.devicePixelRatio, e.g. 2 on high-DPI screens.",
  envCaptureMethod: "How the screenshot was taken: rendered from the page DOM or captured from the screen.",
  dimensions: "Width × height in pixels. Use the multiplication sign; numbers are inserted unformatted.",
  captureMethodDom: "Screenshot rendered from the page's HTML (DOM) in the browser.",
  captureMethodDisplayMedia: "Screenshot taken via the browser's screen-sharing prompt.",
  captureMethodWithSize: "{size} is a dimensions message.",
  dateTimeUtc: "{dateTime} is already formatted for your locale; always in UTC.",
  submissionId: "Unique id of the submission, shown in the page footer.",
};
