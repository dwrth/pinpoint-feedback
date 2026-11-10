# Screenshots

When the reporter opens the widget, it captures the visible viewport before the dialog appears. Two capturers ship with the package:

| Capturer | `method` | Permission prompt | Used |
| --- | --- | --- | --- |
| `DomScreenshotCapturer` | `"dom"` | none | By default. |
| `DisplayMediaScreenshotCapturer` | `"display-media"` | browser share picker | When the reporter chooses screen capture. |

## DOM capture

`DomScreenshotCapturer` rasterises the DOM with [modern-screenshot](https://github.com/qq15725/modern-screenshot):

1. The page is scanned for content that can't be rasterised (see [Limitations](#limitations)).
2. The document is cloned with computed styles inlined. Images (`<img>` and CSS `background-image`) are fetched with `mode: "cors"` and inlined; web fonts are embedded.
3. The clone is painted into a canvas the size of the **layout viewport**, at the current scroll position, and encoded as PNG.

Details:

- **Scale** is `min(devicePixelRatio, 2)`. Annotation coordinates are in screenshot pixels.
- **Scroll position** is kept: the clone is shifted by the scroll offset, so the screenshot shows exactly what was on screen, not the top of the page.
- **Sticky elements** (`position: sticky`) are measured live and drawn at their stuck position.
- **Fixed elements** appear where they were in the viewport.
- **Background** is the computed background color of `<html>`, then `<body>`, else white.
- **Excluded elements** (the widget itself and anything with `data-pinpoint-ignore`) are left out of the clone.
- **Timeouts**: 10 s per image request, 30 s for the whole capture.
- **Fonts**: if embedding web fonts makes rendering fail, the capture is retried without them and a `font` warning is added.

Nothing to install, no permission prompt, and it works on every page you serve. The trade-off is that a web page cannot read everything it displays.

## Limitations

Content that DOM rasterisation can't reproduce is **never silently dropped**. Each case is detected, replaced by a labelled hatched placeholder in the screenshot, and reported as a capture warning:

| Content | Detected as | In the screenshot | Warning code |
| --- | --- | --- | --- |
| Cross-origin or otherwise unreadable `<iframe>` (embedded video, maps, payment forms, third-party widgets) | iframe whose document can't be read | "Cross-origin iframe — content not captured" | `cross-origin-iframe` |
| Tainted `<canvas>` (drew cross-origin data) | `toDataURL()` throws `SecurityError` | "Protected canvas — content not captured" | `tainted-canvas` |
| Blank `<canvas>` (typically WebGL without `preserveDrawingBuffer`) | readable canvas with a nonzero size whose sampled pixels are all transparent | left as is (no placeholder: it may really be empty) | `blank-canvas` |
| `<video>` | any visible video | current frame or poster if it can be drawn, otherwise "Video — frame not captured" | `video` |
| `<object>` / `<embed>` | any visible one | "Embedded object — content not captured" | `unknown` |
| Image that failed to load (no CORS headers, unreachable, timed out) | fetch failed | hatched image | `cross-origin-image`, or `unknown` for same-origin |
| Web fonts that couldn't be embedded | render failed with fonts | fallback font | `font` |

Same-origin iframes are rendered normally. Only content intersecting the viewport is scanned; elements with `display: none` are skipped. The scan descends into open shadow roots.

WebGL canvases are detected heuristically. A WebGL canvas created without `preserveDrawingBuffer` usually reads back as fully transparent once the browser has composited it, so the screenshot shows nothing where the page shows a 3D view or chart. To find these, each visible, non-excluded, untainted canvas is drawn onto a small scratch 2D canvas (at most 64 × 64) and its pixels are checked. If every sampled pixel is transparent, a `blank-canvas` warning is added. The page canvas's `getContext` is never called, because that could create a context the host app doesn't expect. A canvas that really is empty triggers the same warning, and very sparse content can be lost in the downsampling, so treat the warning as a hint. Screen capture includes WebGL content.

Not detected: closed shadow roots are not inspected.

Warnings are:

- shown in a banner above the screenshot in the dialog, with a **Use screen capture instead** link when the browser supports it;
- sent with the report as codes and counts (`capture.warnings`), and written to the Notion page under **Capture notes** in the [report language](i18n.md#notion-report-language).

Warning texts and placeholder labels come from the active locale's `capture` section, so placeholders drawn into the screenshot are in the reporter's language.

## Screen capture

`DisplayMediaScreenshotCapturer` uses `navigator.mediaDevices.getDisplayMedia` to grab one real frame. It captures everything as displayed, including cross-origin iframes, canvases and video.

- Requires a secure context (HTTPS or `localhost`) and a user gesture. Not available on most mobile browsers.
- The browser shows its share picker. The request prefers the current tab (`preferCurrentTab`, `displaySurface: "browser"`), excludes system audio and disables surface switching.
- Elements with `data-pinpoint-ignore` (including the widget) are hidden with `visibility: hidden` while the frame is grabbed, then restored.
- The stream is stopped immediately after one frame.
- If the reporter shares a whole screen or another window instead of the tab, the capture still succeeds with a warning that annotation positions don't map to the page.

The widget offers screen capture:

| Where | When |
| --- | --- |
| Capture error card ("Try screen capture") | DOM capture failed and screen capture hasn't been tried yet. |
| Warning banner ("Use screen capture instead") | DOM capture produced warnings. |
| No-screenshot view ("Screen capture") | The reporter continued without a screenshot. |

All three are shown only when `getDisplayMedia` is available. Cancelling the share picker returns to the previous state without calling `onError`.

If capture fails, the reporter can also **continue without a screenshot**; the report is then sent without images. **Retake** in the toolbar captures the page again with the default (or your `capturer`), keeping what was typed in the form.

## Size limits

Each screenshot is uploaded to Notion, whose single-part upload limit is 5 MB on free workspaces and 20 MB on paid ones.

On submit, the client checks the original and the annotated screenshot against its `maxFileBytes` (default 5 MB) with `fitImageToSize`:

1. Images within the limit are sent unchanged (PNG).
2. Larger images are re-encoded as WebP, then JPEG, at decreasing quality (0.92 → 0.45) at full size.
3. If that is not enough, the image is downscaled step by step at quality 0.75 until it fits.
4. If no encoding fits (or the longer side would drop below 64 px), the submission fails with `payload_too_large`.

This happens silently: it does not add a capture warning. The server separately rejects any file over its own `maxFileBytes` (default 5 MB) with `413 payload_too_large` and `details: { maxFileBytes, field }`.

If the server's limit is lower than the client's, the client recovers. When a send fails with `payload_too_large` and `details.maxFileBytes` is smaller than the largest file it sent, the client:

1. lowers its own limit to the server's for the rest of its lifetime,
2. re-fits both images to that limit and updates the outbox entry,
3. resends once with the same `submissionId`.

If that also fails, the failure is final as usual. This applies to `submit()` and to outbox retries (`retryPending()`).

### Larger screenshots on paid workspaces

Paid Notion workspaces accept 20 MB per file. To use that, raise **both** limits: the handler's `maxFileBytes` and the widget's `maxFileBytes` prop. Raising only the server has no effect, because the widget still shrinks images to 5 MB. Raising only the widget makes each oversized upload fail once and get re-fitted to the server's limit. Keep the value in one shared constant:

```ts
// feedback.config.ts
export const maxFileBytes = 20 * 1024 * 1024;
```

```tsx
// app/layout.tsx
<FeedbackProvider categories={categories} maxFileBytes={maxFileBytes} />
```

```ts
// app/api/feedback/route.ts
export const POST = createFeedbackHandler({ categories, maxFileBytes });
```

With a custom `client`, pass `maxFileBytes` to `createFeedbackClient({ endpoint, maxFileBytes })` instead; the widget prop is ignored then. See [Server](server.md).

Capturers also accept a `maxPixels` option that caps `width × height` at capture time and adds a `downscaled` warning when it applies. The widget does not set it.

## Excluding elements

Add `data-pinpoint-ignore` to leave an element and its subtree out of every screenshot:

```html
<aside data-pinpoint-ignore>Internal notes</aside>
```

```ts
import { PINPOINT_IGNORE_ATTRIBUTE } from "pinpoint-feedback";

el.setAttribute(PINPOINT_IGNORE_ATTRIBUTE, "");
```

The widget's own host element carries the attribute. Excluded elements leave an empty area, not a placeholder.

## Custom capturer

Pass any object implementing `ScreenshotCapturer` as the `capturer` prop:

```ts
interface ScreenshotCapturer {
  readonly id: string;
  isSupported(): boolean;
  capture(options?: CaptureOptions): Promise<CapturedScreenshot>;
}
```

The widget calls `capture()` with:

| Option | Type | Description |
| --- | --- | --- |
| `exclude` | `(element: Element) => boolean` | Returns `true` for elements with `data-pinpoint-ignore`. Honour it. |
| `messages` | `CaptureMessages` | Active locale's `capture` texts, for placeholders and warnings. |
| `locale` | `string` | Active locale tag, for plurals and numbers. |

Other `CaptureOptions`: `maxScale` (default `min(devicePixelRatio, 2)`), `maxPixels`, `signal`.

Return a `CapturedScreenshot`:

| Field | Type | Description |
| --- | --- | --- |
| `blob` | `Blob` | PNG, JPEG or WebP. |
| `width`, `height` | `number` | Pixel size of `blob`. Annotations are relative to these. |
| `scale` | `number` | Screenshot pixels per CSS pixel. Stroke widths in the editor scale with it. |
| `viewport` | `{ width, height }` | CSS viewport size at capture time. |
| `scroll` | `{ x, y }` | Scroll offset at capture time. |
| `method` | `"dom" \| "display-media"` | Shown in the Notion report. |
| `warnings` | `CaptureWarning[]` | `{ code, message, count? }`. Report anything you could not capture faithfully. |
| `capturedAt` | `string` | ISO timestamp. |

Throw a `CaptureError` with code `"cancelled"` or `"aborted"` to return silently, `"unsupported"` or `"failed"` to show the capture error card (and call `onError`). The **screen capture** fallback always uses the built-in `DisplayMediaScreenshotCapturer`, regardless of `capturer`.

Both built-in capturers can be constructed directly and configured:

```ts
import { DomScreenshotCapturer } from "pinpoint-feedback";

const capturer = new DomScreenshotCapturer({
  placeholders: true,     // labelled placeholders; false leaves areas blank
  fetchTimeoutMs: 10_000, // per image
  timeoutMs: 30_000,      // whole capture
  embedFonts: true,
  backgroundColor: "#fff",
});
```

| `DomScreenshotCapturer` option | Default | Description |
| --- | --- | --- |
| `placeholders` | `true` | Draw labelled placeholders for uncapturable content; `false` leaves those areas blank (still warned). |
| `fetchTimeoutMs` | `10000` | Timeout per image request. |
| `timeoutMs` | `30000` | Timeout for the whole capture. |
| `embedFonts` | `true` | Embed web fonts; falls back to system fonts with a warning. |
| `backgroundColor` | page background, else white | Canvas background. |
| `fetch` | global `fetch` | Used to inline images. |
| `messages`, `locale` | English | Default texts when `capture()` gets none. |

| `DisplayMediaScreenshotCapturer` option | Default | Description |
| --- | --- | --- |
| `settleDelayMs` | `150` | Wait after hiding excluded elements before grabbing the frame. |
| `frameTimeoutMs` | `5000` | Timeout for obtaining a frame once the stream is live. |
| `messages`, `locale` | English | Default texts when `capture()` gets none. |

`createDefaultCapturer()` returns a `DomScreenshotCapturer` with defaults. A `capturer` instance passed from a Server Component cannot cross the client boundary; create it in a Client Component (see [Widget → Next.js](widget.md#nextjs)).
