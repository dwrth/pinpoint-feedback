# Categories

Every report has one category. The widget offers a list of categories, the server accepts only the ids in its own list, and Notion stores the category's label in the `Category` property.

## Built-in categories

Used when you pass nothing:

| id | label | color | emoji |
| --- | --- | --- | --- |
| `bug` | Bug | `red` | 🐞 |
| `design` | Design | `purple` | 🎨 |
| `content` | Content | `blue` | 📝 |
| `feature` | Feature request | `green` | ✨ |
| `other` | Other | `gray` | 💬 |

Built-in labels are translated in the widget by the active [locale](i18n.md) as long as you keep their default label.

## Defining your own

Declare the list once with `defineCategories` and share it between the widget and the route handler.

**`feedback.config.ts`**

```ts
import { defineCategories } from "pinpoint-feedback";

export const categories = defineCategories([
  "bug", // built-ins can be listed by id
  { id: "perf", label: "Performance", color: "orange", emoji: "⚡" },
  { id: "a11y", label: "Accessibility", color: "blue" },
  "feature",
]);
```

**`app/layout.tsx`**

```tsx
import { FeedbackProvider } from "pinpoint-feedback/nextjs";
import { categories } from "../feedback.config";

<FeedbackProvider categories={categories} defaultCategory="bug" />
```

**`app/api/feedback/route.ts`**

```ts
import { createFeedbackHandler } from "pinpoint-feedback/nextjs/server";
import { categories } from "../../../feedback.config";

export const runtime = "nodejs";
export const POST = createFeedbackHandler({ categories });
```

The server must get the same list. A submission whose category id is not in the handler's list is rejected with `400 validation`.

Import `defineCategories` from the root `"pinpoint-feedback"` entry. `pinpoint-feedback/nextjs` and `/react` are `"use client"` modules whose exports cannot be called in Server Components or route handlers; the root entry works on both sides. See [Widget → Next.js](widget.md#nextjs).

`defineCategories` returns its argument unchanged, validates it immediately (so a bad list fails at module load, e.g. during `next build`) and keeps the literal id types.

## Entry fields

An entry is either a built-in id (`"bug"`, `"design"`, `"content"`, `"feature"`, `"other"`) or a definition:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | yes | Sent with the report and checked by the server. |
| `label` | `string` | yes | Shown in the widget and stored as the Notion `Category` option name. Trimmed before use. |
| `color` | `CategoryColor` | no | Notion select color: `default`, `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`. Used when the option is created, and as a dot next to the label in the widget. |
| `emoji` | `string` | no | Icon of the summary callout on the Notion page. A default icon is used when omitted. |
| `labels` | `Record<string, string>` | no | Widget labels per language tag, e.g. `{ de: "Leistung" }`. See [i18n](i18n.md#category-labels). |

## Validation rules

Checked by `defineCategories`, the widget and the server handler:

| Rule | Limit |
| --- | --- |
| List | Non-empty array, at most 50 entries. |
| `id` | Matches `/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/`: starts with a letter or digit, then letters, digits, `-`, `_`; 1–50 characters. |
| `id` uniqueness | No duplicates within the list (a built-in listed by id counts with its id). |
| `label` | 1–100 characters after trimming, no commas (Notion select option names cannot contain commas). |
| String entries | Must be a built-in id; anything else needs `{ id, label }`. |

Violations throw `CategoryConfigError`. Where it surfaces:

| Place | Behaviour |
| --- | --- |
| `defineCategories` | Throws at module load. |
| Widget `categories` prop | Logs an error to the console and falls back to the built-in categories instead of breaking the page. The server may then reject submissions if its list differs. |
| `createFeedbackRequestHandler` | Throws when the handler is created. |
| `createFeedbackHandler` (Next.js) | Logs the error and answers `500 misconfigured`. |

**Keep ids stable.** Reports queued in the outbox are retried with the id they were created with; the server rejects ids it no longer knows.

## Type safety

`FeedbackProvider` and `FeedbackWidget` infer the ids of the list you pass, whether from `defineCategories` or inline, so `defaultCategory` must be one of them:

```tsx
<FeedbackProvider categories={[{ id: "perf", label: "Performance" }, "bug"]} defaultCategory="perf" />   // ok
<FeedbackProvider categories={[{ id: "perf", label: "Performance" }, "bug"]} defaultCategory="design" /> // type error
```

Use `CategoryId<typeof categories>` for the id union in your own code:

```ts
import type { CategoryId } from "pinpoint-feedback";
import { categories } from "./feedback.config";

type Category = CategoryId<typeof categories>; // "bug" | "perf" | "a11y" | "feature"
```

Related types exported from `pinpoint-feedback` (and as types from `/react` and `/nextjs`): `CategoryDefinition`, `CategoryInput`, `CategoryList`, `CategoryColor`, `CategoryId`. `DEFAULT_CATEGORIES` and `resolveCategories` are exported from the root entry.

## In the widget

| Categories | Control |
| --- | --- |
| 1 | Field hidden; that category is always sent. |
| 2–6 | Segmented buttons. |
| 7+ | Native `<select>`. |

The first category is preselected unless `defaultCategory` names another one in the list.

## In Notion

- The `Category` property stores the category's `label`, never the id and never a translated label.
- With `notion.autoSetupSchema` on (the default), options for your categories are added to the `Category` select (or multi-select) on first use, with their colors. Existing options are left untouched.
- **Renaming a label creates a new option.** Existing pages keep the old one.
- If `Category` is a Notion **Status** property, missing options cannot be added through the API. The server logs a warning and reports in those categories are saved without a category; add the options in Notion or use a select property.
- The page body's summary callout uses the category's `emoji` and, when `labels` has an entry for the report language, the translated label.

See [Notion](notion.md) for the full schema.
