# Pinpoint Feedback

Visual website feedback that lands in Notion. Visitors click a button, get a screenshot of the page, mark it up with pins, arrows, boxes, freehand and text, and send it. Each report becomes a page in **your Notion database** with the original and annotated screenshots attached. Notion is the only backend.

```
Browser                         Your server route                    Notion
widget → screenshot → annotate ─POST─▶ validate · rate-limit · dedupe ─API─▶ database page
                               ◀─JSON─ upload files · create page    ◀──── + 2 images
```

## Install

```bash
npm install pinpoint-feedback
```

Peer dependencies: `react`/`react-dom` 18.2+ for the widget, `next` 14.2+ for the Next.js entry points.

## Quick start (Next.js App Router)

1. Create a Notion integration, share a database with it and set the env vars ([full walkthrough](docs/getting-started.md)):

   ```env
   NOTION_API_KEY=ntn_...
   NOTION_FEEDBACK_DATABASE_ID=0123456789abcdef0123456789abcdef
   ```

2. Render the widget in `app/layout.tsx` (works from a Server Component):

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

3. Add the endpoint in `app/api/feedback/route.ts`:

   ```ts
   import { createFeedbackHandler } from "pinpoint-feedback/nextjs/server";

   export const runtime = "nodejs";
   export const POST = createFeedbackHandler();
   ```

Missing database columns are created on the first submission. A working app lives in [`examples/nextjs-app`](examples/nextjs-app).

Custom categories and languages are shared between the layout and the route through one config file ([categories](docs/categories.md), [i18n](docs/i18n.md)):

```ts
// feedback.config.ts — import from the root entry so server code can use it
import { defineCategories } from "pinpoint-feedback";
import { de } from "pinpoint-feedback/locales/de";

export const categories = defineCategories(["bug", { id: "perf", label: "Performance", color: "orange" }]);
export const locale = de;
```

```tsx
<FeedbackProvider categories={categories} defaultCategory="perf" locale={locale} />  // layout
export const POST = createFeedbackHandler({ categories, locale });                   // route
```

Built-in languages: English, German, French, Spanish, Italian, Portuguese (Brazil), Dutch, Polish, Japanese, Chinese (Simplified), Arabic (RTL).

## Docs

| Topic | |
| --- | --- |
| [Getting started](docs/getting-started.md) | Notion integration, database, env vars, troubleshooting |
| [Widget](docs/widget.md) | `FeedbackProvider` / `FeedbackWidget` props, `useFeedback`, theming |
| [Server handler](docs/server.md) | Handler options, status codes, CORS, rate limiting, security |
| [Notion](docs/notion.md) | Database properties, schema auto-setup, page layout, file uploads |
| [Categories](docs/categories.md) | `defineCategories`, type-safe ids, Notion select options |
| [Internationalization](docs/i18n.md) | Built-in locales, negotiation, overrides, RTL, report language |
| [Screenshots](docs/screenshots.md) | How capture works, what can't be captured, screen-capture fallback |
| [Annotation editor](docs/annotation.md) | Tools, shortcuts, zoom/pan, data model, standalone usage |
| [Reliability](docs/reliability.md) | Submission IDs, duplicate protection, offline outbox, retries |
| [Other frameworks](docs/frameworks.md) | Web `Request`/`Response` handler, React without Next, vanilla JS |
| [Architecture](docs/architecture.md) | Packages, entry points, DI interfaces, data flow |
| [Development](docs/development.md) | Monorepo, tests, e2e, CI, releasing |

## Entry points

| Import | Use |
| --- | --- |
| `pinpoint-feedback` | Core (framework-free): capture, annotation editor, client, `defineCategories`, `defineLocale` |
| `pinpoint-feedback/nextjs` | `FeedbackProvider`, `FeedbackWidget`, `useFeedback` (client) |
| `pinpoint-feedback/nextjs/server` | `createFeedbackHandler` (server-only) |
| `pinpoint-feedback/react` | Widget for React apps without Next.js |
| `pinpoint-feedback/server` | `createFeedbackRequestHandler` for any Web `Request`/`Response` runtime |
| `pinpoint-feedback/locales/<tag>` | Language bundles, e.g. `locales/de`, `locales/pt-BR` |

The Notion token is only ever read on the server; `pinpoint-feedback/nextjs/server` imports `server-only` so it can't end up in a client bundle.

## Development

```bash
npm install
npm run build          # all packages
npm test               # vitest (core, server, react, nextjs, scripts)
npm run test:coverage  # with enforced coverage thresholds
npm run typecheck
npm run e2e            # Next.js example + mock Notion API + Playwright
```

See [Development](docs/development.md) for the example app, the mock Notion server and CI.

## License

[MIT](LICENSE)
