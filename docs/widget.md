# Widget

`FeedbackProvider` and `FeedbackWidget` render the floating button, the capture flow and the feedback dialog. Both are exported from `pinpoint-feedback/nextjs` and `pinpoint-feedback/react` and take the same props.

| Component | Use |
| --- | --- |
| `FeedbackProvider` | Renders `children` plus the widget and makes it available to [`useFeedback()`](#usefeedback). `children` are optional. |
| `FeedbackWidget` | The widget on its own. `useFeedback()` does not work with it. |

```tsx
import { FeedbackProvider } from "pinpoint-feedback/nextjs";

<FeedbackProvider position="bottom-right" theme="system" hotkey="mod+shift+f" />
```

## Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `endpoint` | `string` | `"/api/feedback"` | URL of the [server handler](server.md). The `/nextjs` entry falls back to `NEXT_PUBLIC_PINPOINT_ENDPOINT` before the default. |
| `position` | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Page corner of the floating button. Physical, also in RTL languages. |
| `theme` | `"light" \| "dark" \| "system"` | `"system"` | See [Theming](#theming). |
| `accentColor` | `string` (any CSS color) | `#5b5bd6` | Primary buttons, focus rings, selection, active tool. |
| `projectId` | `string` | – | Stored with each report so several sites can share one database. The `/nextjs` entry falls back to `NEXT_PUBLIC_PINPOINT_PROJECT_ID`. The server's `projectId` option overrides it. |
| `reporter` | `{ name?: string; email?: string }` | – | A known reporter, such as the signed-in user. Hides the name/email fields and is sent instead. |
| `collectReporter` | `boolean` | `true` | Show the optional name/email fields. Ignored when `reporter` is set. |
| `buttonLabel` | `string` | locale's `launcher.label` (`"Feedback"`) | Text on the floating button. |
| `hotkey` | `string \| false` | `false` | Shortcut that toggles the widget, e.g. `"mod+shift+f"`. See [Hotkey](#hotkey). |
| `zIndex` | `number` | `2147483000` | Stacking order of the widget's host element. |
| `categories` | `CategoryList` | the five built-ins | Categories offered in the form, in order. Must match the handler's list. See [Categories](categories.md). |
| `defaultCategory` | an id from `categories` | first category | Preselected category. Type-checked against `categories`; an unknown id at runtime falls back to the first. |
| `defaultPriority` | `"low" \| "medium" \| "high" \| "critical"` | `"medium"` | Preselected priority. |
| `capturer` | `ScreenshotCapturer` | DOM capturer | Custom screenshot implementation. See [Screenshots](screenshots.md#custom-capturer). |
| `client` | `FeedbackClient` | HTTP client with IndexedDB outbox, one per `endpoint` | Custom submission client. See [Reliability](reliability.md). |
| `metadata` | `() => BrowserMetadata` | built-in collector | Replaces the collected browser metadata. Called once when a draft is created. |
| `onSubmitted` | `(result: SubmissionSuccess) => void` | – | Called after Notion confirmed the page, with `{ submissionId, pageId, pageUrl, duplicate? }`. |
| `onError` | `(error: FeedbackWidgetError) => void` | – | `{ type: "capture", error }` or `{ type: "submit", error: { code, message, retryable, … } }`. Not called when the reporter cancels a capture. |
| `hidden` | `boolean` | `false` | Hide the floating button. The widget still opens via `useFeedback().open()` or `hotkey`. |
| `locale` | `LocaleBundle \| readonly LocaleBundle[]` | English | Widget language. See [Internationalization](i18n.md). |
| `messages` | `LocaleOverrides` | – | Override individual texts of the active language. Keys are type-checked. See [i18n](i18n.md#overriding-texts). |

`FeedbackProvider` additionally accepts `children`.

Props are read on every render; inline `categories`, `locale` and `messages` objects are memoised by content, so passing new array literals each render is fine.

## useFeedback()

```tsx
"use client";
import { useFeedback } from "pinpoint-feedback/nextjs"; // or "pinpoint-feedback/react"

export function ReportBugButton() {
  const feedback = useFeedback();
  return <button onClick={() => feedback.open()}>Report a bug</button>;
}
```

| Member | Type | Description |
| --- | --- | --- |
| `open()` | `() => void` | Captures the page and opens the dialog. No-op while the widget is already open or capturing. |
| `close()` | `() => void` | Closes the widget and discards the draft, without the unsaved-changes prompt. |
| `isOpen` | `boolean` | `true` from the start of a capture until the widget is closed. |
| `pendingCount` | `number` | Reports saved on this device that the server has not confirmed yet. |
| `retryPending()` | `() => Promise<void>` | Re-sends everything in the outbox now. |

`useFeedback()` throws when called outside a `FeedbackProvider`. Before the widget has mounted it returns an inactive controller (`open()` does nothing, `pendingCount` is `0`).

### Programmatic open without a button

Combine `hidden` with `useFeedback()` to use only your own trigger:

```tsx
<FeedbackProvider hidden>
  {children}
</FeedbackProvider>
```

## Theming

| `theme` | Behaviour |
| --- | --- |
| `"light"` | Always light. |
| `"dark"` | Always dark. |
| `"system"` | Follows `prefers-color-scheme` and updates live when it changes. |

`accentColor` sets the `--pp-accent` custom property on the widget root. Text on accent surfaces is always white, so pick an accent dark enough for white text. Nothing else about the styling is configurable from outside; the page's CSS does not reach the widget (see below).

## Shadow DOM isolation

The widget renders into an open shadow root on a host `<div>` appended to `document.body`:

- The host has `all: initial`, `position: fixed` and size 0; `zIndex` is applied to it.
- All widget CSS lives inside the shadow root, so page styles don't leak in and widget styles don't leak out.
- The host carries `data-pinpoint-ignore` and `data-pinpoint-feedback`, so the widget is never part of its own screenshots.
- The root inside the shadow carries `lang`, `dir` and `data-theme` for the active language and theme.

### Excluding elements from screenshots

Add `data-pinpoint-ignore` to any element to leave it and its subtree out of every screenshot, for example a chat bubble or sensitive data:

```html
<div data-pinpoint-ignore>Account balance: …</div>
```

The constant is exported as `PINPOINT_IGNORE_ATTRIBUTE` from `pinpoint-feedback`. DOM capture drops excluded elements from the clone; screen capture hides them (`visibility: hidden`) while the frame is grabbed. See [Screenshots](screenshots.md#excluding-elements).

## Hotkey

`hotkey` is a `+`-separated combination of modifiers and one key, case-insensitive.

| Modifier | Meaning |
| --- | --- |
| `mod` | ⌘ on Apple platforms, Ctrl elsewhere |
| `meta`, `cmd` | ⌘ / Windows key |
| `ctrl`, `control` | Ctrl |
| `shift` | Shift |
| `alt`, `option` | Alt / ⌥ |

Modifiers must match exactly, so `"mod+shift+f"` does not fire on ⌘⇧⌥F. Key repeats are ignored. The shortcut is shown in the button's tooltip and exposed as `aria-keyshortcuts`.

Pressing the hotkey:

| State | Effect |
| --- | --- |
| closed | Captures and opens the dialog. |
| dialog open | Closes it, asking for confirmation if something was typed or drawn. |
| capture error card | Dismisses the card. |

## Keyboard

In the dialog:

| Key | Action |
| --- | --- |
| `Esc` | Close the dialog (with an unsaved-changes prompt if needed), or dismiss the prompt. While editing a text annotation, `Esc` cancels the text instead. |
| `Tab` / `Shift+Tab` | Focus is trapped inside the dialog. |
| `V` `P` `A` `R` `D` `T` | Select, pin, arrow, rectangle, freehand, text tool. Only when focus is in the screenshot area, not in a form field. |
| `Mod+Z` / `Mod+Shift+Z` / `Mod+Y` | Undo / redo. |
| `+` / `-` / `0` | Zoom in / out / fit. |
| `Delete` / `Backspace` | Delete the selected annotation. |
| `Space` + drag | Pan. |

The full editor reference is in [Annotation](annotation.md). Shortcut labels (⌘, Ctrl, Esc) are not translated.

The title field is focused when the dialog opens. After a successful submit the dialog shows a success view and closes itself after 4 seconds; focus returns to the floating button.

## Mobile

- Below the `sm` breakpoint (640 px) the floating button shows only its icon, with a 44 px touch target; the label remains the accessible name.
- The dialog is full screen. The screenshot (56 % of the viewport height) sits above the form and the whole dialog scrolls; the submit footer stays at the bottom.
- From 640 px the dialog is an inset panel with the screenshot and a 360 px form side by side (400 px from 1024 px).
- The toolbar scrolls horizontally when it doesn't fit.
- The editor supports touch drawing, pinch to zoom and larger hit targets for touch input.

## Pending reports

When reports are waiting in the outbox, the floating button shows a count badge and its accessible name includes the number of unsent reports. They are retried on page load and when the browser comes back online. See [Reliability](reliability.md).

## Next.js

`pinpoint-feedback/nextjs` is a `"use client"` module. Its `FeedbackProvider` / `FeedbackWidget` can be rendered directly from a Server Component layout; no wrapper is needed:

```tsx
// app/layout.tsx (Server Component)
import { FeedbackProvider } from "pinpoint-feedback/nextjs";
import de from "pinpoint-feedback/locales/de";
import { categories } from "../feedback.config";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        {children}
        <FeedbackProvider categories={categories} defaultCategory="bug" locale={de} />
      </body>
    </html>
  );
}
```

Differences from `pinpoint-feedback/react`:

- `endpoint` defaults to `NEXT_PUBLIC_PINPOINT_ENDPOINT`, then `"/api/feedback"`.
- `projectId` defaults to `NEXT_PUBLIC_PINPOINT_PROJECT_ID`.

Things to know when rendering from a Server Component:

- **Only serialisable props cross the boundary.** Strings, numbers, booleans, `categories` arrays and locale bundles are fine. Functions and class instances (`onSubmitted`, `onError`, `metadata`, `capturer`, `client`) cannot be passed from a Server Component; render the provider from your own `"use client"` component when you need them.
- **Import `defineCategories` and `defineLocale` from the root `"pinpoint-feedback"` entry**, not from `/nextjs` or `/react`. Those entries are client boundaries: their exports become client references in Server Components and route handlers and cannot be called there. The root entry has no client boundary and works on both sides. `/nextjs` does not export `defineCategories` at all.
- **Import locale bundles from `pinpoint-feedback/locales/<tag>`.** Bundles are plain data with no client boundary, so the layout can import them and pass them as the `locale` prop.
- `useFeedback()` must be called from a Client Component inside the provider's tree, so put the layout's `children` inside `FeedbackProvider` if your components need it.

See also [Frameworks](frameworks.md) for React without Next.js and framework-free usage.
