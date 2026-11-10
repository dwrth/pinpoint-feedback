# Server

The server side is one function that turns a Web `Request` into a `Response`. It validates the submission, applies abuse checks, deduplicates by submission ID and stores the report through a backend (Notion by default).

| Entry point | Function | Use |
| --- | --- | --- |
| `pinpoint-feedback/nextjs/server` | `createFeedbackHandler(options?)` | Next.js route handler. Reads the environment lazily. |
| `pinpoint-feedback/nextjs/server` | `createFeedbackRouteHandlers(options?)` | Same, returned as `{ POST, OPTIONS }` for cross-origin setups. |
| `pinpoint-feedback/server` | `createFeedbackRequestHandler(options?)` | Framework-independent `(request: Request) => Promise<Response>`. |

## Next.js

```ts
// app/api/feedback/route.ts
import { createFeedbackHandler } from "pinpoint-feedback/nextjs/server";

export const runtime = "nodejs";

export const POST = createFeedbackHandler();
```

`createFeedbackHandler` differs from the plain handler in three ways:

- **Lazy configuration.** `NOTION_API_KEY`, `NOTION_FEEDBACK_DATABASE_ID`, `NOTION_API_BASE_URL` and `PINPOINT_PROJECT_ID` are read on the first request, so `next build` works without secrets. Until they're valid, it answers `500 misconfigured` and logs what's missing.
- **Memoisation.** The underlying handler is created once and reused.
- **Merging.** Options override the environment. A partial `notion` object (e.g. only `properties`) is merged onto the values from the environment. With an explicit `notion.apiKey` and `notion.databaseId`, the environment isn't required. With `backend`, it isn't read at all.

It also accepts `env`, an object to read the variables from instead of `process.env`.

## Any runtime

```ts
import { createFeedbackRequestHandler, resolveNotionConfigFromEnv } from "pinpoint-feedback/server";

const handleFeedback = createFeedbackRequestHandler({
  notion: resolveNotionConfigFromEnv(process.env),
});
```

Create the handler **once**, at module scope. It holds per-process state (rate limiter, completed-ID cache, in-flight map). Without `notion` and `backend`, it reads the environment on the first request; a missing variable becomes a `500 misconfigured` response. `resolveNotionConfigFromEnv` throws a `PinpointConfigError` naming the missing variables. Framework wiring is in [Frameworks](frameworks.md).

## Options

