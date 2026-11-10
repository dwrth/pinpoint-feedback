import { defineCategories } from "pinpoint-feedback";

/**
 * Shared by the widget (app/layout.tsx) and the route handler (app/api/feedback/route.ts).
 * Imported from the root "pinpoint-feedback" entry, which has no "use client" boundary,
 * so it can run in both Server Components and route handlers.
 */
export const categories = defineCategories([
  "bug",
  { id: "perf", label: "Performance", color: "orange", emoji: "⚡" },
  { id: "a11y", label: "Accessibility", color: "blue" },
  "feature",
]);
