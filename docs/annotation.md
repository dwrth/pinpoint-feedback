# Annotation editor

`createAnnotationEditor()` from `@pinpoint-feedback/core` (`pinpoint-feedback`) is the canvas editor used inside the widget. It's framework-independent: plain DOM, Canvas 2D and Pointer Events, no drawing library. The widget's toolbar is a thin React layer on top of the same public API, so everything here also works standalone.

Source: [`packages/core/src/annotation`](../packages/core/src/annotation).

## Coordinates

Annotations are vectors stored in the **original screenshot's pixel space** (`0..width`, `0..height` of the decoded image, i.e. `CapturedScreenshot.width/height`). Zoom, pan, container size and device pixel ratio never change them. Stroke widths and font sizes are in screenshot pixels too.

The editor never modifies the input image. Two images come out of an editing session:

| Image | Where from |
| --- | --- |
| Original | The `image` you passed in (the widget sends `CapturedScreenshot.blob`) |
| Annotated | `editor.exportAnnotated()`: original + annotations burned in, at full screenshot resolution |

## Tools

`AnnotationTool` is `"select" | "pin" | "freehand" | "arrow" | "rectangle" | "text"` (`ANNOTATION_TOOLS`). The default tool is `pin`.

| Tool | Interaction |
| --- | --- |
| `select` | Click an annotation to select it, drag it to move it (3 px threshold). Click empty space to deselect; dragging there pans. Double-click a text annotation to edit it, or a pin to edit its [note](#pin-notes). Hit tolerance is 6 CSS px for mouse/pen, 12 for touch. |
| `pin` | Click inside the screenshot to drop a numbered pin, then optionally type a [note](#pin-notes). Clicking an existing pin edits its note instead of stacking a new pin. Numbers are 1-based in creation order and renumbered whenever pins are removed, so they stay sequential. |
| `arrow` | Drag from tail to head. **Shift** snaps the angle to 45° steps. Arrows shorter than 4 screen px are discarded. |
| `rectangle` | Drag a box. **Shift** constrains it to a square. Boxes narrower or shorter than 4 screen px are discarded. |
| `freehand` | Drag to draw. Coalesced pointer events are sampled; the path is simplified when the stroke ends. |
| `text` | Click to open a text box; click an existing text annotation to edit it. **Enter** commits, **Shift+Enter** adds a line, **Escape** cancels, blur commits. Clearing an existing text deletes it. |

With any tool, double-clicking a pin edits its note.

Drawn points are clamped to the screenshot bounds. With the `pin` or `text` tool, clicking while a text box is open only commits the text; it doesn't also place a pin or open a new box.

New text is sized from the image width and the current stroke width (`textSizeFor(imageWidth, strokeWidth)`). Pin radius isn't stored: renderers derive it from the image width (`pinRadiusFor(imageWidth)` = `max(14, round(width / 90))`), so pins stay legible on high-DPI captures.

`setColor()` and `setStrokeWidth()` set the style for new annotations. With an annotation selected they also restyle it (undoable); stroke width isn't applied to pins or text. While a text box is open, `setColor()` recolors the text being typed.

## Pin notes

Each pin can carry a short note (`PinAnnotation.note`, up to 1,000 characters). The Notion page lists it next to the pin number.

- **After placing a pin** a compact note box opens next to it, already focused. Type the note and press **Enter** to save it; **Shift+Enter** adds a line. **Escape** closes the box without a note (the pin stays), and so does leaving it empty. Clicking elsewhere saves what was typed; with the `pin` tool that click also places the next pin, so pins can still be dropped in quick succession. **Mod+Z** in an untouched note box removes the pin again.
- **Editing an existing note**: double-click the pin (any tool), click it with the `pin` tool, or select it with the `select` tool and press **Enter**. Clearing the text removes the note.
- **Undo**: saving, changing or removing a note is its own undo step, separate from placing the pin.
- **Indicator**: pins with a note get a small badge at their top-right, on screen and in the annotated export.
- **Disable the prompt** with `pinNotes: false`. Notes can then still be added by double-click or **Enter**.

The note box is a `<textarea>` labelled with `pinNote.label` ("Note for pin 2. Enter to save, …") and the `pinNote.placeholder` placeholder. It doesn't scale with zoom and stays next to the pin while the view moves. While it's open, `state.editingText` is `true`.

## Zoom and pan

`zoom` is screenshot pixels to CSS pixels: `1` means one screenshot pixel per CSS pixel. On load and on `fitToView()` the screenshot is fitted and centered (`state.fitZoom`).

| Input | Effect |
| --- | --- |
| Wheel / trackpad scroll | Pan. **Shift+wheel** pans horizontally. |
| **Ctrl/⌘ + wheel**, trackpad pinch | Zoom around the cursor (browsers report trackpad pinch as ctrl+wheel). |
| **Space** + drag, middle-button drag | Pan with any tool. |
| Drag on empty space with `select` | Pan. |
| Two-finger touch pinch | Zoom and pan around the midpoint between the fingers. |
| `+` / `=`, `-` / `_` | Zoom in / out by 1.25× around the center. |
| `0` | Fit to view. |

Limits: `minZoom` defaults to `min(fitZoom × 0.5, 0.1)`, `maxZoom` to `8` (`DEFAULT_MAX_ZOOM`). Pan is clamped so the image can't be dragged out of view (at most 48 px or a quarter of the container of overscroll).

The editor watches its element with a `ResizeObserver` (falling back to the window `resize` event). If the view was at fit zoom it stays fitted; otherwise it keeps the center point and scales the zoom with the container. Call `resize()` yourself only if neither fires.

## Keyboard shortcuts

Editor shortcuts apply while the editor element has focus (it's focusable and takes focus on pointer down).

| Keys | Action |
| --- | --- |
| `Mod+Z` | Undo |
| `Mod+Shift+Z`, `Mod+Y` | Redo |
| `Delete`, `Backspace` | Delete the selected annotation |
| `Enter` | Edit the note of the selected pin |
| `Escape` | Cancel the in-progress drag/draw, otherwise deselect |
| `+` / `=` | Zoom in |
| `-` / `_` | Zoom out |
| `0` | Fit to view |
| `Space` (hold) | Pan by dragging |

`Mod` is ⌘ on Apple platforms and Ctrl elsewhere (either key is accepted).

The widget adds tool keys on top. They work while focus is inside the editor area, no text field is focused, no text annotation is being typed, and no modifier is held:

| Key | Tool |
| --- | --- |
| `V` | Select |
| `P` | Pin |
| `A` | Arrow |
| `R` | Rectangle |
| `D` | Freehand |
| `T` | Text |

In the widget, `Escape` that the editor didn't consume (nothing to cancel or deselect, no text being typed) closes the dialog.

## Undo, redo, clear, reset

History is snapshot-based (`AnnotationHistory`, 200 steps). Every change to the annotation list is one undo step: add, move, delete, text edit, pin note edit, restyle of a selected annotation, `setAnnotations()` and `clear()`. A new change clears the redo stack. `undo()`/`redo()` commit any open text box first.

| Method | Annotations | History | View |
| --- | --- | --- | --- |
| `clear()` | Removed | Undoable | Unchanged |
| `reset()` | Removed | Cleared | Fit to view |

`reset()` brings the editor back to the original screenshot; the widget labels it "Reset screenshot".

## Standalone usage

```ts
import { createAnnotationEditor, createDefaultCapturer } from "pinpoint-feedback";
import de from "pinpoint-feedback/locales/de";

const shot = await createDefaultCapturer().capture();

const editor = createAnnotationEditor({
  container: document.querySelector<HTMLElement>("#editor")!, // give it an explicit size
  image: shot.blob,
  tool: "arrow",
  messages: de.editor,
  locale: "de",
  onChange: (annotations) => console.log(annotations.length, "annotations"),
});
await editor.ready;

document.querySelector("#undo")!.addEventListener("click", () => editor.undo());
const unsubscribe = editor.subscribe((state) => {
  document.querySelector<HTMLButtonElement>("#undo")!.disabled = !state.canUndo;
});

// Later
const annotated = await editor.exportAnnotated(); // PNG Blob
const annotations = editor.getAnnotations();
unsubscribe();
editor.destroy();
```

The editor appends one element (`.pinpoint-annotation-editor`) that fills the container at 100% width and height, so the container needs a size from your layout.

### Options

`AnnotationEditorOptions`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `container` | `HTMLElement` | – | Element the editor mounts into. |
| `image` | `Blob \| HTMLImageElement \| ImageBitmap \| HTMLCanvasElement` | – | The original screenshot. Blobs are decoded with `createImageBitmap`, falling back to `<img>`. An `<img>` is awaited until loaded. Never modified. |
| `initialAnnotations` | `Annotation[]` | `[]` | Starting annotations (cloned; pins renumbered). Not an undo step. |
| `tool` | `AnnotationTool` | `"pin"` | Initial tool. |
| `color` | `string` | `"#ef4444"` | Initial color (`DEFAULT_ANNOTATION_COLOR`). `ANNOTATION_COLORS` is the widget's palette. |
| `strokeWidth` | `number` | `6` | Initial stroke width in screenshot px (`DEFAULT_STROKE_WIDTH`). |
| `minZoom` | `number` | `min(fitZoom × 0.5, 0.1)` | Lower zoom limit. |
| `maxZoom` | `number` | `8` | Upper zoom limit. |
| `renderer` | `AnnotationRenderer` | `defaultAnnotationRenderer` | Draws annotations on screen and in exports. |
| `onChange` | `(annotations) => void` | – | Called with a copy of the list after every committed change, undo/redo, and a `reset()` that removed annotations. Not called mid-drag. |
| `onStateChange` | `(state) => void` | – | Same as `subscribe()`. |
| `messages` | `EditorMessages` | `en.editor` | Accessible labels and screen-reader announcements. Use the `editor` section of any locale bundle. |
| `locale` | `string` | `"en"` | BCP 47 tag for number formatting in announcements (zoom percent). |
| `pinNotes` | `boolean` | `true` | Open the note box after placing a pin. Notes stay editable by double-click or **Enter** when `false`. See [Pin notes](#pin-notes). |

### Methods

`AnnotationEditor`:

| Member | Description |
| --- | --- |
| `ready` | Resolves once the image is decoded and the first frame is drawn; rejects if decoding fails. |
| `getState()` / `subscribe(listener)` | Current state / listen for changes. `subscribe` returns an unsubscribe function. |
| `setTool(tool)`, `setColor(color)`, `setStrokeWidth(width)` | Change the active tool and style. |
| `getAnnotations()` / `setAnnotations(list)` | Read (deep copy) / replace the list. `setAnnotations` is undoable. |
| `deleteSelected()` | Delete the selected annotation. |
| `undo()`, `redo()`, `clear()`, `reset()` | See [above](#undo-redo-clear-reset). |
| `zoomIn()`, `zoomOut()` | Zoom by 1.25× around the center. |
| `setZoom(zoom, anchor?)` | Set zoom (clamped), keeping `anchor` (container CSS px, default center) fixed. |
| `fitToView()` | Fit and center the screenshot. |
| `exportAnnotated(type?, quality?)` | `Promise<Blob>` of the original with annotations, at full resolution. `type` is `"image/png"` (default), `"image/jpeg"` or `"image/webp"`. Commits an open text box first. Throws after `destroy()`. |
| `resize()` | Re-measure the container. |
| `destroy()` | Remove the element and listeners and release decoded image resources (never your own image). |

### State

`AnnotationEditorState`, emitted only when a field actually changes:

| Field | Description |
| --- | --- |
| `tool`, `color`, `strokeWidth` | Active tool and style. |
| `zoom`, `fitZoom` | Current zoom and the zoom at which the screenshot fits. |
| `canUndo`, `canRedo` | History availability. |
| `annotationCount` | Number of annotations. |
| `selectedId` | Id of the selected annotation, if any. |
| `editingText` | `true` while a text box or a pin note box is open. Use it to suspend your own single-key shortcuts. |

## Data model

From `packages/core/src/types.ts`. Annotations are plain JSON, sent as `FeedbackSubmission.annotations` and validated by the server.

```ts
interface AnnotationBase {
  id: string;
  color: string;
  strokeWidth: number; // screenshot px
}

interface PinAnnotation extends AnnotationBase {
  type: "pin";
  at: Point;
  number: number; // 1-based, sequential
  note?: string;
}

interface FreehandAnnotation extends AnnotationBase {
  type: "freehand";
  points: Point[];
}

interface ArrowAnnotation extends AnnotationBase {
  type: "arrow";
  from: Point;
  to: Point;
}

interface RectangleAnnotation extends AnnotationBase {
  type: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextAnnotation extends AnnotationBase {
  type: "text";
  at: Point; // top-left of the first line
  text: string;
  fontSize: number; // screenshot px
}

type Annotation = PinAnnotation | FreehandAnnotation | ArrowAnnotation | RectangleAnnotation | TextAnnotation;
```

`PinAnnotation.note` is entered in the editor's [note box](#pin-notes) and listed next to the pin on the Notion page. It can also be set through `initialAnnotations` or `setAnnotations()`.

Geometry helpers used by the editor are exported for custom UIs and renderers: `screenToImage`, `imageToScreen`, `normalizeRect`, `normalizeRectangle`, `simplifyPath`, `renumberPins`, `nextPinNumber`, `cloneAnnotation(s)`, `translateAnnotation`, `annotationBounds`, `hitTestAnnotation` (alias `hitTest`), `findAnnotationAt`, `computeFitZoom`, `fitView`, `resolveZoomLimits`, `clampZoom`, `zoomAround`, `clampPan`.

## Custom renderer

```ts
interface AnnotationRenderer {
  render(ctx: Canvas2D, annotations: readonly Annotation[], options?: AnnotationRenderOptions): void;
}

interface AnnotationRenderOptions {
  scale?: number;      // screenshot px → target canvas px
  selectedId?: string; // draw a selection outline for this id
  imageSize?: Size;    // screenshot size, for sizing pins and text
}
```

`Canvas2D` is `CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D`.

The same renderer draws the on-screen view and the export, so what the reporter sees is what ends up in Notion:

- **On screen**, the context arrives translated for pan and device pixel ratio, and `scale` is the current zoom. The renderer applies `scale` itself. The annotation being drawn is included (with `selectedId` unset during the drag); a text annotation being edited is left out because the text box shows it.
- **On export**, the context is a fresh full-resolution canvas with the original already drawn, and `scale` is `1`.

The renderer must leave the context state as it found it (`save`/`restore`). The simplest customization wraps the default:

```ts
import { createAnnotationEditor, renderAnnotations, type AnnotationRenderer } from "pinpoint-feedback";

const renderer: AnnotationRenderer = {
  render(ctx, annotations, options) {
    renderAnnotations(ctx, annotations, options);
    // extra drawing in screenshot px: apply options.scale yourself
  },
};

createAnnotationEditor({ container, image, renderer });
```

`renderAnnotations(ctx, annotations, options)` also accepts `pinRadius` to override the derived pin size. `defaultAnnotationRenderer` is the object form.

## Accessibility

- The editor element has `role="application"`, is focusable (`tabindex="0"`) and is labelled by `editor.label`, which tells users to pick a tool from the toolbar. The canvas is `aria-hidden`.
- A visually hidden `role="status"` / `aria-live="polite"` region announces changes: added, moved, updated and deleted annotations per type (pins with their number), saved and removed pin notes, undo/redo, clear, reset, zoom level (from the zoom keys and `zoomIn()`/`zoomOut()`) and fit (from the `0` key). Repeating the same message still re-announces it.
- The text box and the pin note box are real `<textarea>` elements with their own labels (`textInput.label`, `pinNote.label`) and `dir="auto"`.
- The editor element is forced to `direction: ltr`, so screenshots and coordinates never mirror in RTL layouts.
- Placing, selecting and moving annotations needs a pointer. Pin notes can be edited from the keyboard (**Enter** on a selected pin). Undo, redo, zoom, fit and, in the widget, tool switching work from the keyboard.

Announcement texts are the `editor` section of a locale bundle; see [i18n](i18n.md).
