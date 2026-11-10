# Notion

Every report becomes one page in a Notion database. The server talks to Notion through `NotionFeedbackBackend` (`pinpoint-feedback/server`), using the official `@notionhq/client` SDK and your integration secret. Setup steps are in [Getting started](getting-started.md).

## Database properties

| Default name | Created as | Also accepted | Content | `notion.properties` key |
| --- | --- | --- | --- | --- |
| `Title` | Title | – | Report title | `title` |
| `Description` | Text | – | Description, truncated to `descriptionPropertyMaxChars` (default 2000) | `description` |
| `Status` | Select | Status | `statusDefault` (default `New`) | `status` |
| `Category` | Select | Multi-select, Status, Text | Category label: `Bug`, `Design`, `Content`, `Feature request`, `Other`, or your own ([Categories](categories.md)) | `category` |
| `Priority` | Select | Multi-select, Status, Text | `Low`, `Medium`, `High`, `Critical` | `priority` |
| `Website URL` | URL | Text | URL of the page the report was made on | `websiteUrl` |
| `Page Title` | Text | – | `document.title` of that page | `pageTitle` |
| `Screenshot` | Files & media | – | Original screenshot | `screenshot` |
| `Annotated Screenshot` | Files & media | – | Screenshot with annotations | `annotatedScreenshot` |
| `Reporter Name` | Text | – | Name, if given | `reporterName` |
| `Reporter Email` | Email | Text | Email, if given | `reporterEmail` |
| `Browser` | Text | – | e.g. `Chrome 142` | `browser` |
| `Operating System` | Text | – | e.g. `macOS 15.1` | `os` |
| `Viewport` | Text | – | e.g. `1440×900 @2x` | `viewport` |
| `Created` | Date | – | Client timestamp of the report (`createdAt`) | `created` |
| `Project` | Text | Select | Project ID, if any | `project` |
| `Submission ID` | Text | – | Client-generated UUID, used for [idempotency](reliability.md) | `submissionId` |

Options created with the selects:

| Property | Options (color) |
| --- | --- |
| `Status` | `New` (blue), `In progress` (yellow), `Resolved` (green), `Won't fix` (gray) |
| `Priority` | `Low` (gray), `Medium` (blue), `High` (orange), `Critical` (red) |
| `Category` | One per configured category, with its `color` (built-ins: `Bug` red, `Design` purple, `Content` blue, `Feature request` green, `Other` gray) |

Empty values (no reporter, no project, …) are left unset.

### Custom property names

Map any field to a different column with `notion.properties`. Unlisted fields keep their default names.

```ts
export const POST = createFeedbackHandler({
  notion: { properties: { websiteUrl: "URL", title: "Name", status: "State" } },
});
```

In Next.js, a partial `notion` object is merged with the values from the environment, so you don't need to repeat `apiKey` and `databaseId`.

## Schema auto-setup

With `notion.autoSetupSchema` on (the default), the backend inspects the database on the first request and caches the result for the lifetime of the handler.

- **Missing properties are added**, all in one update, with the types in the "Created as" column. Nothing else is changed.
- **Existing properties are never renamed, retyped or deleted.**
- **Title.** Every database has exactly one title property, which is never created. If no title property has the configured name, the existing title property is used, whatever it's called.
- **Compatible types are reused.** A property whose type is in "Created as" or "Also accepted" is filled. You can, for example, turn `Status` into a Notion Status property or `Project` into a select.
- **Incompatible types are skipped.** The field isn't written, and a warning names the property, its type and the expected types.
- **Category options.** Options for configured categories that are missing from a `Category` select or multi-select are appended with their colors. Existing options are left alone.
- **Status-type properties.** Notion's API can't add options to a Status property. A value is written only if the option already exists, so for a Status-type `Status` column set `notion.statusDefault` to one of its options (for example `"Not started"`). A Status-type `Category` without a matching option logs a warning and the report is saved without a category.
- **`Submission ID`** must be a Text property. Otherwise duplicate detection in Notion is disabled and a warning is logged.

With `autoSetupSchema: false`, nothing is created; fields whose property doesn't exist are skipped. Notion still adds unknown options to plain select properties when a page is written.

