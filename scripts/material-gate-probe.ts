/**
 * Can a species be ruled out when the body carries none of the materials its colour comes from?
 *
 * The owner's argument, on Bacterium tela: *"If the body I am checking does not have any of those as
 * rare materials per % of crust, we can start ignoring Tela. Because right now I still see it on
 * ~95% of planets."*
 *
 * It is a good argument and it generalises. Twenty-six species take their colour from a material
 * (`data/species/eddsn-colour-variants.json`); tela's six are the grade-3 set — cadmium, mercury,
 * molybdenum, niobium, tin, tungsten. If none of a species' six are in the crust, the plant has no
 * colour it could be, so it has nothing to grow as.
 *
 * Three things decide whether it is worth shipping, and this measures all three:
 *
 *   1. **Does it ever fire?** A gate that excludes nothing is noise. Counted over the bodies in his
 *      own cache that carry a biological signal — the population the panel actually scores.
 *   2. **What does it cost?** Every species he has *confirmed*, checked against its own table. A
 *      single confirmed body carrying none of its materials kills the rule outright, because that is
 *      a plant growing where the rule says it cannot.
 *   3. **Does the corpus agree?** The same check over every body the corpus records for a
 *      material-ruled species, which is thousands of bodies rather than hundreds.
 *
 * Materials come from the journal `Scan` — `Materials` is a full crust list, so an absent material is
 * absent rather than unrecorded, unlike the volcanism field in §21. A body whose scan carries no
 * material list at all is counted apart and never gated.
 *
 *   npx tsx scripts/material-gate-probe.ts
 */
import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { collectResolvedOrganicLockSpeciesIds } from "../src/server/organicLocks.js";
import { loadJournalMergeCacheForTool } from "./probeCache.js";
import { normaliseMaterial } from "../src/shared/speciesColour.js";
import type { BodyExoState } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const feederDir = process.env.EXOMASTERY_FEEDER_DIR?.trim() || path.resolve(root, "..", "exomastery-feeder");

const db = loadSpeciesDatabaseFromTree(root);

interface Rule {
  source: "star" | "material";
  map: Record<string, string>;
}
const tables = JSON.parse(
  readFileSync(path.join(root, "data", "species", "eddsn-colour-variants.json"), "utf8"),
) as { byGenus: Record<string, Rule>; bySpecies: Record<string, Rule> };

/** The material set a species' colour comes from, or null when its colour is read off the star. */
function materialsFor(displayName: string, genusDataDir: string): Set<string> | null {
  const rule = tables.bySpecies[displayName.toLowerCase()] ?? tables.byGenus[genusDataDir.toLowerCase()];
  if (rule?.source !== "material") return null;
  const keys = Object.keys(rule.map).map(normaliseMaterial).filter(Boolean);
  return keys.length ? new Set(keys) : null;
}

const ruled = new Map<string, Set<string>>();
for (const e of db.species) {
  const set = materialsFor(e.displayName, e.genusDataDir);
  if (set) ruled.set(e.id, set);
}
console.log(`species whose colour comes from a material: ${ruled.size}`);

/* ------------------------------------------------------------------ 1 and 2: his own cache */

const payload = loadJournalMergeCacheForTool();
const bodies: BodyExoState[] = payload.bodies.map(([, b]) => b);

const crustOf = (b: BodyExoState): Set<string> | null => {
  const mats = b.scan?.materials;
  if (!Array.isArray(mats) || mats.length === 0) return null;
  const out = new Set<string>();
  for (const m of mats) {
    const n = normaliseMaterial(String(m?.Name ?? m?.name ?? ""));
    if (n) out.add(n);
  }
  return out.size ? out : null;
};

let bioBodies = 0;
let noMaterials = 0;
const wouldGate = new Map<string, number>();
let telaGated = 0;
let anyGateFired = 0;

