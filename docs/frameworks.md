# Other frameworks

Next.js gets a dedicated adapter ([getting started](getting-started.md)). Everything else uses the framework-independent pieces underneath it:

| Need | Entry |
| --- | --- |
| Server endpoint on any runtime with Web `Request`/`Response` | `pinpoint-feedback/server` |
| Widget in a React app without Next.js | `pinpoint-feedback/react` |
| Your own UI, no framework | `pinpoint-feedback` (core) |

Only the Next.js integration is tested end-to-end in this repo. The snippets below rely on the handler's `(Request) => Promise<Response>` contract, which the server unit tests cover, but the framework glue itself is **not tested here**.

## Server: `createFeedbackRequestHandler`

```ts
import { createFeedbackRequestHandler } from "pinpoint-feedback/server";

export const handleFeedback = createFeedbackRequestHandler();
```

The returned function is a plain `(request: Request) => Promise<Response>`. It answers `POST` (and `OPTIONS` when `allowedOrigins` is set), returns `405` for other methods, and reads the multipart body itself.

- **Configuration.** With no `notion` and no `backend` option, `NOTION_API_KEY`, `NOTION_FEEDBACK_DATABASE_ID` and the optional `NOTION_API_BASE_URL` / `PINPOINT_PROJECT_ID` are read from `process.env` on the first submission. Missing variables produce `500 misconfigured`. On runtimes without `process.env`, pass `notion: { apiKey, databaseId }` explicitly. All options: [server](server.md).
- **Create it once** per process, at module scope or lazily. The handler holds the in-memory rate limiter, the cache of completed submission IDs and in-flight deduplication.
- **Client IP.** Rate limiting is per client IP. By default (`trustProxy: true`) the first hop of `X-Forwarded-For` or `X-Real-IP` is used, which suits platforms that set those headers. If nothing in front of your app sets them, set `trustProxy: false` and supply `getClientIp(request)`; otherwise every client shares the `"unknown"` bucket. Some snippets below show how.
- **Same-origin check.** Without `allowedOrigins`, cross-origin submissions are rejected by comparing the `Origin` header with the request URL's origin, the `Host` header, and `X-Forwarded-Host` when `trustProxy` is on. Adapters must pass the original `Host` header or build the `Request` URL with the public host.
- **Body parsing.** Don't let framework middleware consume the request body before the handler sees it.

### React Router v7 / Remix

```ts
// app/routes/api.feedback.ts
import { createFeedbackRequestHandler } from "pinpoint-feedback/server";

const handleFeedback = createFeedbackRequestHandler();

export function action({ request }: { request: Request }) {
  return handleFeedback(request);
}
```

Only `action` references the handler, so the route compiler keeps it out of the client bundle. Naming the module `*.server.ts` (and re-exporting from a route) makes that explicit.

### Hono

```ts
import { Hono } from "hono";
import { createFeedbackRequestHandler } from "pinpoint-feedback/server";

const handleFeedback = createFeedbackRequestHandler();
const app = new Hono();

app.on(["POST", "OPTIONS"], "/api/feedback", (c) => handleFeedback(c.req.raw));
```

### SvelteKit

```ts
// src/routes/api/feedback/+server.ts
import { createFeedbackRequestHandler } from "pinpoint-feedback/server";
import type { RequestHandler } from "./$types";

const handleFeedback = createFeedbackRequestHandler();

export const POST: RequestHandler = ({ request }) => handleFeedback(request);
```

### Bun and Deno

```ts
// Bun
import { createFeedbackRequestHandler } from "pinpoint-feedback/server";

const ips = new WeakMap<Request, string>();
const handleFeedback = createFeedbackRequestHandler({ trustProxy: false, getClientIp: (r) => ips.get(r) });

Bun.serve({
  fetch(req, server) {
    if (new URL(req.url).pathname !== "/api/feedback") return new Response("Not found", { status: 404 });
    const ip = server.requestIP(req)?.address;
    if (ip) ips.set(req, ip);
    return handleFeedback(req);
  },
});
```