The backend targets the database's first data source (Notion API `2025-09-03`). A data source ID also works in place of a database ID.

If Notion rejects a page with `validation_error` (for example because the database was edited since the schema was cached), the backend reloads the schema and retries once.

## Page body

The body is written by the server, in the handler's `locale` (see [Internationalization](i18n.md)). Top to bottom:

1. **Callout** with the category's emoji, the category, priority and, if given, the reporter (`Bug · High · reported by Ada`).
2. **Description** heading and the full description, one paragraph per blank-line-separated block. Never truncated.
3. **Annotated screenshot** heading and image block.
4. **Original screenshot** heading and image block.
5. **Annotations** heading (if any): numbered pins with their notes, text annotations, and a count of arrows, rectangles and freehand drawings.
6. **Capture notes** heading (if any): one line per [capture warning](screenshots.md), with counts.
7. **Environment** heading: URL, page title, browser, OS, viewport, screen, pixel ratio, language, timezone, referrer, capture method and size, submission time (UTC), user agent. Empty values are omitted.
8. The submission ID in small gray text.

The page is created with the first 100 blocks; any further blocks are appended in batches of 100. If an append fails, the page is still reported as created and the error is logged.

## File uploads

Screenshots are uploaded with Notion's [File Upload API](https://developers.notion.com/docs/uploading-small-files) in single-part mode:

1. `POST /v1/file_uploads` with `mode: "single_part"`, filename and content type.
2. `POST /v1/file_uploads/{id}/send` with the bytes.
3. The upload ID is referenced in the page, once in the files property and once in the image block. Each file is uploaded only once.

Notion must see the upload attached within an hour, which happens in the same request. Only `file_upload` references are stored, never the temporary signed URLs Notion returns when reading a file, so links in the database don't expire.

Size limits:

| Limit | Value |
| --- | --- |
| `maxFileBytes` (handler option) | 5 MB default. Larger files are rejected with `413`. |
| Notion single-part upload | 5 MB on free workspaces, 20 MB on paid ones. |
| `NotionFileUploader` hard cap | 20 MB. |

Raise `maxFileBytes` only on a paid workspace. The widget's client also fits screenshots into 5 MB by default (re-encoding or downscaling them), independent of the server setting.

Files are named `pinpoint-<first 8 chars of the submission ID>-original.<ext>` and `…-annotated.<ext>`, with the extension taken from the sniffed image type.

To store images elsewhere (S3, R2, …), pass a `FileUploader` as `notion.uploader`. See [Architecture](architecture.md).

## Rate limits and retries

Notion allows an average of three requests per second per integration. Each backend instance runs all Notion calls through a queue:

| Option | Default | Description |
| --- | --- | --- |
| `notion.throttle.requestsPerSecond` | `3` | Sustained rate (token bucket). |
| `notion.throttle.burst` | `5` | Bucket capacity. |
| `notion.throttle.maxConcurrent` | `3` | Requests in flight at once. |
| `notion.retry.maxRetries` | `3` | Retries after the first attempt. |
| `notion.retry.baseDelayMs` | `500` | First backoff delay. |
| `notion.retry.maxDelayMs` | `8000` | Cap for exponential backoff (with jitter). |
| `notion.retry.maxRetryAfterMs` | `30000` | A `Retry-After` longer than this isn't waited out; the error is returned to the client with that `retryAfter`. |
| `notion.timeoutMs` | `30000` | Per-request timeout. |

Retried: `429` (honouring `Retry-After`), `5xx`, `conflict_error`, timeouts and network errors. Not retried: `400`, `401`, `403`, `404`. Before each retry of page creation, the backend checks `Submission ID` again so a page that was created despite an error isn't duplicated (see [Reliability](reliability.md)).

The throttle is per process. Several server instances share Notion's limit, and the retries absorb the occasional `429`.

## What is never localized

The handler's `locale` only affects the page body. These stay the same in every language, so filters and views keep working:

- property names (`Title`, `Status`, …, or your `notion.properties`),
- `Status` and `Priority` option names,
- `Category` option names (the category's `label`; per-language `labels` only affect the widget and the callout),
- error messages returned by the API.
