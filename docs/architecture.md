# Architecture

Pinpoint Feedback is split into small packages. Each layer depends only on the layers below it, and every moving part sits behind an interface declared in `@pinpoint-feedback/core` (`packages/core/src/interfaces.ts`). The published `pinpoint-feedback` package only re-exports these packages.

```
                         ┌──────────────────────────────┐
                         │ pinpoint-feedback (umbrella) │  thin re-export files only
                         └──────────────┬───────────────┘
        ┌───────────────────┬───────────┴──────────┬─────────────────────────┐
        ▼                   ▼                      ▼                         ▼
 @pinpoint-feedback/  @pinpoint-feedback/   @pinpoint-feedback/      @pinpoint-feedback/
 core                 react                 nextjs                   server
 (browser + shared)   ("use client")        index: "use client"      (Web Request → Response)
        ▲                   │               server: server-only             │
        │                   │                 │          │                 │
        └───────────────────┴─────────────────┘          └─────────────────┤
                                                                           ▼
                                                                  @notionhq/client → Notion
```

| Entry point | Re-exports | Runs in |
| --- | --- | --- |
| `pinpoint-feedback`, `pinpoint-feedback/core` | `@pinpoint-feedback/core` | browser (and Node for types/validation) |
| `pinpoint-feedback/react` | `@pinpoint-feedback/react` | browser, `"use client"` |
| `pinpoint-feedback/nextjs` | `@pinpoint-feedback/nextjs` | browser, `"use client"` |
| `pinpoint-feedback/server` | `@pinpoint-feedback/server` | Node ≥ 20, Edge, Bun, Deno, Workers |
| `pinpoint-feedback/nextjs/server` | `@pinpoint-feedback/nextjs/server` | Next.js server only (`import "server-only"`) |

None of the client entry points import `@pinpoint-feedback/server`, `@notionhq/client` or `server-only`. Because the Notion SDK can only be reached through the two server entry points, bundlers never put the token or the SDK into a client bundle.

Next.js rejects `export *` inside a `"use client"` module. The umbrella build (`packages/pinpoint-feedback/scripts/build.mjs`) therefore reads the export names of the built `react` and `nextjs` packages and writes explicit `export { … } from` lists into `dist/react.js` and `dist/nextjs.js`, each preceded by `"use client"`. Server and core entries use plain `export *`.

## Data flow

1. **Open.** The widget, rendered in an open Shadow DOM marked `data-pinpoint-ignore`, asks a `ScreenshotCapturer` for a `CapturedScreenshot`. That object holds a PNG blob, its size, the device scale, viewport and scroll, the capture method, and `warnings` describing anything that couldn't be captured.
2. **Annotate.** `createAnnotationEditor()` draws the screenshot and the annotations on a canvas. Annotations are plain data (`Annotation[]`) in screenshot pixel coordinates, so zooming, panning and resizing never change them. `exportAnnotated()` burns them into a full-resolution copy.
3. **Submit.** The `FeedbackClient` first writes `{ submission, files }` to the `FeedbackOutbox`. It then sends the report through a `FeedbackTransport`, which by default is a multipart `POST` with a `payload` JSON field and `screenshot`/`annotatedScreenshot` files. Retryable failures are retried with backoff. The outbox entry is removed only after the server returns `{ ok: true }`.
4. **Handle.** `createFeedbackRequestHandler()` checks the origin, rate limit, content type, body size, JSON schema, honeypot and fill time, and the image magic bytes. It then deduplicates by `submissionId` and calls `FeedbackBackend.createRecord()`.
5. **Persist.** `NotionFeedbackBackend` resolves the database's first data source (Notion API `2025-09-03`) and adds any missing properties. It looks for an existing page with the same `Submission ID`, uploads both images through a `FileUploader`, and creates the page with properties and body blocks.

## Interfaces

All interfaces are exported from `@pinpoint-feedback/core`, which is also available as `pinpoint-feedback`.

### `ScreenshotCapturer`

```ts
interface ScreenshotCapturer {
  readonly id: string;
  isSupported(): boolean;
  capture(options?: CaptureOptions): Promise<CapturedScreenshot>;
}
```

Implementations:

- `DomScreenshotCapturer` (the default) rasterises the DOM.
- `DisplayMediaScreenshotCapturer` grabs one frame through `getDisplayMedia`.

A capturer must **report** content it couldn't render as `CaptureWarning`s (`cross-origin-iframe`, `cross-origin-image`, `tainted-canvas`, `video`, `font`, `downscaled`) and must not silently drop it. It also has to honour `options.exclude` and `options.signal`. To plug in your own, such as a server-side renderer or a browser-extension bridge, pass `capturer={myCapturer}` to the widget.

### `AnnotationRenderer`

```ts
interface AnnotationRenderer {
  render(ctx: Canvas2D, annotations: readonly Annotation[], options?: { scale?: number; selectedId?: string }): void;
}
```

`defaultAnnotationRenderer` draws pins, arrows, rectangles, freehand paths and text. The editor uses it both on screen and in `exportAnnotated()`, so what reporters see is what ends up in Notion. To change the look, pass `renderer` to `createAnnotationEditor()`.

### `FeedbackTransport`

```ts
interface FeedbackTransport {
  submit(submission: FeedbackSubmission, files: SubmissionFiles, options?: { signal?: AbortSignal }): Promise<SubmissionResult>;
}
```