```ts
// Deno: same imports, WeakMap and handler as above
Deno.serve((req, info) => {
  if (new URL(req.url).pathname !== "/api/feedback") return new Response("Not found", { status: 404 });
  ips.set(req, (info.remoteAddr as Deno.NetAddr).hostname);
  return handleFeedback(req);
});
```

Drop the `WeakMap` and `trustProxy: false` when a proxy in front sets `X-Forwarded-For`.

### Cloudflare Workers

Workers pass secrets as bindings rather than `process.env`, so configure Notion explicitly and create the handler on the first request:

```ts
import { createFeedbackRequestHandler, type FeedbackRequestHandler } from "pinpoint-feedback/server";

interface Env {
  NOTION_API_KEY: string;
  NOTION_FEEDBACK_DATABASE_ID: string;
}

let handleFeedback: FeedbackRequestHandler | undefined;

export default {
  fetch(request: Request, env: Env) {
    handleFeedback ??= createFeedbackRequestHandler({
      notion: { apiKey: env.NOTION_API_KEY, databaseId: env.NOTION_FEEDBACK_DATABASE_ID },
      trustProxy: false,
      getClientIp: (r) => r.headers.get("cf-connecting-ip") ?? undefined,
    });
    return handleFeedback(request);
  },
};
```

The rate limiter and duplicate cache live in isolate memory, so they're per isolate. Duplicate protection still holds because the Notion backend looks up the `Submission ID` property before creating a page ([reliability](reliability.md)).

### Express and other Node `http` servers

Node-style servers hand you `IncomingMessage`/`ServerResponse`, so convert them. Node 18+ has `Request`, `Headers` and `Readable.toWeb`, which is enough:

```ts
import express from "express";
import { Readable } from "node:stream";
import { createFeedbackRequestHandler } from "pinpoint-feedback/server";

const ips = new WeakMap<Request, string>();
const handleFeedback = createFeedbackRequestHandler({ trustProxy: false, getClientIp: (r) => ips.get(r) });

const app = express();

// No body parser on this route: the handler reads the raw multipart body.
app.all("/api/feedback", async (req, res, next) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else if (value !== undefined) headers.set(key, value);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`${req.protocol}://${req.get("host")}${req.originalUrl}`, {
      method: req.method,
      headers,
      body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
      duplex: "half",
    } as RequestInit);
    ips.set(request, req.socket.remoteAddress ?? "unknown");

    const response = await handleFeedback(request);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    next(error);
  }
});
```

`express.json()` and `express.urlencoded()` skip `multipart/form-data`, so global JSON parsing is fine; a global `multer` or raw-body middleware is not. Behind a reverse proxy, keep the default `trustProxy` instead of the `WeakMap`. Libraries such as `@remix-run/node-fetch-server` (`createRequestListener`) or `@whatwg-node/server` do the same conversion.

## React without Next.js

```tsx
import { FeedbackProvider } from "pinpoint-feedback/react";

export function App() {
  return (
    <FeedbackProvider endpoint="/api/feedback" position="bottom-right">
      <Routes />
    </FeedbackProvider>
  );
}
```

`pinpoint-feedback/react` exports `FeedbackProvider`, `FeedbackWidget` and `useFeedback` with the same props as the Next.js entry ([widget](widget.md)). Differences from `pinpoint-feedback/nextjs`:

- `endpoint` defaults to `"/api/feedback"`; `NEXT_PUBLIC_PINPOINT_ENDPOINT` / `NEXT_PUBLIC_PINPOINT_PROJECT_ID` are not read.
- The module starts with `"use client"`. Bundlers that don't know the directive ignore it.

The Shadow DOM host is created in an effect, so nothing renders on the server and SSR frameworks need no special handling. If the endpoint is on another origin, set `allowedOrigins` on the handler.

## Vanilla JS

The core package has no UI framework dependency. Capture, annotate and submit with your own UI:

```ts
import {
  collectBrowserMetadata,
  createAnnotationEditor,
  createDefaultCapturer,
  createFeedbackClient,
  createId,
} from "pinpoint-feedback";

