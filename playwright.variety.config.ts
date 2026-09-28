import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * End-to-end run over a varied journal (owner, 2026-09-28): twelve real systems from the public
 * known-spawn fixture — Ingensradices in HIP 87621, Crystalline Shards, an Anemone, a Brain Tree, the
 * Tubers ring, Bark Mounds and ordinary genera across regions — as synthetic journal lines
 * (`scripts/build-e2e-journal.ts`), half the bio bodies DSS'd. Nothing of the commander's.
 *
 *   npm run test:e2e:variety
 *
 * Its own ports (5198 web, 7118 API) and its own empty user-data folder, like the smoke run.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const journal = path.resolve(here, "tests", "fixtures", "journal-variety");
const userData = path.join(os.tmpdir(), "edexo-e2e-variety-profile");
rmSync(userData, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });

export default defineConfig({
  testDir: "e2e-variety",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "build-artifacts/playwright-variety",
  use: {
    baseURL: "http://localhost:5198",
    channel: "chrome",
    headless: true,
    viewport: { width: 1500, height: 950 },
    screenshot: "off",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      'npx concurrently -k -n web,api "vite" "tsx src/server/devEntry.ts --host 127.0.0.1 --port 7118"',
    url: "http://localhost:5198/launcher.html",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      EDEXO_DEV_PORT: "5198",
      EDEXO_DEV_API_PORT: "7118",
      ED_JOURNAL_DIR: journal,
      EDEXO_DISABLE_JOURNAL_CACHE: "1",
      EDEXO_USER_DATA_DIR: userData,
    },
  },
});
