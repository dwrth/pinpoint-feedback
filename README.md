# Pinpoint Feedback

Visual website feedback for your own site. Visitors click a button, get a screenshot of the page they're on, mark it up with pins, arrows, boxes, freehand drawings and text, and send it with a title and description. Every report lands as a page in **your Notion database**, with the original screenshot, the annotated screenshot and the browser details attached.

You don't need any other backend. Notion is the only place reports are stored, and the package talks to it from your own server route with your own integration token.

```
Browser                         Your server (Next.js route)            Notion
┌──────────────────────┐  POST  ┌──────────────────────────────┐  API  ┌──────────────┐
│ widget → screenshot  │ ─────▶ │ validate · rate-limit · dedupe│ ────▶ │ database row │
│ → annotate → submit  │ ◀───── │ upload files · create page    │ ◀──── │ + 2 images   │
└──────────────────────┘  JSON  └──────────────────────────────┘       └──────────────┘
```

## Features

- **Floating feedback button** for any page, with an optional keyboard shortcut. It renders in an isolated Shadow DOM, so your page's styles don't leak in and its styles don't leak out.
- **Screenshot of the current viewport**, rendered from the DOM. Nothing to install and no permission prompt. If that isn't possible, it can fall back to the browser's screen-capture prompt.
- **Annotation editor** with pin markers (numbered, with optional notes), freehand, arrows, rectangles and text. You can pick colors and stroke widths, use undo/redo, zoom, pan, and reset to the original screenshot. Annotations are stored as vectors in screenshot pixel space.
- **Structured reports**: title, description, category (bug, design, content, feature, other, or [your own](#custom-categories)), priority (low to critical) and optional reporter name/email. Page URL, title, browser, OS, viewport, screen size, device pixel ratio, language and timezone are collected automatically.
- **Straight to Notion**: one database row per report, with properties for filtering and both images attached as Notion file uploads.
- **Reliable**: every report gets a submission ID, which makes retries idempotent. A client-side outbox in IndexedDB keeps the report if the tab closes mid-send, and failed sends are retried automatically. The widget shows success only after Notion has confirmed the page exists.
- **Secure by default**: the Notion token lives only on the server, payloads are validated and capped, requests are rate-limited, a honeypot catches simple bots, and uploads are checked for allowed type, magic bytes and size.
- **Framework-agnostic core**: Next.js gets a one-line setup. React works on its own, and the server handler is a plain Web `Request → Response` function, so it runs on any modern runtime.

## Install

```bash
npm install pinpoint-feedback
```

`react`/`react-dom` (18.2+) are peer dependencies for the widget, and `next` (14.2+) for the Next.js entry points.

## Notion setup

1. **Create an integration.** Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations) and choose **New integration**. Pick the workspace, keep the type **Internal**, and save. Under **Capabilities**, enable *Read content*, *Update content* and *Insert content*. Copy the **Internal Integration Secret** (it starts with `ntn_` or `secret_`).
2. **Create a database** for the reports, for example a full-page database called "Website feedback". The only column you need is the default title column. When `autoSetupSchema` is enabled (the default), the package adds any missing properties from the [table below](#notion-database-properties) on the first submission. You can also create them yourself.
3. **Share the database with the integration.** Open the database, click **•••** in the top-right corner, then **Connections → Add connections**, and pick your integration. Without this step, Notion returns `object_not_found`.
4. **Copy the database ID** from the URL. In `https://www.notion.so/acme/0123456789abcdef0123456789abcdef?v=…`, it's the 32-character hex string before `?v=`. The hyphenated UUID form works too.
5. **Set the environment variables** on your server, for example in `.env.local`:

```bash
NOTION_API_KEY=ntn_...
NOTION_FEEDBACK_DATABASE_ID=0123456789abcdef0123456789abcdef
```

### Environment variables

| Variable | Where | Required | Description |
| --- | --- | --- | --- |
| `NOTION_API_KEY` | server | yes | Internal integration secret. |
| `NOTION_FEEDBACK_DATABASE_ID` | server | yes | ID of the database (or its URL) that receives reports. |
| `PINPOINT_PROJECT_ID` | server | no | Default project tag stored with every report, which is useful when several sites share one database. |
| `NOTION_API_BASE_URL` | server | no | Override the Notion API origin, for proxies or the bundled test mock. |
| `NEXT_PUBLIC_PINPOINT_ENDPOINT` | client | no | Endpoint used by `pinpoint-feedback/nextjs` when no `endpoint` prop is passed. Default `/api/feedback`. |
| `NEXT_PUBLIC_PINPOINT_PROJECT_ID` | client | no | Project ID used when no `projectId` prop is passed. |

The Notion variables are read when a request comes in, not at import time. So `next build` succeeds without them, and the endpoint answers `500 { error: { code: "misconfigured" } }` until they're set. The server log names the missing variable.

## Next.js (App Router)

**`app/layout.tsx`**: render the widget once. It works from a Server Component and needs no wrapper.

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

**`app/api/feedback/route.ts`**: the server endpoint.

```ts
import { createFeedbackHandler } from "pinpoint-feedback/nextjs/server";

export const runtime = "nodejs";

export const POST = createFeedbackHandler();
```

That's the whole integration. You'll find a working app in [`examples/nextjs-app`](examples/nextjs-app).

- `export const runtime = "nodejs"` is recommended. The handler only uses Web APIs (`Request`, `FormData`, `fetch`), so it also runs on the Edge runtime, but the in-memory rate limiter and idempotency cache work best in a long-lived Node process.
- If the widget is served from a different origin than the endpoint, allow that origin and also export an `OPTIONS` handler for the CORS preflight:

  ```ts
  import { createFeedbackRouteHandlers } from "pinpoint-feedback/nextjs/server";

  export const { POST, OPTIONS } = createFeedbackRouteHandlers({ allowedOrigins: ["https://www.example.com"] });
  ```
- `createFeedbackHandler(options)` accepts every [handler option](#server-handler-options). Options you pass override the environment variables.

To open the widget from your own UI, put your app inside the provider and use the hook:

```tsx
"use client";
import { useFeedback } from "pinpoint-feedback/nextjs";

export function ReportBugButton() {
  const feedback = useFeedback();
  return <button onClick={() => feedback.open()}>Report a bug</button>;
}
```

## Configuration

### Widget props

These props apply to `FeedbackProvider` and `FeedbackWidget`, from both `pinpoint-feedback/nextjs` and `pinpoint-feedback/react`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `endpoint` | `string` | `"/api/feedback"` | URL of the server handler. |
| `position` | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Corner for the floating button. |
| `theme` | `"light" \| "dark" \| "system"` | `"system"` | Color scheme of the widget. |
| `accentColor` | CSS color | built-in blue | Primary buttons, focus rings and selection. |
| `projectId` | `string` | – | Stored with each report, so several sites can share one database. |
| `reporter` | `{ name?, email? }` | – | A reporter you already know, such as the signed-in user. Hides the name/email fields. |
| `collectReporter` | `boolean` | `true` | Show optional name/email fields. |
| `buttonLabel` | `string` | `"Feedback"`, localized | Text on the floating button. Overrides the locale's `launcher.label`. |
| `hotkey` | `string \| false` | `false` | Shortcut that toggles the widget, e.g. `"mod+shift+f"`. `mod` is ⌘ on Apple and Ctrl elsewhere. |
| `zIndex` | `number` | `2147483000` | Stacking order of the widget. |
| `categories` | `CategoryList`: built-in ids and/or `{ id, label, color?, emoji? }` | the five built-ins | Categories offered in the form, in this order. Must be the same list as the handler's `categories`; see [Custom categories](#custom-categories). |
| `defaultCategory` / `defaultPriority` | an id from `categories` / `FeedbackPriority` | first category / `"medium"` | Initial form values. `defaultCategory` is type-checked against `categories`. |
| `capturer` | `ScreenshotCapturer` | DOM capturer | Custom screenshot implementation. |
| `client` | `FeedbackClient` | HTTP client + IndexedDB outbox | Custom submission client. |
| `metadata` | `() => BrowserMetadata` | built-in collector | Override the collected browser metadata. |
| `onSubmitted` | `(result) => void` | – | Called after Notion confirms the page, with `{ submissionId, pageId, pageUrl }`. |
| `onError` | `(error) => void` | – | Capture or submit failures. |
| `hidden` | `boolean` | `false` | Hide the floating button. You can still open the widget with `useFeedback().open()` or the hotkey. |
| `locale` | `LocaleBundle \| LocaleBundle[]` | English | Widget language. One bundle is always used; with an array the best match for the page is picked. See [Internationalization](#internationalization). |
| `messages` | `LocaleOverrides` | – | Replace individual texts of the active language, e.g. `{ widget: { "dialog.title": "Report a problem" } }`. Keys are type-checked. |

`useFeedback()` returns `{ open(), close(), isOpen, pendingCount, retryPending() }`.

### Custom categories

The form offers five built-in categories: `bug`, `design`, `content`, `feature` and `other`. To use your own, declare the list once in a shared file and pass it to both the widget and the route handler, because the server only accepts the categories it was configured with.

**`feedback.config.ts`**

```ts
import { defineCategories } from "pinpoint-feedback";

export const categories = defineCategories([
  "bug", // built-in categories can be listed by id
  { id: "perf", label: "Performance", color: "orange", emoji: "⚡" },
  { id: "a11y", label: "Accessibility", color: "blue" },
  "feature",
]);
```

Import `defineCategories` from the root `"pinpoint-feedback"` entry, not from `pinpoint-feedback/nextjs`. The `nextjs` and `react` entries are `"use client"` modules, so their exports become client references that can't be called in Server Components or route handlers. The root entry has no client boundary and works in both.

**`app/layout.tsx`**

```tsx
import { FeedbackProvider } from "pinpoint-feedback/nextjs";
import { categories } from "../feedback.config";

// ...
<FeedbackProvider position="bottom-right" theme="light" categories={categories} defaultCategory="bug" />
```

**`app/api/feedback/route.ts`**

```ts
import { createFeedbackHandler } from "pinpoint-feedback/nextjs/server";
import { categories } from "../../../feedback.config";

export const runtime = "nodejs";

export const POST = createFeedbackHandler({ categories });
```

Each entry is either a built-in id or a definition:

| Field | Description |
| --- | --- |
| `id` | Sent with the report and checked by the server. Letters, digits, `-` and `_`, up to 50 characters, unique within the list. **Keep ids stable**: queued reports that are retried later carry the id they were created with, and the server rejects ids it no longer knows. |
| `label` | Shown in the widget and stored in Notion as the `Category` select option name. 1–100 characters and no commas, since Notion select option names can't contain them. Renaming a label creates a new option in Notion; existing pages keep the old one. |
| `color` | Optional Notion select color (`default`, `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`). Used when the option is created, and as a small dot next to the label in the widget. |
| `emoji` | Optional icon for the summary callout on the Notion page. |

**Type safety.** `FeedbackProvider` and `FeedbackWidget` infer the ids of the list you pass, whether it comes from `defineCategories` or is written inline, so `defaultCategory` must be one of them:

```tsx
<FeedbackProvider categories={[{ id: "perf", label: "Performance" }, "bug"]} defaultCategory="perf" /> // ok
<FeedbackProvider categories={[{ id: "perf", label: "Performance" }, "bug"]} defaultCategory="design" /> // type error
```

`CategoryId<typeof categories>` gives you the id union for your own code. `defineCategories` also validates the list when the module loads, so a bad config fails fast during `next build`.

**Notion.** With `autoSetupSchema` on, options for your categories are added to the `Category` select on first use, with their colors. Existing options are left alone.

**In the widget.** Up to six categories are shown as buttons; longer lists use a dropdown. With a single category the field is hidden and that category is always sent. If the `categories` prop is invalid at runtime (for example a duplicate id), the widget logs an error to the console and falls back to the built-in categories instead of breaking your page. If `defaultCategory` isn't in the list, the first category is preselected.

### Internationalization

The widget, the annotation editor's screen-reader announcements, the labels drawn into screenshots for content that couldn't be captured, and the Notion report can all be localized. English is built in and used by default.

**Built-in languages:** English (`en`). <!-- locales:list -->

Each language is a separate entry point, `pinpoint-feedback/locales/<tag>`, so your bundle only contains the languages you import. A bundle is plain data (no functions), which means a Server Component can import it and pass it to the client widget as a prop.

**One language.** Pass the bundle; it is always used:

```tsx
// app/layout.tsx (Server Component)
import { FeedbackProvider } from "pinpoint-feedback/nextjs";
import de from "pinpoint-feedback/locales/de";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        {children}
        <FeedbackProvider locale={de} />
      </body>
    </html>
  );
}
```

**Automatic choice.** Pass several bundles and the widget picks the best match for the page: first `<html lang>`, then the browser's languages (`navigator.languages`). Regional tags fall back to the language (`de-AT` → `de`, `pt` → `pt-BR`), and English is always available as the final fallback, whether or not you include it.

```tsx
import de from "pinpoint-feedback/locales/de";
import fr from "pinpoint-feedback/locales/fr";

<FeedbackProvider locale={[de, fr]} />
```

Because `<html lang>` comes first, a page marked `lang="en"` gets the English widget even for visitors whose browser prefers German. That keeps the widget in the same language as the page. If your site serves several languages, set `<html lang>` per request (the [example app](examples/nextjs-app) reads `?lang=` and `Accept-Language` in its root layout) or pass the matching single bundle.

**Changing individual texts.** `messages` overrides any text of the active language. Keys are type-checked, so typos fail the build:

```tsx
<FeedbackProvider
  locale={de}
  messages={{
    widget: { "launcher.label": "Hilfe", "dialog.title": "Problem melden" },
    editor: { "pin.added": "Markierung {number} gesetzt" },
  }}
/>
```

Placeholders such as `{number}` must be kept. Countable texts are plural objects using [CLDR plural categories](https://cldr.unicode.org/index/cldr-spec/plural-rules) and `#` for the number, e.g. `{ one: "# unsent report", other: "# unsent reports" }`. Numbers, percentages and lists are formatted with `Intl` for the active language. Keyboard shortcut labels (⌘, Ctrl, Esc) are not translated. The full list of keys and their English texts is in [`packages/core/src/i18n`](packages/core/src/i18n).

**Your own language.** Build a complete bundle with `defineLocale` from the root entry (it type-checks that every key is present) and pass it like a built-in one. Starting from an existing bundle is the easiest way:

```ts
// locales/sv.ts
import { defineLocale } from "pinpoint-feedback";
import en from "pinpoint-feedback/locales/en";

export const sv = defineLocale({
  ...en,
  locale: "sv",
  dir: "ltr",
  widget: { ...en.widget, "launcher.label": "Återkoppling", "dialog.title": "Skicka återkoppling" /* … */ },
  editor: { ...en.editor /* … */ },
  capture: { ...en.capture /* … */ },
  report: { ...en.report /* … */ },
});
```

To add a language to the package itself, add `packages/core/src/locales/<tag>.ts` following [`en.ts`](packages/core/src/locales/en.ts) and the other files there; the build picks up every file in that folder. Translations are plain TypeScript objects, so native speakers can review and improve them in an ordinary pull request.

**Category labels.** Category `label`s are what Notion stores, so they stay the same in every language. Give the widget translated labels with `labels`, keyed by language tag (the exact tag wins, then the language):

```ts
defineCategories([
  "bug",
  { id: "perf", label: "Performance", labels: { de: "Leistung", fr: "Performances", "pt-BR": "Desempenho" } },
]);
```

Built-in categories (`"bug"`, `"design"`, …) are translated by the locale bundle as long as you keep their default label. Priority names are translated in the widget, while Notion keeps its fixed `Low` … `Critical` options.

**Right-to-left languages.** Bundles declare `dir` (`"rtl"` for Arabic, for example). The widget sets `lang` and `dir` on its own root inside the Shadow DOM and mirrors its layout: the form moves to the left of the screenshot, toolbar order and paddings flip, and directional icons such as undo/redo are mirrored. The screenshot and the annotations on it are never mirrored, and the floating button stays in the page corner you chose with `position`, because that refers to the viewport, not to reading direction.

<a id="notion-report-language"></a>**Notion report language.** The Notion page body is written by the server, so its language is set on the handler with `locale` and is independent of the widget's language. Database property names and select options are not translated, so filters and views keep working across languages.

```ts
// app/api/feedback/route.ts
import { createFeedbackHandler } from "pinpoint-feedback/nextjs/server";
import de from "pinpoint-feedback/locales/de";

export const POST = createFeedbackHandler({ categories, locale: de });
```

Capture warnings are sent as codes with counts and rendered in the report's language.

### Server handler options

You can pass these to `createFeedbackHandler()` from `pinpoint-feedback/nextjs/server` or to `createFeedbackRequestHandler()` from `pinpoint-feedback/server`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `notion.apiKey` | `string` | `NOTION_API_KEY` | Integration secret. |
| `notion.databaseId` | `string` | `NOTION_FEEDBACK_DATABASE_ID` | Target database ID or URL. |
| `notion.baseUrl` | `string` | `NOTION_API_BASE_URL` or Notion | API origin override. |
| `notion.properties` | `Partial<NotionPropertyNames>` | see below | Rename the Notion properties that each field is written to, e.g. `{ websiteUrl: "URL" }`. |
| `notion.autoSetupSchema` | `boolean` | `true` | Add missing properties to the database on first use. |
| `notion.statusDefault` | `string` | `"New"` | Status given to new reports. |
| `notion.descriptionPropertyMaxChars` | `number` | `2000` | Characters of the description kept in the `Description` property. The page body always contains the full text. |
| `notion.timeoutMs` / `retry` / `throttle` | – | 30 s / 3 retries / 3 req/s | Notion request timeout, retries with backoff, and client-side throttling to stay under Notion's rate limit. |
| `backend` | `FeedbackBackend` | Notion backend | Replace the persistence layer, for example in tests. |
| `categories` | `CategoryList` | the five built-ins | Accepted categories; submissions with any other category get a `400`. Use the same list as the widget. Missing options are added to the Notion `Category` select. |
| `projectId` | `string` | `PINPOINT_PROJECT_ID` | Default project for reports that don't send one. |
| `allowedOrigins` | `string[] \| "*"` | same-origin only | Origins that may submit. Also enables CORS responses for them. |
| `rateLimit` | `{ max, windowMs } \| false` | 10 per 10 min per IP | In-memory, per-process rate limiting. |
| `minFillTimeMs` | `number` | `1500` | Reject submissions sent sooner than this after the widget opened. `0` disables the check. |
| `trustProxy` / `getClientIp` | `boolean` / `(req) => string` | `true` | How the client IP for rate limiting is found. When trusted, the first hop of `X-Forwarded-For` (or `X-Real-IP`) is used, which suits Vercel, Netlify, Cloudflare and most reverse proxies. **Set `trustProxy: false` if the app is exposed directly without a trusted proxy**, because clients could otherwise spoof the header. |
| `onSubmission` | `(submission, record) => void` | – | Hook called after a new Notion page is created, for example to notify Slack. |
| `maxFileBytes` | `number` | 5 MB | Maximum size for each screenshot. Notion's single-part upload limit is 5 MB on free workspaces and 20 MB on paid ones. |
| `logger` | `{ info, warn, error }` | `console` | Where server-side diagnostics go. Secrets are never logged. |
| `locale` | `LocaleBundle` | English | Language of the Notion page body (headings, metadata labels, capture warnings). See [Notion report language](#notion-report-language). |

`createFeedbackHandler` also accepts `env` (an object to read the variables from instead of `process.env`).

### Notion database properties

With `autoSetupSchema` on, any of these that don't exist yet are created. You can use other names through `notion.properties`.

| Property | Type | Content | `properties` key |
| --- | --- | --- | --- |
| `Title` (the title column) | Title | Report title | `title` |
| `Description` | Text | First 2000 characters of the description | `description` |
| `Status` | Select (or Status) | `New`, `In progress`, `Resolved`, `Won't fix` | `status` |
| `Category` | Select | Category label: `Bug`, `Design`, `Content`, `Feature request`, `Other`, or your [custom categories](#custom-categories) | `category` |
| `Priority` | Select | `Low`, `Medium`, `High`, `Critical` | `priority` |
| `Website URL` | URL | Where the report was made | `websiteUrl` |
| `Page Title` | Text | `document.title` of that page | `pageTitle` |
| `Screenshot` | Files & media | Original screenshot | `screenshot` |
| `Annotated Screenshot` | Files & media | Screenshot with annotations | `annotatedScreenshot` |
| `Reporter Name` | Text | Name, if given | `reporterName` |
| `Reporter Email` | Email | Email, if given | `reporterEmail` |
| `Browser` | Text | e.g. `Chrome 142` | `browser` |
| `Operating System` | Text | e.g. `macOS 15.1` | `os` |
| `Viewport` | Text | e.g. `1440×900 @2x` | `viewport` |
| `Created` | Date | Time of the first submit attempt | `created` |
| `Project` | Text (or Select) | `projectId` | `project` |
| `Submission ID` | Text | Client-generated UUID, used for idempotency | `submissionId` |

Existing properties with a compatible type are reused, so you can switch `Category` to a select with your own colours, or `Status` to a Notion Status property. Properties with an incompatible type are skipped and a warning is logged. Select options that don't exist yet are created by Notion automatically.

Each screenshot is uploaded to Notion once, and the same file upload is used for both the files property and the image block in the page body.

The page body contains the description, the annotated screenshot, a list of pin notes, the full technical metadata, and any capture warnings.

## How screenshots work

By default, the widget **rasterises the DOM**. It clones the visible part of the page, inlines computed styles, fonts and same-origin images, and paints the result into a canvas at your device pixel ratio (up to 2×). The widget itself is excluded. This needs no permission prompt and no browser extension, and it captures exactly what the reporter is looking at, including scroll position.

Some content can't be read by a web page, so DOM rasterisation can't capture it. Nothing is silently dropped: each such region is replaced by a labelled placeholder, and a **capture warning** is shown in the dialog and stored in the Notion page. Expect this for:

- **cross-origin iframes**, such as embedded videos, maps, payment forms and third-party widgets
- **cross-origin images** served without CORS headers, and **tainted canvases**
- **`<video>`** frames, WebGL content that doesn't preserve its drawing buffer, and some web fonts

If DOM capture fails entirely, or when the reporter asks for a pixel-perfect shot, the widget can fall back to **screen capture** via `navigator.mediaDevices.getDisplayMedia`. The browser asks the reporter to choose the current tab, and one frame is taken. This includes cross-origin content but needs the reporter's permission. Very large pages are downscaled to fit the upload limit, which is reported as a `downscaled` warning.

## Security

- **Credentials stay on the server.** The Notion token is read only by the server handler. `pinpoint-feedback/nextjs/server` starts with `import "server-only"`, so accidentally importing it from a Client Component fails the build. The client entry points (`pinpoint-feedback`, `/react`, `/nextjs`) contain no server code.
- **Validation.** The JSON payload is schema-checked. Lengths are capped, enums are enforced, URLs are checked, and annotations are bounded in count and size. Unknown fields are dropped before anything reaches Notion.
- **Uploads.** Only PNG, JPEG and WebP are accepted. The file's magic bytes must match its declared type, and each file is limited by `maxFileBytes`. The total request size is capped as well.
- **Abuse protection.** Requests are rate-limited per client IP (behind a proxy, from `X-Forwarded-For`; set `trustProxy: false` when there is no trusted proxy in front of the app). A hidden honeypot field and a minimum fill time reject simple bots. With `allowedOrigins`, the `Origin` header is enforced; otherwise only same-origin requests are accepted.
- **Error hygiene.** Clients receive a stable error code and a safe message. Notion error details and stack traces are only sent to the server logger.

## Reliability

- **Submission IDs.** The browser generates a UUID for each report and sends it with every attempt. The server checks an in-process cache and in-flight requests, then queries the database's `Submission ID` property before creating a page. It checks again before retrying a failed page creation. A retry after a lost response therefore returns the existing page (`duplicate: true`) instead of creating a second one.
- **Outbox.** Before the first request, the report and both images are written to IndexedDB, with an in-memory fallback. They're removed only after the server confirms the Notion page. If the tab is closed or the network drops, pending reports are retried on the next page load and when the browser comes back online.
- **Retries.** On the server, transient Notion errors (`429`, `5xx`, timeouts) are retried with exponential backoff, honouring `Retry-After`, and Notion requests are throttled to Notion's documented average rate. In the browser, network errors, timeouts, `429` and `5xx` responses are retried up to 3 times with backoff and jitter. Validation errors aren't retried.
- **Honest UI.** The success state appears only after Notion has confirmed the page. On failure, the dialog keeps everything the reporter typed and drew, explains what happened, and offers **Retry**.

## Architecture

```
pinpoint-feedback                  umbrella package you install (thin re-exports)
├─ .            → @pinpoint-feedback/core     browser-safe, framework-free
├─ ./core       → @pinpoint-feedback/core
├─ ./react      → @pinpoint-feedback/react    "use client"
├─ ./nextjs     → @pinpoint-feedback/nextjs   "use client"
├─ ./server     → @pinpoint-feedback/server   Node / Edge / Workers / Bun / Deno
├─ ./nextjs/server → @pinpoint-feedback/nextjs/server   server-only
└─ ./locales/<tag> → @pinpoint-feedback/core/locales/<tag>   one language bundle each (plain data)

@pinpoint-feedback/core      types · validation · DOM & display-media capturers ·
                              annotation editor (canvas) · HTTP transport · IndexedDB outbox
@pinpoint-feedback/react     FeedbackProvider / FeedbackWidget / useFeedback (Shadow DOM UI)
@pinpoint-feedback/server    createFeedbackRequestHandler (Request → Response) ·
                              NotionFeedbackBackend · Notion file uploads · rate limiter
@pinpoint-feedback/nextjs    Next.js defaults + lazy env-based handler
```

Each moving part sits behind a small interface (`ScreenshotCapturer`, `AnnotationRenderer`, `FeedbackTransport`, `FeedbackOutbox`, `FeedbackBackend`, `FileUploader`), so you can swap any of them out. See [docs/architecture.md](docs/architecture.md).

## Other frameworks

### Any server: `pinpoint-feedback/server`

The handler is a standard `(request: Request) => Promise<Response>`. It works anywhere you can get a Web `Request`, such as Remix/React Router actions, Hono, SvelteKit, Astro, Bun, Deno and Cloudflare Workers:

```ts
import { createFeedbackRequestHandler, resolveNotionConfigFromEnv } from "pinpoint-feedback/server";

const handleFeedback = createFeedbackRequestHandler({
  notion: resolveNotionConfigFromEnv(process.env),
});

// Hono
app.post("/api/feedback", (c) => handleFeedback(c.req.raw));

// React Router / Remix
export const action = ({ request }: { request: Request }) => handleFeedback(request);

// Bun
Bun.serve({ fetch: (req) => (new URL(req.url).pathname === "/api/feedback" ? handleFeedback(req) : new Response("Not found", { status: 404 })) });
```

For Express or another Node-style server, convert the incoming message to a `Request` (for example with `@whatwg-node/server` or `@remix-run/node-fetch-server`).

### React without Next.js: `pinpoint-feedback/react`

```tsx
import { FeedbackProvider } from "pinpoint-feedback/react";

<FeedbackProvider endpoint="https://api.example.com/feedback" theme="system" />;
```

### No framework: `pinpoint-feedback` (core)

The core package has no UI framework dependency. You can build your own UI around the capturer, the annotation editor and the client:

```ts
import {
  createAnnotationEditor,
  createDefaultCapturer,
  createFeedbackClient,
  collectBrowserMetadata,
  createId,
  PINPOINT_IGNORE_ATTRIBUTE,
} from "pinpoint-feedback";

// Elements with the data-pinpoint-ignore attribute (e.g. your feedback UI) are left out of the screenshot.
document.querySelector("#my-feedback-ui")!.setAttribute(PINPOINT_IGNORE_ATTRIBUTE, "");
const shot = await createDefaultCapturer().capture();

const editor = createAnnotationEditor({
  container: document.querySelector<HTMLElement>("#editor")!,
  image: shot.blob,
  tool: "pin",
});
await editor.ready;
// Wire up your toolbar: editor.setTool("rectangle"), editor.undo(), editor.zoomIn(), editor.reset() ...

const client = createFeedbackClient({ endpoint: "/api/feedback" });
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
  },
  { screenshot: shot.blob, annotatedScreenshot: await editor.exportAnnotated() },
);

if (result.ok) console.log("Created", result.pageUrl);
else console.error(result.error.code, result.error.message);
```

`DomScreenshotCapturer` and `DisplayMediaScreenshotCapturer` can also be constructed directly.

## Development

```bash
npm install          # install workspace dependencies
npm run build        # build core → server → react → nextjs → pinpoint-feedback
npm test             # unit tests (Vitest; projects: core, server, react, nextjs)
npm run typecheck    # TypeScript across all packages

# end-to-end: Next.js example app + mock Notion API + Playwright (Chromium)
npx playwright install chromium   # once
npm run build
npm run e2e -w pinpoint-feedback-example-nextjs
```

The e2e suite starts `examples/nextjs-app/mock-notion/server.mjs`, a dependency-free mock of the Notion endpoints the backend uses, on port 3999. It also builds and starts the example app on port 3100 with `NOTION_API_BASE_URL` pointing at the mock. To try the example against a real workspace, copy `examples/nextjs-app/.env.example` to `.env.local`, fill it in, and run `npm run dev -w pinpoint-feedback-example-nextjs`.

## License

[MIT](LICENSE)
