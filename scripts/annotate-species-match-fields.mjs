/**
 * One-shot: add atmospherePressureCategory "thin" to species whose genus requires thin air (meta already says so).
 * Skips brain-tree (airless) and anemone (mostly airless).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const speciesDir = path.join(root, "data", "species");
const skipDirs = new Set(["brain-tree", "anemone"]);

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name.endsWith("_new.json")) {
      const parts = p.split(path.sep);
      const genusFolder = parts[parts.length - 2];
      if (skipDirs.has(genusFolder)) continue;

      const raw = fs.readFileSync(p, "utf8");
      const j = JSON.parse(raw);
      if (!Array.isArray(j.species)) continue;
      let changed = false;
      for (const s of j.species) {
        if (!s.conditions || typeof s.conditions !== "object") continue;
        if (s.conditions.atmospherePressureCategory) continue;
        s.conditions.atmospherePressureCategory = "thin";
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
        console.log("updated", path.relative(root, p));
      }
    }
  }
}

walk(speciesDir);
