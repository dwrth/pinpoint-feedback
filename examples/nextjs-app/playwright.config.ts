import { defineConfig, devices } from "@playwright/test";

const APP_PORT = 3100;
const MOCK_PORT = 3999;
const DATABASE_ID = "0123456789abcdef0123456789abcdef";
const CI = Boolean(process.env.CI);

export const MOCK_NOTION_URL = `http://127.0.0.1:${MOCK_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      command: "node mock-notion/server.mjs",
      url: `${MOCK_NOTION_URL}/__mock/health`,
      reuseExistingServer: !CI,
      env: { MOCK_NOTION_PORT: String(MOCK_PORT), MOCK_NOTION_TOKEN: "secret_test", MOCK_NOTION_DATABASE_ID: DATABASE_ID },
      stdout: "pipe",
    },
    {
      command: process.env.E2E_DEV ? `next dev -p ${APP_PORT}` : `next build && next start -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}`,
      timeout: 300_000,
      reuseExistingServer: !CI,
      env: {
        NOTION_API_KEY: "secret_test",
        NOTION_FEEDBACK_DATABASE_ID: DATABASE_ID,
        NOTION_API_BASE_URL: MOCK_NOTION_URL,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdout: "pipe",
    },
  ],
});
