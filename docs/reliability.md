# Reliability

A report should reach Notion exactly once, even if the network drops, the tab closes or a response gets lost. Three things make that work: a submission ID that stays the same across attempts, a client-side outbox, and idempotent handling on the server.

## Submission IDs

The browser generates a UUID (`createId()`, using `crypto.randomUUID` when available) for each report. Every attempt for that report sends the same ID in the payload's `submissionId`, and the HTTP transport also sends it as an `Idempotency-Key` header. The server deduplicates on the payload's `submissionId`; it doesn't read the header.

The ID is stored in the `Submission ID` property of the Notion page and shown at the bottom of the page body.

## Server idempotency

After validation, the handler checks for an existing result in this order:

| Step | Scope | Behaviour |
| --- | --- | --- |
| Completed cache | per handler instance | In-memory LRU of confirmed records: 1000 entries, 24 h TTL. A hit returns `200` with `duplicate: true`. |
| In-flight map | per handler instance | If the same ID is already being processed, the request waits for that result instead of starting a second write. |
| Notion lookup | authoritative | Before creating a page, the backend queries the database for a page whose `Submission ID` equals the ID. A match returns `200` with `duplicate: true`. |
| Lookup before retry | authoritative | When page creation fails with a retryable error, the backend sleeps, then queries `Submission ID` again before retrying. If the page exists, it's used. |

The last step covers lost responses: Notion may create the page and then the response times out. Without the lookup, the retry would create a second page.

The Notion lookup needs `Submission ID` to be a Text property. If it's missing or has another type, the backend logs a warning and only the in-memory checks remain.

A custom `backend` that implements `findBySubmissionId` gets the same lookup from the handler before `createRecord` is called.

`onSubmission` runs only for newly created pages, never for duplicates.

## Success means Notion confirmed

The handler returns `ok: true` only after the backend resolved with a page ID. The widget shows its success state only after receiving that response. On failure the dialog keeps what the reporter typed and drew, shows the reason, and offers **Retry**.

A page whose body exceeds 100 blocks is created first and the rest appended. If appending fails, the page still exists and the report counts as delivered; the error is logged.

## Client outbox

Before the first request, the client writes the report and both image blobs to an outbox:

- **IndexedDB** database `pinpoint-feedback`, store `outbox`, keyed by submission ID. Blobs are stored as is, so a report survives a reload or a closed tab.
- **Memory fallback** when IndexedDB is unavailable (SSR, Safari private mode, blocked storage) or doesn't open within 3 s. If IndexedDB fails mid-session, the outbox switches to memory for the rest of the page's life. Memory entries are lost on reload.

An entry is removed only after the server confirms the page, or after a permanent failure (see below).

## Retries

`submit()` sends the report, and on a retryable failure waits and tries again, up to `maxAttempts` attempts in total (default `3`, so two retries).

Backoff: `1s × 3^(n−1)`, capped at 30 s, with ±20 % jitter (1 s, 3 s, 9 s, …). If the server sends `retryAfter`, the delay is at least that long. A delay longer than 60 s (`maxInlineWaitMs`) ends the call; the entry stays queued for later.

| Failure | Retried in `submit()` | Kept in outbox |
| --- | --- | --- |
| Network error | yes | yes |
| Timeout (default 60 s per request) | yes | yes |
| `429 rate_limited` | yes | yes |
| `5xx` with `retryable: true` (`server_error`, transient `notion_error`) | yes | yes |
| Retries exhausted | – | yes |
| `misconfigured`, `notion_unauthorized`, `notion_not_found`, non-retryable `notion_error` | no | yes |
| Caller abort | no | yes |
| `validation`, `spam`, `payload_too_large`, `unsupported_media_type` | no | **no** (dropped) |

The dropped codes can never succeed with the same payload. Everything else stays, because a fixed configuration or a recovered Notion can still accept it later.

Before queueing, the client also validates the payload and fits each screenshot into `maxFileBytes` (default 5 MB) by re-encoding or downscaling it. Payload validation failures are returned immediately and nothing is queued.

Client options (`createFeedbackClient`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `endpoint` | `string` | – | Server handler URL. |
| `maxAttempts` | `number` | `3` | Attempts per `submit()` call. |
| `timeoutMs` | `number` | `60000` | Per-request timeout. `0` disables. |
| `maxFileBytes` | `number` | `5242880` | Screenshots larger than this are re-encoded or downscaled. |
| `backoff` | `{ baseDelayMs, factor, maxDelayMs, jitter }` | `1000`, `3`, `30000`, `0.2` | Retry delays. |
| `maxInlineWaitMs` | `number` | `60000` | Longest wait inside `submit()`. |
| `validate` | `boolean` | `true` | Validate before queueing. |
| `transport` / `outbox` | `FeedbackTransport` / `FeedbackOutbox` | HTTP / IndexedDB with fallback | Replace either part. |
| `headers` / `fetch` | – | – | Extra request headers / custom `fetch`. |

Concurrent `submit()` calls for the same ID share one run.

## Pending reports

`retryPending()` sends each queued entry once, oldest first. Entries whose next attempt time is still in the future are skipped unless called with `{ force: true }`. It's single-flight and skips IDs that `submit()` is currently handling.

The widget calls it:

- on load (due entries only),
- on the browser's `online` event (forced),
- from `useFeedback().retryPending()` (forced).

`useFeedback().pendingCount` is the number of queued reports, and the floating button shows it as a badge. See [Widget](widget.md).

## Serverless

The completed cache, the in-flight map, the rate limiter and the Notion throttle all live in memory, per handler instance. On serverless platforms each instance has its own copy, and it's lost on cold start. Two retries of the same report can land on different instances at the same time; both then pass the in-memory checks.

The Notion `Submission ID` lookup is what still prevents duplicates there, since it reads shared state. Two requests racing within the same second on different instances can, in rare cases, both find no page and both create one. Keep `Submission ID` as a Text property, and prefer a long-lived Node process (`export const runtime = "nodejs"`) where you can.
