# Development

## Setup

The repo is an npm workspaces monorepo:

| Workspace | Package |
| --- | --- |
| `packages/core` | `@pinpoint-feedback/core` |
| `packages/server` | `@pinpoint-feedback/server` |
| `packages/react` | `@pinpoint-feedback/react` |
| `packages/nextjs` | `@pinpoint-feedback/nextjs` |
| `packages/pinpoint-feedback` | `pinpoint-feedback` (umbrella) |
| `examples/nextjs-app` | `pinpoint-feedback-example-nextjs` (private) |

```bash
npm install
```

Use Node 20 or newer (the server package targets `node20`; CI runs the current LTS). Package internals are described in [architecture](architecture.md).

## Commands

| Command | Does |
| --- | --- |
| `npm run build` | Builds core → server → react → nextjs → pinpoint-feedback, in that order |
| `npm test` | All Vitest projects, once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Vitest with V8 coverage and enforced thresholds |
| `npm run typecheck` | `tsc --noEmit` over `packages/*/src`, `packages/*/test` and `vitest.config.ts` |
| `npm run e2e` | Playwright suite of the example app (needs `npm run build` first) |

Vitest and `tsc` resolve `@pinpoint-feedback/*` to each package's `src/` through aliases (`vitest.config.ts`) and `paths` (`tsconfig.json`), so unit tests and type checks don't need a build. The example app and e2e consume the built `dist/` output through the workspace symlinks, so they do.

## Build

Each package builds with `vite build && tsc -p tsconfig.build.json`: Vite in library mode produces ES modules, `tsc` emits only the declarations.

| Package | Vite setup |
| --- | --- |
| core | Entries `index` plus one `locales/<tag>` per file in `src/locales/`; shared code goes to `dist/chunks/`; `modern-screenshot` is external |
| server | `ssr` build targeting `node20`; `@notionhq/*`, `@pinpoint-feedback/*` and `node:*` external |
| react | React and Tailwind Vite plugins, single CSS bundle; react, react-dom and core external; `"use client"` banner on every chunk |
| nextjs | Entries `index` and `server`, unminified; all bare imports external; `"use client"` banner only on the `index` entry |

`packages/pinpoint-feedback/scripts/build.mjs` builds the umbrella from the other packages' `dist/`:

