/**
 * Copy `data/` into a build, without the parts of it that are runtime state.
 *
 * Both packagers — the Electron portable and the console CLI pair — used to `cpSync("data", …)`
 * wholesale, and `data/` is not purely shipped content. `foot_scanned.json` is the learned on-foot
 * catalog: the app appends a row every time a `ScanOrganic` analyse completes, and it sits beside
 * the species tree because `footScannedCatalog.ts` resolves it against the project root.
 *
 * So a wholesale copy puts **the builder's own landings inside the release** — system, body, species
 * and timestamp — and seeds them into every installer's catalog as bodies they scanned themselves.
 * Caught while preparing the first public release, with one real system in the file.
 *
 * Two packagers needing the same exclusion is exactly how an exclusion goes stale in one of them, so
 * there is one copier and both call it. The catalog reader treats an absent file as an empty one,
 * which is why leaving it out is the whole fix.
 */
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Names directly under `data/` that must never reach a packaged build. */
export const RUNTIME_STATE = Object.freeze(["foot_scanned.json"]);

/**
 * Copy the data tree to `destDataDir`, minus {@link RUNTIME_STATE}.
 *
 * Throws rather than returning quietly if anything excluded still lands there — a silent leak here
 * is a privacy failure that ships, so the build must stop instead.
 */
export function copyDataTree(destDataDir) {
  const excluded = new Set(RUNTIME_STATE.map((name) => join("data", name)));
  cpSync("data", destDataDir, { recursive: true, filter: (src) => !excluded.has(src) });

  for (const name of RUNTIME_STATE) {
    const leaked = join(destDataDir, name);
    if (existsSync(leaked)) {
      throw new Error(`data/${name} reached the packaged tree at ${leaked} — refusing to package it.`);
    }
  }
}
