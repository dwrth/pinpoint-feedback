import type { MessagesOf } from "./format";

/** Annotation editor: accessible labels and screen-reader announcements (aria-live). */
export const enEditor = {
  "editor.label":
    "Screenshot annotation editor. Use the toolbar to choose a tool, then click or drag on the screenshot.",
  "textInput.label": "Annotation text. Enter to save, Shift+Enter for a new line, Escape to cancel.",

  "pin.added": "Pin {number} added",
  "pin.moved": "Pin {number} moved",
  "pin.deleted": "Pin {number} deleted",
  "pinNote.label": "Note for pin {number}. Enter to save, Shift+Enter for a new line, Escape to cancel.",
  "pinNote.placeholder": "Add a note (optional)",
  "pinNote.saved": "Note saved for pin {number}",
  "pinNote.removed": "Note removed from pin {number}",
  "drawing.added": "Drawing added",
  "drawing.moved": "Drawing moved",
  "drawing.deleted": "Drawing deleted",
  "arrow.added": "Arrow added",
  "arrow.moved": "Arrow moved",
  "arrow.deleted": "Arrow deleted",
  "rectangle.added": "Rectangle added",
  "rectangle.moved": "Rectangle moved",
  "rectangle.deleted": "Rectangle deleted",
  "text.added": "Text added",
  "text.updated": "Text updated",
  "text.moved": "Text moved",
  "text.deleted": "Text deleted",

  "history.undone": "Undone",
  "history.redone": "Redone",
  "annotations.cleared": "All annotations cleared",
  "annotations.reset": "Annotations reset",
  "zoom.changed": "Zoom {percent}",
  "zoom.fit": "Fit to view",
} as const;

export type EditorMessages = MessagesOf<typeof enEditor>;