`HttpFeedbackTransport` posts multipart data to `endpoint` and maps HTTP and network failures to `SubmissionFailure` codes. A transport should **never throw** for expected failures. Instead it returns `{ ok: false, error: { code, retryable, retryAfter? } }`, which the client uses to decide whether to retry. You might replace it to add authentication headers or to send through a different channel, such as a Web Worker or `navigator.sendBeacon`.

### `FeedbackOutbox`

```ts
interface FeedbackOutbox {
  put(entry: OutboxEntry): Promise<void>;
  get(submissionId: string): Promise<OutboxEntry | undefined>;
  list(): Promise<OutboxEntry[]>;
  remove(submissionId: string): Promise<void>;
}
```

`createOutbox()` returns an `IndexedDbOutbox`. If IndexedDB is unavailable, for example in some private modes, it falls back to a `MemoryOutbox`. Entries store the blobs themselves, so a report survives a reload. The widget calls `client.retryPending()` on load and on the `online` event.

### `FeedbackBackend`

```ts
interface FeedbackBackend {
  createRecord(input: FeedbackRecordInput): Promise<FeedbackRecord>;
  findBySubmissionId?(submissionId: string): Promise<FeedbackRecord | undefined>;
}
```

This is the server-side persistence port, and `NotionFeedbackBackend` is the reference implementation. The handler only reports success after `createRecord` resolves with an `id`. If the backend implements `findBySubmissionId`, the handler calls it before `createRecord`, so a retried submission returns `duplicate: true`. The Notion backend does this lookup itself, both before creating a page and between its own retries. Pass `backend` to `createFeedbackRequestHandler()` or `createFeedbackHandler()` to store reports somewhere else or to fake persistence in tests.

### `FileUploader`

```ts
interface FileUploader {
  upload(file: UploadableFile): Promise<UploadedFile>;
}
```

`NotionFileUploader` uses Notion's File Upload API in single-part mode (`POST /v1/file_uploads`, then `POST /v1/file_uploads/{id}/send`). The returned `id` is attached to the page's files properties and image blocks, and Notion requires that to happen within an hour. Pass `uploader` in `NotionBackendOptions` to put images on your own storage, such as S3 or R2, and reference them as external files instead.

## Server handler

`createFeedbackRequestHandler(options)` returns a `(request: Request) => Promise<Response>` function and holds per-process state: the rate limiter, a cache of completed submission IDs, and in-flight deduplication. Create it **once** per process, at module scope, and reuse it.

`createFeedbackHandler()` in `@pinpoint-feedback/nextjs/server` wraps it for Next.js:

- **Lazy configuration.** The environment is read on the first request, not at import, so `next build` works without secrets.
- **Memoisation.** The underlying handler is created once and reused for every request.
- **Misconfiguration.** Until configuration is valid, it answers `500` with `{ ok: false, error: { code: "misconfigured" } }` and logs which variable is missing.
- **Overrides.** Option values override environment values, so `notion` can, for example, replace only `properties`.

## Writing an adapter: Remix / React Router

The server side only needs a route that passes the `Request` through. In React Router v7 framework mode (or Remix):

```ts
// app/routes/api.feedback.ts
import { createFeedbackRequestHandler, resolveNotionConfigFromEnv } from "pinpoint-feedback/server";
import type { Route } from "./+types/api.feedback";

let handler: ((request: Request) => Promise<Response>) | undefined;

function getHandler() {
  return (handler ??= createFeedbackRequestHandler({ notion: resolveNotionConfigFromEnv(process.env) }));
}

export function action({ request }: Route.ActionArgs) {
  return getHandler()(request);
}
```

Keep this module server-only. In Remix and React Router, name it `*.server.ts`, or make sure only `action`/`loader` reference it, so the compiler drops it from the client bundle.

On the client, render the widget once in the root layout:

```tsx
// app/root.tsx
import { FeedbackProvider } from "pinpoint-feedback/react";

export default function App() {
  return (
    <>
      <Outlet />
      <FeedbackProvider endpoint="/api/feedback" position="bottom-right" />
    </>
  );
}
```

The widget renders nothing on the server, because its Shadow DOM host is created in an effect, so it is safe with SSR and streaming.

To publish a dedicated adapter package, mirror `packages/nextjs`:

1. **Client entry.** Re-export the React components with framework-specific defaults, such as an endpoint derived from the router's base path.
2. **Server entry.** Wrap `createFeedbackRequestHandler` with lazy env resolution and memoisation, and guard it with the framework's server-only mechanism.
3. **Vite library build.** Externalise every dependency and add a `"use client"` banner only to the client entry, if the framework understands it.
4. **Umbrella exports.** Add the new entries to `packages/pinpoint-feedback/package.json` and the `entries` list in `scripts/build.mjs`, marking client boundaries with `client: true`.

## Testing

- **Unit tests** (Vitest) live in each package's `test/` folder. Core and React run under happy-dom, while server and Next.js run under Node.
- **End-to-end tests** (`examples/nextjs-app/e2e`, Playwright) run the real Next.js app against `mock-notion/server.mjs`, a dependency-free mock of the Notion endpoints listed above. `GET /__mock/pages` and `GET /__mock/uploads` expose what was "written to Notion". `POST /__mock/fail` injects failures, and `POST /__mock/reset` clears state between tests.
