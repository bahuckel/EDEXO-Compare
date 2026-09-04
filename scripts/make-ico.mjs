import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pngToIco from "png-to-ico";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");
const { readPNG, resize } = require("png-to-ico/lib/png.js");

const __dirnameScripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirnameScripts, "..");
const pngPath = path.join(root, "public", "edexo-icon.png");
if (!existsSync(pngPath)) {
  console.error("Missing public/edexo-icon.png — add the ED EXO logo there.");
  process.exit(1);
}

const src = await readPNG(pngPath);
if (src.width !== src.height) {
  console.error("public/edexo-icon.png must be square for .ico generation.");
  process.exit(1);
}

/** Downscale from 256 so List/Details (16×16) stays sharp; order matters — Explorer small views prefer early entries. */
const base = src.width !== 256 ? resize(src, 256, 256) : src;
const sizes = [16, 32, 48, 256];
const pngBuffers = sizes.map((s) => PNG.sync.write(resize(base, s, s)));
const ico = await pngToIco(pngBuffers);

const outDir = path.join(root, "build");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "icon.ico"), ico);
console.info("Wrote build/icon.ico");