- writes `dist/{index,core,server,nextjs-server}.js` as `export * from …`;
- writes `dist/react.js` and `dist/nextjs.js` as `"use client"` modules with explicit `export { … }` lists collected from the built packages (why: [architecture](architecture.md#serverclient-boundary));
- writes `dist/locales/<tag>.js` / `.d.ts` for every locale in `core/dist/locales/`;
- copies the root `README.md` and `LICENSE` into the package (both are git-ignored there).

It fails if a dependency hasn't been built, which is why the root `build` script runs the packages in order.

## Unit tests

Vitest projects, defined in `vitest.config.ts`:

| Project | Root | Environment | Files |
| --- | --- | --- | --- |
| `core` | `packages/core` | happy-dom | `test/**/*.test.ts` |
| `server` | `packages/server` | node | `test/**/*.test.ts` |
| `react` | `packages/react` | happy-dom | `test/**/*.test.{ts,tsx}` |
| `nextjs` | `packages/nextjs` | node | `test/**/*.test.{ts,tsx}` |
| `scripts` | `scripts` | node | `**/*.test.mjs` (tests for `ci-report.mjs`) |

Run one project with `npx vitest run --project core`. `packages/nextjs/test/build.test.ts` inspects `packages/nextjs/dist` and is skipped when that hasn't been built.

Coverage uses the V8 provider over `packages/*/src/**/*.{ts,tsx}`, excluding declaration files, package `index.ts` barrels, `core/src/types.ts`, `core/src/interfaces.ts`, `core/src/locales/**` and `react/src/types.ts`. Reports (`text-summary`, `lcov`, `json-summary`) go to `coverage/`. Thresholds, enforced by `npm run test:coverage`:

| Metric | Minimum |
| --- | --- |
| Statements | 80% |
| Branches | 70% |
| Functions | 80% |
| Lines | 80% |

## Example app

`examples/nextjs-app` is a Next.js App Router app wired like the [getting started](getting-started.md) guide, with shared categories in `feedback.config.ts`, locales in `locales.ts`, and a `proxy.ts` that forwards `?lang=` to the root layout.

Against a real Notion workspace:

```bash
cp examples/nextjs-app/.env.example examples/nextjs-app/.env.local   # fill in NOTION_API_KEY, NOTION_FEEDBACK_DATABASE_ID
npm run build
npm run dev -w pinpoint-feedback-example-nextjs                      # http://localhost:3100
```

Against the mock Notion server instead:

```bash
npm run mock-notion -w pinpoint-feedback-example-nextjs              # http://127.0.0.1:3999
```

and set `NOTION_API_BASE_URL=http://127.0.0.1:3999`, `NOTION_API_KEY=secret_test`, `NOTION_FEEDBACK_DATABASE_ID=0123456789abcdef0123456789abcdef` in `.env.local` (the mock's defaults).

Rebuild the packages after changing them; the app imports `pinpoint-feedback` from `dist/`.

## End-to-end tests

Playwright specs live in `examples/nextjs-app/e2e` (`feedback.spec.ts`, `i18n.spec.ts`) and run the real app against the mock Notion server.

```bash
npx playwright install chromium   # once
npm run build
npm run e2e
```

`playwright.config.ts` starts two web servers:

| Server | Command | Address |
| --- | --- | --- |
| Mock Notion | `node mock-notion/server.mjs` | `127.0.0.1:3999` (waits for `/__mock/health`) |
| Example app | `next build && next start -p $PORT`, or `next dev -p $PORT` when `E2E_DEV` is set | `127.0.0.1:$E2E_APP_PORT` (default `3100`) |

The app gets `NOTION_API_KEY=secret_test`, the mock database ID and `NOTION_API_BASE_URL` pointing at the mock. Outside CI, already running servers are reused. Tests run in Chromium (1280×800), one worker, with one retry on CI; traces and screenshots are kept for failures.

`mock-notion/server.mjs` is a dependency-free mock of the Notion API subset the backend uses (database and data source retrieve/update/query, page create, block append, file upload create/send). Test control endpoints:

| Endpoint | Description |
| --- | --- |
| `GET /__mock/health` | Readiness check |
| `GET /__mock/pages` | Created pages, with plain property values and children |
| `GET /__mock/uploads` | File uploads: metadata, size, leading bytes |
| `GET /__mock/schema` | Current data source properties, including select options with ids and colors |
| `GET /__mock/requests` | Request log |
| `POST /__mock/fail` | `{ status?, code?, times?, method?, path? }`: make matching requests fail (default: every `POST /v1/pages`; `path` may end in `*`) |
| `DELETE /__mock/fail` | Stop failing |
| `POST /__mock/reset` | Clear pages, uploads, requests and failures; `{ schema: true }` also resets properties |

The mock reads `MOCK_NOTION_PORT`, `MOCK_NOTION_HOST`, `MOCK_NOTION_TOKEN` and `MOCK_NOTION_DATABASE_ID`.

## CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main` (one job, Ubuntu, Node LTS, superseded runs cancelled):

1. `npm ci`, `npm run typecheck`, `npm run build`
2. `npm run test:coverage` with JSON results
3. Install Chromium (cached by Playwright version) and run Playwright in `examples/nextjs-app` with JSON and HTML reporters. This runs even if unit tests failed, but not if an earlier step failed.
4. On PRs: download the `coverage-summary` artifact of the latest successful `main` run as the baseline, and list the PR's changed files.
5. `scripts/ci-report.mjs` writes a Markdown report: unit and e2e results (failures listed), total coverage with deltas against the baseline, and coverage of changed source files, flagging anything under 80%. It goes to the job summary and, for PRs from this repository (not forks), into a single sticky PR comment that is updated on each run.

Artifacts:

| Name | When | Contents |
| --- | --- | --- |
| `coverage` | Always | `lcov.info`, `coverage-summary.json` |
| `coverage-summary` | Pushes to `main` | `coverage-summary.json` (the baseline for PRs) |
| `playwright-report` | On failure | Playwright `test-results/` and `playwright-report/`, kept 7 days |

## Adding a translation

Add `packages/core/src/locales/<tag>.ts` built with `defineLocale`, exporting the bundle both by name and as default; the build picks it up automatically. See [i18n](i18n.md) for the message catalogs and conventions.

## Releasing

Nothing is automated; there is no release workflow. The current state:

- All five packages are at `0.1.0`. Internal dependencies are pinned to exact versions (`"@pinpoint-feedback/core": "0.1.0"`), so bump every package and every internal dependency range together.
- Each package publishes only `dist/` (the umbrella also `README.md`), so build first: `npm run build`.
- Publish dependencies before dependents: core → server → react → nextjs → pinpoint-feedback, e.g. `npm publish -w @pinpoint-feedback/core`. Scoped packages need `--access public` on their first publish.
- The umbrella's `README.md` is the root README copied at build time. Its relative links (`docs/…`, `examples/…`) don't resolve on npmjs.com.