const client = createFeedbackClient({ endpoint: "/api/feedback" });

// Re-send reports left in the outbox by an earlier page load or a lost connection.
void client.retryPending();
addEventListener("online", () => void client.retryPending({ force: true }));

const openedAt = Date.now();
// Elements with data-pinpoint-ignore (PINPOINT_IGNORE_ATTRIBUTE) are always left out of the capture.
const shot = await createDefaultCapturer().capture();

const editor = createAnnotationEditor({
  container: document.querySelector<HTMLElement>("#editor")!,
  image: shot.blob,
});
await editor.ready;

// ...user annotates and fills in a form...

const result = await client.submit(
  {
    submissionId: createId(),
    title: "Header overlaps the hero image",
    description: "On narrow screens the sticky header hides the CTA.",
    category: "bug",
    priority: "high",
    metadata: collectBrowserMetadata(),
    annotations: editor.getAnnotations(),
    capture: { method: shot.method, width: shot.width, height: shot.height, warnings: shot.warnings },
    createdAt: new Date().toISOString(),
    openedAt,
  },
  { screenshot: shot.blob, annotatedScreenshot: await editor.exportAnnotated() },
  { onProgress: (p) => console.log(p.phase, p.attempt) },
);

if (result.ok) console.log("Created", result.pageUrl);
else console.error(result.error.code, result.error.message);
```

Notes:

- `submit()` writes the report to the outbox (IndexedDB, in-memory fallback) before sending, retries retryable failures, and resolves with a `SubmissionResult`; it doesn't throw for transport errors. Keep the `submissionId` stable across manual retries. Details: [reliability](reliability.md).
- `openedAt` enables the server's minimum fill time check (`minFillTimeMs`, default 1.5 s). Without it the check is skipped.
- `category` must be one the server handler accepts ([categories](categories.md)). The client checks only its format.
- `new DomScreenshotCapturer({ messages, locale })` and `new DisplayMediaScreenshotCapturer()` can be used directly; see [screenshots](screenshots.md). The editor is documented in [annotation](annotation.md).

## Writing a framework adapter

`packages/nextjs` is the template. An adapter is two thin entries over the existing packages:

1. **Client entry.** Re-export the React components from `@pinpoint-feedback/react` with framework defaults. The Next.js one fills `endpoint` and `projectId` from `NEXT_PUBLIC_*` variables (read literally so Next can inline them) and falls back to `"/api/feedback"`.
2. **Server entry.** Wrap `createFeedbackRequestHandler`:
   - guard the module with the framework's server-only mechanism (`import "server-only"` in Next.js);
   - resolve configuration lazily on the first request (`resolveNotionConfigFromEnv(env)`), so builds work without secrets;
   - create the handler once and memoize it;
   - answer `500 { ok: false, error: { code: "misconfigured", … } }` and log the missing variable while configuration is invalid;
   - let explicit options override environment values.
3. **Build.** Vite library mode, ES output, every dependency external. Add a `"use client"` banner only to the client entry chunk, if the framework understands the directive (see `packages/nextjs/vite.config.ts`). Never use `export *` in a client-boundary module.
4. **Wire it into the repo.** Add the package to the root `workspaces` and `build` script (after `react`), a Vitest project and alias in `vitest.config.ts`, a path in `tsconfig.json`, and the entries to `packages/pinpoint-feedback/package.json` `exports` and to `entries` in `packages/pinpoint-feedback/scripts/build.mjs` (with `client: true` for the client entry).

See [architecture](architecture.md) for why the client boundary is built this way, and [development](development.md) for the build and test setup.