for (const b of bodies) {
  if ((b.biologicalSignals ?? 0) <= 0 || !b.scan?.PlanetClass?.trim()) continue;
  bioBodies += 1;
  const crust = crustOf(b);
  if (!crust) {
    noMaterials += 1;
    continue;
  }
  let fired = false;
  for (const [id, wanted] of ruled) {
    let hit = false;
    for (const w of wanted) {
      if (crust.has(w)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      wouldGate.set(id, (wouldGate.get(id) ?? 0) + 1);
      fired = true;
      if (id.includes("tela")) telaGated += 1;
    }
  }
  if (fired) anyGateFired += 1;
}

const withMats = bioBodies - noMaterials;
console.log("");
console.log(`bodies with a bio signal in his cache      ${bioBodies}`);
console.log(`  no crust list on the scan               ${noMaterials}  (never gated)`);
console.log(`  with a crust list                       ${withMats}`);
console.log(`  at least one species ruled out          ${anyGateFired}`);
console.log(
  `  Bacterium tela ruled out                ${telaGated} (${((telaGated / Math.max(1, withMats)) * 100).toFixed(1)} % of bodies with a crust list)`,
);

/* ---- the cost: species he has actually confirmed, against their own tables ---- */

let truthChecked = 0;
let truthViolations = 0;
const violations: string[] = [];

for (const b of bodies) {
  const crust = crustOf(b);
  if (!crust) continue;
  for (const id of collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db)) {
    const wanted = ruled.get(id);
    if (!wanted) continue;
    truthChecked += 1;
    let hit = false;
    for (const w of wanted) {
      if (crust.has(w)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      truthViolations += 1;
      if (violations.length < 12) {
        const e = db.species.find((x) => x.id === id);
        violations.push(`${e?.displayName ?? id} on ${b.bodyName} — crust ${[...crust].join(", ")}`);
      }
    }
  }
}

console.log("");
console.log(`his confirmed material-ruled species      ${truthChecked}`);
console.log(`  growing where none of its materials are ${truthViolations}   <- any of these kills the rule`);
for (const v of violations) console.log(`    ${v}`);

/* ------------------------------------------------------------------ 3: the corpus */

const planets = path.join(feederDir, "data", "raw", "planets");
const systems = path.join(feederDir, "data", "raw", "systems");
const sysCache = new Map<string, Map<string, Record<string, number> | undefined>>();

function crustFromCache(file: string, bodyName: string): Set<string> | null {
  let m = sysCache.get(file);
  if (!m) {
    m = new Map();
    const p = path.join(systems, file);
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, "utf8")) as {
          bodies?: { name?: string; materials?: Record<string, number> }[];
        };
        for (const b of j.bodies ?? []) if (b.name) m.set(b.name, b.materials);
      } catch {
        /* unreadable */
      }
    }
    sysCache.set(file, m);
  }
  const mats = m.get(bodyName);
  if (!mats) return null;
  const out = new Set<string>();
  for (const k of Object.keys(mats)) {
    const n = normaliseMaterial(k);
    if (n) out.add(n);
  }
  return out.size ? out : null;
}

const slugOf = (displayName: string) => displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_");

console.log("");
console.log("the corpus, per material-ruled species:");
console.log(`  ${"species".padEnd(26)} ${"bodies".padStart(7)} ${"no crust".padStart(9)} ${"none of its six".padStart(16)}`);

let corpusChecked = 0;
let corpusViolations = 0;
for (const [id, wanted] of ruled) {
  const e = db.species.find((x) => x.id === id);
  if (!e) continue;
  const dir = path.join(planets, slugOf(e.displayName));
  if (!existsSync(dir)) continue;

  const docs: { bodyName?: string; systemCacheFile?: string }[] = [];
  for (const f of readdirSync(dir)) {
    const full = path.join(dir, f);
    try {
      if (f.endsWith(".jsonl.gz")) {
        for (const line of gunzipSync(readFileSync(full)).toString("utf8").split(/\r?\n/)) {
          if (line.trim()) docs.push(JSON.parse(line));
        }
      } else if (f.endsWith(".json")) {
        docs.push(JSON.parse(readFileSync(full, "utf8")));
      }
    } catch {
      /* skip */
    }
  }

  const seen = new Set<string>();
  let n = 0;
  let noCrust = 0;
  let missing = 0;
  for (const d of docs) {
    const name = d.bodyName;
    if (!name || seen.has(name) || !d.systemCacheFile) continue;
    seen.add(name);
    n += 1;
    const crust = crustFromCache(d.systemCacheFile, name);
    if (!crust) {
      noCrust += 1;
      continue;
    }
    let hit = false;
    for (const w of wanted) {
      if (crust.has(w)) {
        hit = true;
        break;
      }
    }
    if (!hit) missing += 1;
  }
  corpusChecked += n - noCrust;
  corpusViolations += missing;
  console.log(`  ${e.displayName.padEnd(26)} ${String(n).padStart(7)} ${String(noCrust).padStart(9)} ${String(missing).padStart(16)}`);
}

console.log("");
console.log(`corpus bodies with a crust list           ${corpusChecked}`);
console.log(`  growing where none of its materials are ${corpusViolations} (${((corpusViolations / Math.max(1, corpusChecked)) * 100).toFixed(2)} %)`);
