# Getting started

This guide sets up the widget and its server route in a Next.js App Router app, with reports stored in a Notion database. For other frameworks, see [Frameworks](frameworks.md).

## Install

```bash
npm install pinpoint-feedback
```

Peer dependencies: `react` and `react-dom` 18.2+ for the widget, and `next` 14.2+ for the `pinpoint-feedback/nextjs` entry points.

## 1. Create a Notion integration

1. Open [notion.so/profile/integrations](https://www.notion.so/profile/integrations) and choose **New integration**.
2. Pick the workspace, keep the type **Internal**, and save.
3. Under **Capabilities**, enable **Read content**, **Insert content** and **Update content**.
4. Copy the **Internal Integration Secret**. It starts with `ntn_` (older integrations use `secret_`).

The secret is only ever read on the server.

## 2. Create the database and share it

1. Create a database for the reports, for example a full-page database called "Website feedback". It only needs its default title column. The other columns are added on the first submission (see [Notion](notion.md#schema-auto-setup)).
2. Open the database, click **•••** in the top-right corner, then **Connections → Add connections**, and pick your integration.

Without step 2, Notion answers `object_not_found` and the endpoint returns `notion_not_found`.

## 3. Copy the database ID

Take the ID from the database URL. In

```
https://www.notion.so/acme/0123456789abcdef0123456789abcdef?v=…
```

the ID is the 32-character hex string before `?v=`. The hyphenated UUID form works too, and so does the full URL: the package extracts the ID from it.

## 4. Set environment variables

In `.env.local` (or your host's settings):

```bash
NOTION_API_KEY=ntn_...
NOTION_FEEDBACK_DATABASE_ID=0123456789abcdef0123456789abcdef
```

| Variable | Read by | Required | Description |
| --- | --- | --- | --- |
| `NOTION_API_KEY` | server | yes | Internal integration secret. |
| `NOTION_FEEDBACK_DATABASE_ID` | server | yes | Database ID, hyphenated UUID, or database URL. |
| `NOTION_API_BASE_URL` | server | no | Notion API origin override, for a proxy or the bundled test mock. |
| `PINPOINT_PROJECT_ID` | server | no | Project written to the `Project` property of every report. The server value wins; the widget's `projectId` is used only when the server has none. |
| `NEXT_PUBLIC_PINPOINT_ENDPOINT` | client | no | Endpoint used by `pinpoint-feedback/nextjs` when no `endpoint` prop is passed. Default `/api/feedback`. |
| `NEXT_PUBLIC_PINPOINT_PROJECT_ID` | client | no | `projectId` used by `pinpoint-feedback/nextjs` when no `projectId` prop is passed. |

The server variables are read on the first request, not at import time. `next build` succeeds without them, and until they are set the endpoint answers `500` with error code `misconfigured`. The server log names the missing variable, never its value.

The `NEXT_PUBLIC_*` variables are inlined by Next.js at build time, so changing them needs a rebuild.

## 5. Render the widget

`app/layout.tsx`:

```tsx
import { FeedbackProvider } from "pinpoint-feedback/nextjs";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <FeedbackProvider position="bottom-right" theme="light" />
      </body>
    </html>
  );
}
```

`FeedbackProvider` can be rendered directly from a Server Component layout. All props are listed in [Widget](widget.md).

## 6. Add the route

`app/api/feedback/route.ts`:

```ts
import { createFeedbackHandler } from "pinpoint-feedback/nextjs/server";

export const runtime = "nodejs";

export const POST = createFeedbackHandler();
```

Options, CORS and status codes are covered in [Server](server.md). A complete app lives in [`examples/nextjs-app`](../examples/nextjs-app).

## 7. Send a test report

Open the site, click **Feedback**, annotate the screenshot and submit. On the first submission the handler:

1. resolves the database and adds any missing properties (`Description`, `Status`, `Category`, …),
2. uploads the original and annotated screenshots,
3. creates the page.

The widget shows success only after Notion has confirmed the page. See [Notion](notion.md) for the columns and page layout.

## Troubleshooting

Errors are returned as `{ ok: false, error: { code, message, retryable } }`. The server log has the details.

| Code | Status | Cause | Fix |
| --- | --- | --- | --- |
| `misconfigured` | 500 | `NOTION_API_KEY` or `NOTION_FEEDBACK_DATABASE_ID` missing, or the database ID can't be parsed. | Set the variables on the server and redeploy. The log names the missing one. |
| `notion_unauthorized` | 502 | Notion rejected the secret (401), or the integration lacks permission (403). | Check `NOTION_API_KEY` is the integration's internal secret, and that Read, Insert and Update content are enabled. |
| `notion_not_found` | 502 | The database doesn't exist or isn't shared with the integration. | Share the database via **••• → Connections**, and check the ID. |
| `notion_error` | 502 / 503 | Notion rejected the request, is unavailable, or is rate-limiting (503 with `Retry-After`). | Transient errors are retried automatically. For a persistent `502`, the logged message includes Notion's reason. |
| `rate_limited` | 429 | The handler's own per-IP limit (default 10 per 10 minutes) was hit. | Wait for `Retry-After`. Behind a proxy, check the client IP is detected correctly; see [`trustProxy`](server.md#client-ip-and-trustproxy). |
| `spam` | 400 | Honeypot field filled, or the form was submitted faster than `minFillTimeMs`. | Usually a bot. In automated tests, set `minFillTimeMs: 0`. |
| `validation` | 400 / 403 / 405 | Invalid payload, unknown category, cross-origin request, or wrong method. | For `403`, add the site's origin to `allowedOrigins`. For unknown categories, pass the same list to widget and handler ([Categories](categories.md)). |

A property that exists with an incompatible type is not filled; the server logs a warning naming it. See [Notion](notion.md#schema-auto-setup).
