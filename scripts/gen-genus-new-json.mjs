/**
 * Generates data/species/<folder>/<basename>_new.json from the primary genus JSON.
 * Species conditions/criteria blocks are deep-copied only — never altered.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SPECIES_ROOT = join(ROOT, "data", "species");

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function slug(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Primary genus file: `<folder>.json` (case-insensitive), excluding `*_new.json`. */
function findMainJson(genusDir, folderName) {
  const want = `${folderName.toLowerCase()}.json`;
  const files = readdirSync(genusDir).filter((f) => {
    if (!f.toLowerCase().endsWith(".json")) return false;
    if (f.toLowerCase().endsWith("_new.json")) return false;
    if (f.toLowerCase() === "package.json") return false;
    return true;
  });
  for (const f of files) {
    if (f.toLowerCase() === want) return join(genusDir, f);
  }
  if (files.length === 1) return join(genusDir, files[0]);
  return null;
}

function buildSpeciesArray(speciesBlock, genusLabel) {
  if (!speciesBlock) return [];

  const row = (displayNameSource, rawIn) => {
    const raw = rawIn && typeof rawIn === "object" ? rawIn : {};
    const displayName = raw.displayName ?? raw.name ?? raw.species ?? displayNameSource;
    const id = raw.id ?? slug(`${genusLabel}_${displayName}`);
    const out = { id, displayName: String(displayName) };
    if (raw.description !== undefined) out.description = raw.description;
    if (raw.conditions !== undefined) out.conditions = deepClone(raw.conditions);
    if (raw.criteria !== undefined) out.criteria = deepClone(raw.criteria);
    for (const [k, v] of Object.entries(raw)) {
      if (["id", "displayName", "name", "species", "description", "conditions", "criteria"].includes(k)) continue;
      out[k] = deepClone(v);
    }
    return out;
  };

  if (Array.isArray(speciesBlock)) {
    return speciesBlock.map((item, i) => row(item?.displayName ?? item?.name ?? `species_${i}`, item));
  }
  if (typeof speciesBlock === "object") {
    return Object.entries(speciesBlock).map(([speciesName, raw]) => row(speciesName, raw));
  }
  return [];
}

const META_SKIP = new Set([
  "genus",
  "Genus",
  "species",
  "Species",
  "formatVersion",
  "species_distribution_rules",
  "Species_distribution_rules",
  "notes",
  "authorNotes",
  "AuthorNotes",
]);

const dirs = readdirSync(SPECIES_ROOT).filter((d) => statSync(join(SPECIES_ROOT, d)).isDirectory());

for (const folder of dirs) {
  const genusDir = join(SPECIES_ROOT, folder);
  const mainPath = findMainJson(genusDir, folder);
  if (!mainPath) {
    console.warn(`skip (no main .json): ${folder}`);
    continue;
  }

  const base = basename(mainPath, ".json");
  const outPath = join(genusDir, `${base}_new.json`);

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(mainPath, "utf8"));
  } catch (e) {
    console.warn(`skip (invalid JSON): ${folder} — ${e.message}`);
    continue;
  }

  const genus = parsed.genus ?? parsed.Genus ?? folder;
  const speciesArr = buildSpeciesArray(parsed.species ?? parsed.Species, genus);

  const newFile = {
    formatVersion: 1,
    genus,
    meta: {
      temperature_K_convention:
        "Pair is [min_K, max_K]. Use 999 (or any value ≥ 500) for max to mean no practical upper bound in the matcher.",
    },
  };

  if (parsed.general !== undefined) newFile.meta.general = deepClone(parsed.general);
  if (parsed.general?.description) newFile.meta.summary = parsed.general.description;
  if (parsed.general?.min_sample_distance_m != null) {
    newFile.meta.minSampleDistanceM = parsed.general.min_sample_distance_m;
  }
  if (parsed.general?.planet_requirements) {
    newFile.meta.genusWideRequirements = deepClone(parsed.general.planet_requirements);
  }
  if (parsed.general?.environmental_context) {
    newFile.meta.environmental_context = deepClone(parsed.general.environmental_context);
  }
  if (parsed.color_variants !== undefined) {
    newFile.meta.color_variants = deepClone(parsed.color_variants);
  }

  for (const [k, v] of Object.entries(parsed)) {
    if (META_SKIP.has(k)) continue;
    if (k === "general" || k === "color_variants") continue;
    newFile.meta[k] = deepClone(v);
  }

  newFile.species = speciesArr;

  if (parsed.species_distribution_rules !== undefined) {
    newFile.distributionReference = deepClone(parsed.species_distribution_rules);
  }
  if (parsed.notes !== undefined && typeof parsed.notes === "object") {
    newFile.authorNotes = deepClone(parsed.notes);
  }

  writeFileSync(outPath, `${JSON.stringify(newFile, null, 2)}\n`, "utf8");
  console.log("wrote", outPath.replace(ROOT + "\\", "").replace(ROOT + "/", ""));
}
