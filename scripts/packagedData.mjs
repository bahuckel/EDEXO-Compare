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
import { cpSync, existsSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

/**
 * Runtime state: the commander's own, and a privacy failure if it ships.
 *
 * `foot_scanned.json` is the learned on-foot catalog. It has moved beside the user settings, so a
 * current build does not write one here any more — this stays because a developer tree still has the
 * old file sitting in it, and the exclusion is what keeps that out of a release.
 */
export const RUNTIME_STATE = Object.freeze(["foot_scanned.json"]);

/**
 * Shipped by accident rather than by decision: real content, but nothing in `src/` reads it.
 *
 * `spansh-dump-tests` is four Spansh route exports the tests and probes run against. Public data and
 * harmless, but 368 KB of fixtures in every download, and a release should carry what the app uses.
 */
export const NOT_SHIPPED = Object.freeze(["spansh-dump-tests"]);

const EXCLUDED = Object.freeze([...RUNTIME_STATE, ...NOT_SHIPPED]);

/** The list of originals left out of a build, inside each `_cards` folder (speciesPhotos.ts reads it). */
export const ORIGINALS_FILE = "_originals.json";
const ORIGINAL_RE = /\.(png|jpe?g)$/i;

/**
 * A species photograph's original, when its 1024 px WebP card (`_cards/<stem>.webp`, `npm run
 * images`) stands in for it (review F-4.1c): about 56 MB of originals shipped beside derivatives that
 * only the lightbox did not use. The card is what the lightbox gets now; the originals stay in the
 * repository. Artwork with no card yet still ships as it is.
 */
export function isReplacedPhotoOriginal(src) {
  const dir = dirname(src);
  if (!/_photos$/i.test(basename(dir)) || !ORIGINAL_RE.test(src)) return false;
  const stem = basename(src, extname(src));
  return existsSync(join(dir, "_cards", `${stem}.webp`));
}

/**
 * Copy the data tree to `destDataDir`, minus {@link RUNTIME_STATE} and {@link NOT_SHIPPED}.
 *
 * Throws rather than returning quietly if anything excluded still lands there — a silent leak here
 * is a privacy failure that ships, so the build must stop instead.
 */
export function copyDataTree(destDataDir) {
  const excluded = new Set(EXCLUDED.map((name) => join("data", name)));
  /** `_photos` folder (relative to data/) → the originals its cards stand in for. */
  const replaced = new Map();
  cpSync("data", destDataDir, {
    recursive: true,
    filter: (src) => {
      if (excluded.has(src)) return false;
      if (isReplacedPhotoOriginal(src)) {
        const rel = dirname(src).slice("data".length + 1);
        replaced.set(rel, [...(replaced.get(rel) ?? []), basename(src)]);
        return false;
      }
      return true;
    },
  });
  for (const [rel, names] of replaced) {
    writeFileSync(join(destDataDir, rel, "_cards", ORIGINALS_FILE), JSON.stringify(names.sort(), null, 1));
  }
  // Every card that replaced an original is there to serve it.
  for (const [rel, names] of replaced) {
    for (const n of names) {
      const card = join(destDataDir, rel, "_cards", `${basename(n, extname(n))}.webp`);
      if (!existsSync(card)) throw new Error(`${card} is missing — the photo ${n} would be lost.`);
    }
  }

  for (const name of EXCLUDED) {
    const leaked = join(destDataDir, name);
    if (existsSync(leaked)) {
      throw new Error(`data/${name} reached the packaged tree at ${leaked} — refusing to package it.`);
    }
  }
}
