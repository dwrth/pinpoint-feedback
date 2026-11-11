import { expect, test } from "@playwright/test";

test("unloaded lazy images and uncloneable videos don't stall the capture", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const top = document.createElement("div");
    top.style.cssText = "position:fixed;top:80px;left:16px;display:flex;gap:8px;z-index:5";

    const unloaded = document.createElement("video");
    unloaded.preload = "none";
    unloaded.src = "/does-not-exist.mp4";
    unloaded.width = 160;
    unloaded.height = 90;

    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#4f46e5";
    ctx.fillRect(0, 0, 160, 90);
    const camera = document.createElement("video");
    camera.muted = true;
    camera.autoplay = true;
    camera.width = 160;
    camera.height = 90;
    camera.srcObject = canvas.captureStream(5);

    top.append(unloaded, camera);

    const spacer = document.createElement("div");
    spacer.style.height = "5000px";
    const lazy = document.createElement("img");
    lazy.loading = "lazy";
    lazy.width = 400;
    lazy.height = 300;
    lazy.src = `/dashboard.svg?lazy=${Date.now()}`;
    const offscreenVideo = document.createElement("video");
    offscreenVideo.preload = "none";
    offscreenVideo.src = "/also-missing.mp4";

    document.body.append(top, spacer, lazy, offscreenVideo);
  });
  expect(await page.evaluate(() => document.querySelector<HTMLImageElement>("img[loading=lazy]")!.complete)).toBe(false);

  const start = Date.now();
  await page.getByRole("button", { name: /feedback/i }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 30_000 });
  const elapsed = Date.now() - start;

  expect(elapsed).toBeLessThan(5_000);
  await expect(dialog).toContainText(/video/i);
  const after = await page.evaluate(() => ({
    lazySrc: document.querySelector<HTMLImageElement>("img[loading=lazy]")!.src,
    tags: Array.from(document.querySelectorAll("video")).map((v) => v.tagName),
  }));
  expect(after.lazySrc).toContain("/dashboard.svg?lazy=");
  expect(after.tags).toEqual(["VIDEO", "VIDEO", "VIDEO"]);
});
