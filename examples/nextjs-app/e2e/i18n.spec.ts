import { expect, test } from "@playwright/test";
import type { LocaleBundle } from "pinpoint-feedback";
import { locales, messageOverrides } from "../locales";

type WidgetKey = keyof LocaleBundle["widget"];

function text(bundle: LocaleBundle, key: WidgetKey): string {
  const override = messageOverrides[bundle.locale]?.widget?.[key];
  const message = typeof override === "string" ? override : bundle.widget[key];
  if (typeof message !== "string") throw new Error(`${key} is not a plain string`);
  return message;
}

for (const bundle of locales) {
  test(`?lang=${bundle.locale} sets the widget language, direction and message overrides`, async ({ page }) => {
    await page.goto(`/?lang=${bundle.locale}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("lang", bundle.locale);

    const root = page.locator("[data-pinpoint-feedback] .pp-root");
    await expect(root).toHaveAttribute("lang", bundle.locale);
    await expect(root).toHaveAttribute("dir", bundle.dir);

    await page.getByRole("button", { name: text(bundle, "launcher.label"), exact: true }).click();
    const dialog = page.getByRole("dialog", { name: text(bundle, "dialog.title") });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: new RegExp(`^${text(bundle, "field.title")}`) })).toHaveAttribute(
      "placeholder",
      text(bundle, "field.titlePlaceholder"),
    );
    await expect(dialog.getByRole("toolbar", { name: text(bundle, "toolbar.label") })).toBeVisible();
  });
}

test("the English demo override replaces the built-in title placeholder", async ({ page }) => {
  await page.goto("/?lang=en", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  const title = page.getByRole("dialog", { name: "Send feedback" }).getByRole("textbox", { name: /^Title/ });
  await expect(title).toHaveAttribute("placeholder", "e.g. The revenue chart legend overlaps the data");
});

test("falls back to English for unsupported languages", async ({ page }) => {
  await page.goto("/?lang=tlh", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("[data-pinpoint-feedback] .pp-root")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("button", { name: "Feedback", exact: true })).toBeVisible();
});
