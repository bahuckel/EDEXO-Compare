/**
 * Generate WebP derivatives for species artwork and the UI art.
 *
 * Why: the encyclopedia and the species cards were serving the original files — 56 MB across 96
 * photos, largest 2.8 MB — into slots 104 px and ~600 px wide, plus 4.6 MB of PNG backdrops in the
 * web bundle. Decoding those on the main thread is what made the list feel heavy even after lazy
 * loading stopped the request burst.
 *
 * Output (committed, shipped with the app; originals are never modified):
 *   data/species/<genus>/<genus>_photos/_thumbs/<name>.webp   320 px — encyclopedia rows
 *   data/species/<genus>/<genus>_photos/_cards/<name>.webp   1024 px — species card artwork
 *   vista.webp / no-exo.webp / fss-required.webp                     — CSS backdrops
 *   public/edexo-icon-124.webp                                       — 62 px header mark at 2x
 *
 * The server falls back to the original whenever a derivative is missing, so photos a commander
 * adds by hand keep working untouched until this is run again.
 *
 * Usage: npm run images        (add --force to rebuild everything)
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const force = process.argv.includes("--force");

const THUMB_DIR = "_thumbs";
const CARD_DIR = "_cards";
const THUMB_WIDTH = 320;
const CARD_WIDTH = 1024;
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;

let made = 0;
let skipped = 0;
let bytesIn = 0;
let bytesOut = 0;

function isStale(src, out) {
  if (force || !existsSync(out)) return true;
  return statSync(src).mtimeMs > statSync(out).mtimeMs;
}

async function derive(src, out, width, quality = 74) {
  if (!isStale(src, out)) {
    skipped += 1;
    return;
  }
  await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality, effort: 5 }).toFile(out);
  bytesIn += statSync(src).size;
  bytesOut += statSync(out).size;
  made += 1;
}

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

async function speciesPhotos() {
  const speciesRoot = join(repoRoot, "data", "species");
  if (!existsSync(speciesRoot)) return;
  for (const genus of readdirSync(speciesRoot)) {
    const genusDir = join(speciesRoot, genus);
    if (!statSync(genusDir).isDirectory()) continue;
    for (const sub of readdirSync(genusDir)) {
      if (!sub.toLowerCase().endsWith("_photos")) continue;
      const photosDir = join(genusDir, sub);
      if (!statSync(photosDir).isDirectory()) continue;
      const thumbs = join(photosDir, THUMB_DIR);
      const cards = join(photosDir, CARD_DIR);
      mkdirSync(thumbs, { recursive: true });
      mkdirSync(cards, { recursive: true });
      for (const file of readdirSync(photosDir)) {
        if (!IMAGE_RE.test(file)) continue;
        const src = join(photosDir, file);
        if (!statSync(src).isFile()) continue;
        const stem = basename(file, extname(file));
        await derive(src, join(thumbs, `${stem}.webp`), THUMB_WIDTH, 72);
        await derive(src, join(cards, `${stem}.webp`), CARD_WIDTH, 76);
      }
    }
  }
}

async function uiArt() {
  const jobs = [
    ["vista.png", "vista.webp", 1600, 72],
    ["no-exo.png", "no-exo.webp", 1400, 74],
    ["fss-required.png", "fss-required.webp", 1400, 74],
    ["public/edexo-icon.png", "public/edexo-icon-124.webp", 124, 88],
  ];
  for (const [from, to, width, quality] of jobs) {
    const src = join(repoRoot, from);
    if (!existsSync(src)) {
      console.warn(`[images] missing source, skipped: ${from}`);
      continue;
    }
    await derive(src, join(repoRoot, to), width, quality);
  }
}

await speciesPhotos();
await uiArt();

console.log(
  `[images] wrote ${made} derivative(s), skipped ${skipped} up-to-date` +
    (made > 0
      ? ` — ${fmt(bytesIn)} of sources → ${fmt(bytesOut)} (${Math.round((1 - bytesOut / bytesIn) * 100)}% smaller)`
      : ""),
);