All options apply to both functions.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `notion.apiKey` | `string` | `NOTION_API_KEY` | Integration secret. |
| `notion.databaseId` | `string` | `NOTION_FEEDBACK_DATABASE_ID` | Database ID (with or without dashes), data source ID, or database URL. |
| `notion.baseUrl` | `string` | `NOTION_API_BASE_URL`, else Notion | API origin override. |
| `notion.properties` | `Partial<NotionPropertyNames>` | default names | Property name per field. See [Notion](notion.md#custom-property-names). |
| `notion.autoSetupSchema` | `boolean` | `true` | Add missing properties and category options on first use. |
| `notion.statusDefault` | `string` | `"New"` | Status written to new reports. |
| `notion.descriptionPropertyMaxChars` | `number` | `2000` | Characters of the description kept in the `Description` property. The page body has the full text. |
| `notion.projectId` | `string` | – | Project written to `Project`, replacing the client's. |
| `notion.timeoutMs` | `number` | `30000` | Per-request Notion timeout. |
| `notion.retry` | `NotionRetryOptions` | 3 retries, 500 ms–8 s | See [Notion](notion.md#rate-limits-and-retries). |
| `notion.throttle` | `NotionThrottleOptions` | 3 req/s, burst 5, 3 concurrent | See [Notion](notion.md#rate-limits-and-retries). |
| `notion.uploader` | `FileUploader` | Notion File Upload API | Store screenshots elsewhere. |
| `notion.client` | Notion `Client` | created from `apiKey` | Injected SDK client; `apiKey`, `baseUrl` and `timeoutMs` are then ignored. |
| `notion.categories` / `locale` / `messages` | – | handler's values | Override the handler-level values for the backend only. |
| `backend` | `FeedbackBackend` | Notion backend | Replace persistence, e.g. in tests. Disables all `notion.*` options. |
| `categories` | `CategoryList` | the five built-ins | Accepted category IDs. Others get `400 validation`. Must match the widget. See [Categories](categories.md). |
| `locale` | `LocaleBundle` | English | Language of the Notion page body. See [Internationalization](i18n.md). |
| `messages` | `LocaleOverrides` | – | Overrides on top of `locale`; only the `report` section is used. |
| `projectId` | `string` | `PINPOINT_PROJECT_ID` | Written to `Project` for every report, **replacing** the `projectId` the widget sent. |
| `allowedOrigins` | `string[] \| "*"` | same-origin only | Cross-origin callers that may submit. Enables CORS headers for them. |
| `rateLimit` | `{ max, windowMs } \| false` | `{ max: 10, windowMs: 600000 }` | Per-client-IP, in-memory sliding window. `false` disables it. |
| `trustProxy` | `boolean` | `true` | Read the client IP and host from `X-Forwarded-For` / `X-Real-IP` / `X-Forwarded-Host`. See [below](#client-ip-and-trustproxy). |
| `getClientIp` | `(request) => string \| undefined` | – | Custom client IP for rate limiting. Takes precedence over the headers. |
| `maxFileBytes` | `number` | `5242880` (5 MB) | Maximum size of each screenshot. |
| `minFillTimeMs` | `number` | `1500` | Reject submissions sent sooner than this after the widget opened. `0` disables. |
| `onSubmission` | `(submission, record) => void \| Promise<void>` | – | Called after a new page is created, not for duplicates. Awaited before responding; errors are logged and ignored. |
| `logger` | `{ info, warn, error }` | `console` | Server diagnostics. Secrets are never logged. |

Invalid `categories` throw a `CategoryConfigError` when the handler is created. In Next.js, that is logged and answered with `500 misconfigured`.

### `onSubmission`

```ts
export const POST = createFeedbackHandler({
  async onSubmission(submission, record) {
    await fetch(process.env.SLACK_WEBHOOK_URL!, {
      method: "POST",
      body: JSON.stringify({ text: `New feedback: ${submission.title} ${record.url ?? ""}` }),
    });
  },
});
```

The hook runs before the response is sent, so keep it fast.

### Client IP and `trustProxy`

The rate limiter needs a client IP. The handler uses, in order:

1. `getClientIp(request)`, if it returns a value;
2. with `trustProxy: true`, the first entry of `X-Forwarded-For`, then `X-Real-IP`;
3. otherwise the shared key `"unknown"`.

The default (`true`) suits Vercel, Netlify, Cloudflare and most reverse proxies, which set these headers. Set `trustProxy: false` when the app is reachable directly, without a proxy that overwrites the headers, because clients could otherwise send a fake `X-Forwarded-For` to dodge the limit.

A Web `Request` carries no socket address. With `trustProxy: false` and no `getClientIp`, every client shares one bucket, so 10 reports per 10 minutes apply to the whole site. Pass `getClientIp` from your server's connection info, or disable `rateLimit`.

`trustProxy` also lets `X-Forwarded-Host` count as the request's host in the same-origin check.

## Request pipeline

For a `POST`, in order:

1. **Origin.** Cross-origin requests are rejected with `403` unless the origin is in `allowedOrigins`. A request without `Origin` but with `Sec-Fetch-Site: cross-site` is rejected when `allowedOrigins` isn't set.
2. **Rate limit** per client IP (`429`). Every request counts, including invalid ones and client retries.
3. **Content type** must be `multipart/form-data` (`415`).
4. **Body size.** Capped at 512 KB for the JSON plus `2 × maxFileBytes` plus 64 KB, checked against `Content-Length` and while streaming (`413`).
5. **Payload.** The `payload` field must be at most 512 KB of valid JSON and pass schema validation: lengths capped, enums enforced, URLs checked, annotations bounded, `submissionId` a UUID, category in `categories`. Unknown fields are dropped (`400 validation`, with `details.issues`).
6. **Honeypot.** A non-empty `website` field is rejected (`400 spam`).
7. **Fill time.** If the client sent `openedAt`, a value more than 60 s in the future or less than `minFillTimeMs` ago is rejected (`400 spam`).
8. **Files.** `screenshot` and `annotatedScreenshot` are optional. Each must be non-empty, at most `maxFileBytes` (`413`), and its magic bytes must identify PNG, JPEG or WebP; a declared type other than those (or `application/octet-stream`) is rejected (`415`). The sniffed type is what gets stored.
9. **Project.** `projectId` (option) replaces the client's value.
10. **Dedupe.** See [Reliability](reliability.md#server-idempotency).
11. **Persist** through the backend. Success is returned only once the backend confirms a record ID.

## Responses

Success:

```json
{ "ok": true, "submissionId": "…", "pageId": "…", "pageUrl": "https://www.notion.so/…", "duplicate": false }
```

Failure:

```json
{ "ok": false, "submissionId": "…", "error": { "code": "validation", "message": "…", "retryable": false, "details": { "issues": [] } } }
```

`submissionId` is included once the payload has been parsed. `retryAfter` (seconds) is added to the error, and a `Retry-After` header is set, when known. All JSON responses carry `Cache-Control: no-store`.

| Status | Code | Retryable | When |
| --- | --- | --- | --- |
| `201` | – | – | Page created. |
| `200` | – | – | Duplicate: the page already existed (`duplicate: true`). |
| `204` | – | – | CORS preflight accepted. |
| `400` | `validation` | no | Malformed body or JSON, schema error, unknown category. |
| `400` | `spam` | no | Honeypot or fill-time check. |
| `403` | `validation` | no | Cross-origin request not allowed. Preflights get an empty `403`. |
| `405` | `validation` | no | Method other than `POST` or `OPTIONS`. `OPTIONS` without `allowedOrigins` gets an empty `405`. |
| `413` | `payload_too_large` | no | Body, payload or a file too large. |
| `415` | `unsupported_media_type` | no | Not multipart, or a file isn't PNG/JPEG/WebP. |
| `429` | `rate_limited` | yes | Handler rate limit. `Retry-After` is set. |
| `500` | `misconfigured` | no | Missing or invalid configuration. |
| `500` | `server_error` | yes | Unexpected error, or the backend returned no record ID. |
| `502` | `notion_unauthorized` | no | Notion returned 401 or 403. |
| `502` | `notion_not_found` | no | Notion returned 404: database missing or not shared. |
| `502` | `notion_error` | no / yes | Notion rejected the request (no), or a transient Notion failure persisted after retries (yes). |
| `503` | `notion_error` | yes | Notion rate limit or `service_unavailable` persisted after retries. `Retry-After` when Notion sent one. |

The codes `network` and `timeout` only occur on the client. Messages are safe for end users; Notion error details and stack traces go to `logger` only.

## CORS

By default only same-origin submissions are accepted. If the widget runs on another origin than the endpoint, list it and handle the preflight:

```ts
import { createFeedbackRouteHandlers } from "pinpoint-feedback/nextjs/server";

export const { POST, OPTIONS } = createFeedbackRouteHandlers({
  allowedOrigins: ["https://www.example.com"],
});
```

`POST` and `OPTIONS` share one handler instance. Behaviour:

- Allowed origins get `Access-Control-Allow-Origin` (the origin itself, or `*` with `allowedOrigins: "*"`) and `Vary: Origin`.
- `OPTIONS` answers `204` with `Access-Control-Allow-Methods: POST, OPTIONS`, the requested headers (or `content-type`), and `Access-Control-Max-Age: 86400`. Without `allowedOrigins`, `OPTIONS` answers `405`.
- Entries in `allowedOrigins` are normalised to their origin, so `https://www.example.com/` works.

With the plain handler, route both `POST` and `OPTIONS` to it.

## Security

- **Server-only import.** `pinpoint-feedback/nextjs/server` starts with `import "server-only"`, so importing it from a Client Component fails the build. The client entry points (`pinpoint-feedback`, `/react`, `/nextjs`) contain no server code and no Notion SDK.
- **Secrets.** The Notion token is only read on the server and never logged. Configuration errors name missing variables, not values.
- **Validation.** Schema-checked payload with capped lengths and bounded annotations; unknown fields dropped before anything reaches Notion.
- **Uploads.** PNG, JPEG or WebP only, verified by magic bytes; per-file `maxFileBytes`; total body size capped while streaming.
- **Abuse.** Per-IP rate limit, hidden honeypot field, minimum fill time.
- **Origin checks.** Same-origin by default; `allowedOrigins` to open it up.
- **Error hygiene.** Clients get a stable code and safe message.

## Runtime

`export const runtime = "nodejs"` is recommended. The handler only uses Web APIs (`Request`, `FormData`, `fetch`, streams), so it also runs on the Edge runtime, Bun, Deno and Cloudflare Workers. But the rate limiter, the completed-submission cache and the Notion throttle live in memory per instance; they work best in a long-lived process. On serverless platforms each instance has its own state; see [Reliability](reliability.md#serverless).
