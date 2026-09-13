import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * Smoke run over the real dev server on a fixture journal (WEBUI-REDESIGN 7.4 / NEXT-TASKS 17).
 *
 * `npm run test:e2e` boots `npm run dev` with the journal folder pointed at
 * `tests/fixtures/journal-smoke` (one system, one body with three bio signals) and the journal
 * cache off, drives Chrome (the installed one, no browser download), and drops screenshots of the
 * main views into `build-artifacts/webui-preview/` — the "before and after" for a UI change.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureJournal = path.resolve(here, "tests", "fixtures", "journal-smoke");

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "build-artifacts/playwright",
  use: {
    baseURL: "http://localhost:5199",
    channel: "chrome",
    headless: true,
    viewport: { width: 1500, height: 950 },
    screenshot: "off",
    trace: "retain-on-failure",
  },
  webServer: {
    // Own ports (5199 web, 7119 API): a packaged app already on 7111 must never answer for the fixture.
    command:
      'npx concurrently -k -n web,api "vite" "tsx src/server/devEntry.ts --host 127.0.0.1 --port 7119"',
    url: "http://localhost:5199/launcher.html",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      EDEXO_DEV_PORT: "5199",
      EDEXO_DEV_API_PORT: "7119",
      ED_JOURNAL_DIR: fixtureJournal,
      EDEXO_DISABLE_JOURNAL_CACHE: "1",
    },
  },
});
