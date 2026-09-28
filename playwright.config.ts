import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
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
/*
  A fake Elite Options tree whose DisplaySettings.xml says Fullscreen, so the HUD menu's
  "switch to Borderless" warning has something real to react to. Pointing at the commander's own
  settings would make the assertion depend on how he happens to have the game configured tonight.
*/
const fixtureEliteOptions = path.resolve(here, "tests", "fixtures", "elite-options-fullscreen");
/*
  Its own user-data folder, emptied each run (code review, 2026-09-28). Without it the dev server wrote
  into the commander's real profile: one fixture body ("Smoke Test 1") had sat in his predictions log
  since 2026-09-13, and every run overwrote his journal cache with the fixture's. Uploads are off in a
  fresh profile, so nothing the fixture does can reach EDSM, EDDN or Canonn either.
*/
const e2eUserData = path.join(os.tmpdir(), "edexo-e2e-profile");
rmSync(e2eUserData, { recursive: true, force: true });
mkdirSync(e2eUserData, { recursive: true });

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
      EDEXO_ELITE_OPTIONS_DIR: fixtureEliteOptions,
      EDEXO_DISABLE_JOURNAL_CACHE: "1",
      EDEXO_USER_DATA_DIR: e2eUserData,
    },
  },
});
