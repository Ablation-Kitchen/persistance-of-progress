import { defineConfig } from "@playwright/test";
import { BASE_URL } from "./docker.js";

/**
 * The 17-week walkthrough (ticket 16) against `docker compose up` on a fresh volume.
 * Run with `npm run e2e`. Uses the installed Google Chrome, so no browser download is needed.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  globalSetup: "./global.ts",
  timeout: 5 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  outputDir: "./test-results",
  use: {
    baseURL: BASE_URL,
    channel: "chrome",
    timezoneId: "UTC",
    locale: "en-GB",
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
  },
});
