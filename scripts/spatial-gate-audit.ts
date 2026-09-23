/**
 * Do the *position* gates agree with an independent feed? — the fourth quarter of the gate audit.
 *
 *   npx tsx scripts/spatial-gate-audit.ts <capture.jsonl>
 *
 * ## Why this is a separate pass
 *
 * `speciesMatchesCriteria` never sees a spatial gate. Nebula distance, Guardian distance, distance
 * to Sgr A*, the region rollup and `systemBodyClassesAnyOf` are all facts about the **system**, and
 * they are applied afterwards by `demoteFailedSpatialGates`, `demoteFailedSystemBodyGates` and the
 * region branch of the reason builder. A replay that feeds one body at a time through the matcher
 * therefore exercises none of them — which is exactly how an earlier pass could report "every axis
 * measured" while four axes had never been touched at all.
 *
 * ## The method, after the one the previous pass got wrong
 *
 * That pass compared gate *text* against observations and produced three findings that were
 * artefacts of its own method. So this one calls the shipped functions — `evaluateSpatialGate`,
 * `regionalPresence`, `regionIndexForCoords` — against the shipped catalogues, and asks one
 * question with an unambiguous answer:
 *
 *   **of the sightings an independent dataset actually recorded, how many would we demote?**
 *
 * A demotion is not a deletion, so a few per cent is survivable and even expected — these gates are
 * calibrated at 79–99 %. What this looks for is a gate wrong in *kind*: one whose failures cluster
 * on a single species, or one whose pass rate is no better than the background.
 *
 * ## The join
 *
 * On a normalised word bag, never on the display name. The corpus writes `Albidum Sinuous Tubers`
 * where the tree writes `Sinuous Tubers Albidum`, and joining on the name silently dropped eighteen
 * species from an earlier audit.
 *
 * `Analyse` rows are ignored on the owner's instruction: Frontier no longer requires the commander
 * to stay put, so that event routinely fires at a different body. `Log` and `Sample` are used, and
 * `CodexEntry` rows, which are emitted where the plant is.
 *
 * A **system** is the unit of evidence, not a body. Every body in a system shares one answer from
 * every gate here, so counting bodies would let one heavily-scanned system outvote twenty others.
 */
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { getProjectRoot } from "../src/server/paths.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { loadSpatialCatalogue } from "../src/server/spatialCatalogue.js";
import { loadRegionMap } from "../src/server/regionMapData.js";
import { regionIndexForCoords } from "../src/shared/regionMap.js";
import { regionalPresence } from "../src/server/regionSpeciesData.js";
import { evaluateSpatialGate, gateForSpeciesId } from "../src/shared/spatialGates.js";

const capture = process.argv[2];
if (!capture) {
  console.error("usage: npx tsx scripts/spatial-gate-audit.ts <capture.jsonl>");
  process.exit(1);
}

const root = getProjectRoot();
const db = loadSpeciesDatabaseFromTree(root);
const catalogue = loadSpatialCatalogue(root);
const regionMap = loadRegionMap(root);
if (!catalogue) throw new Error("no spatial catalogue — data/exomastery/spatial-catalogue.json");
if (!regionMap) throw new Error("no region map — data/exomastery/region-map.json");

/** Sorted words, lower case: the only key two datasets may be joined on. */
const bag = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");

const byBag = new Map<string, { id: string; displayName: string }>();
for (const e of db.species) {
  const k = bag(e.displayName);
  if (!byBag.has(k)) byBag.set(k, { id: e.id, displayName: e.displayName });
}

/**
 * A capture's `name` fields are not the game's.
 *
 * EDDN strips every `_Localised` field, so the collector writes names from its own hand-typed table,
 * and that table numbers Tussocks wrongly from `_06` on: it calls `_11` Triticum where the game —
 * `Species_Localised` in the owner's own journals — calls it Caputus, and so on to `_15`. Joining on
 * that name moved seven Tussocks' sightings onto each other. Checked against the journals, every
 * other genus in the table is right (71 of 76 tokens agree; the five that do not are these), so
 * Tussocks alone are named from the token here.
 */
const TUSSOCK_BY_NUMBER = [
  "Pennata", "Ventusa", "Ignis", "Cultro", "Catena", "Pennatis", "Serrati", "Albata",
  "Propagito", "Divisa", "Caputus", "Triticum", "Stigmasis", "Virgam", "Capillum",
];
const nameOf = (token: string | undefined, captured: string | undefined): string | undefined => {
  const m = /^\$Codex_Ent_Tussocks_(\d{2})_/.exec(token ?? "");
  const species = m ? TUSSOCK_BY_NUMBER[Number(m[1]) - 1] : undefined;
  return species ? `Tussock ${species}` : captured;
};

/**
 * Genera the game never localises, whose names the collector falls back to spelling from the token.
 *
 * `$Codex_Ent_Seed_Name;` arrives as the literal string "Seed" and `$Codex_Ent_TubeABCD_01_Name;`
 * as "TubeABCD #01" — which is why an audit joining on names alone reported zero sightings for the
 * two genera whose gates it most needed to measure. Mapped to the genus rather than the species:
 * these tokens name the structure, and the colour is not in them.
 *
 * `L Seed …`, `S Seed …` and `SPOI …` are deliberately absent. They are surface point-of-interest
 * landmarks that happen to share the word, not biology.
 */
const INTERNAL_NAMES: Readonly<Record<string, string>> = {
  Cone: "bark_mound",
  Ground_Struct_Ice: "crystalline_shard",
  Vents: "amphora_plant",
  Seed: "brain_tree",
  SeedABCD_01: "brain_tree",
  SeedABCD_02: "brain_tree",
  SeedEFGH: "brain_tree",
  SeedEFGH_02: "brain_tree",
  TubeABCD_01: "sinuous_tuber",
  TubeABCD_02: "sinuous_tuber",
  TubeABCD_03: "sinuous_tuber",
};
/** genusKey -> the tree's species ids for it, so a genus-level sighting can judge a gate. */
const genusSpecies = new Map<string, string[]>();
for (const [, genusKey] of Object.entries(INTERNAL_NAMES)) {
  if (genusSpecies.has(genusKey)) continue;
  genusSpecies.set(
    genusKey,
    db.species.filter((e) => e.id.includes(genusKey)).map((e) => e.id),
  );
}
const genusOfToken = (token: string | undefined): string | null => {
  const m = /^\$Codex_Ent_(.+)_Name;$/.exec(token ?? "");
  return m ? (INTERNAL_NAMES[m[1]!] ?? null) : null;
};

interface Sys {
  x: number;
  y: number;
  z: number;
  regionIndex: number;
  bodyCount: number | null;
}
const systems = new Map<string, Sys>();
/** speciesId -> systems where the game named *that species*. */
const sightings = new Map<string, Set<string>>();
/**
 * The same, plus the genus-level rows fanned across the genus' colours.
 *
 * Right for a position gate — every colour of a Brain Tree shares one answer about where the system
 * is — and wrong for the region rule, which is per species: crediting eight colours with a sighting
 * of one would invent seven absences to report. Two sets rather than one flag, so the wrong one
 * cannot be reached by accident.
 */
const gateSightings = new Map<string, Set<string>>();
const unknownNames = new Map<string, number>();

function note(id: string, systemId: string, speciesLevel: boolean): void {
  if (speciesLevel) {
    let s = sightings.get(id);
    if (!s) sightings.set(id, (s = new Set()));
    s.add(systemId);
  }
  let g = gateSightings.get(id);
  if (!g) gateSightings.set(id, (g = new Set()));
  g.add(systemId);
}

const rl = readline.createInterface({ input: fs.createReadStream(path.resolve(capture)) });
for await (const line of rl) {
  const o = JSON.parse(line) as Record<string, any>;
  if (o.kind === "manifest") continue;
  if (o.kind === "system") {
    const c = o.coords;
    if (!c) continue;
    systems.set(o.id64, {
      x: c.x,
      y: c.y,
      z: c.z,
      regionIndex: regionIndexForCoords(regionMap, c.x, c.z),
      bodyCount: o.bodyCount ?? null,
    });
    continue;
  }
  const names = new Set<string>();
  for (const c of o.signals?.codex ?? []) {
    const genus = genusOfToken(c.token);
    if (genus) for (const id of genusSpecies.get(genus) ?? []) note(id, o.systemId64, false);
    else {
      const n = nameOf(c.token, c.name);
      if (n) names.add(n);
    }
  }
  for (const s of o.signals?.organics ?? []) {
    if (s.scanType !== "Log" && s.scanType !== "Sample") continue;
    const genus = genusOfToken(s.variant) ?? genusOfToken(s.species);
    if (genus) for (const id of genusSpecies.get(genus) ?? []) note(id, o.systemId64, false);
    else {
      const n = nameOf(s.species, s.name);
      if (n) names.add(n);
    }
  }
  for (const n of names) {
    const hit = byBag.get(bag(n));
    if (!hit) {
      unknownNames.set(n, (unknownNames.get(n) ?? 0) + 1);
      continue;
    }
    note(hit.id, o.systemId64, true);
  }
}

const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
const all = [...systems.values()];
console.log(
  `capture: ${systems.size} systems with coordinates, ${gateSightings.size} of the tree's ${db.species.length} species seen (${sightings.size} named at species level)`,
);
console.log(`species names in the capture the tree has no row for: ${unknownNames.size}\n`);

/* ---- 1. the position gates ----------------------------------------------------------------- */
const probe = { nebula: "bark_mound", guardian: "brain_tree", core: "sinuous_tuber" } as const;
const background = Object.fromEntries(
  Object.entries(probe).map(([kind, id]) => [
    kind,
    all.filter((s) => evaluateSpatialGate(id, s, catalogue)?.passes === true).length,
  ]),
) as Record<keyof typeof probe, number>;
console.log(
  `background over ${all.length} systems — nebula<150ly ${pc(background.nebula, all.length)}  guardian<1000ly ${pc(background.guardian, all.length)}  core<10kly ${pc(background.core, all.length)}\n`,
);
console.log("species                         gate             seen  passes  demoted  median ly");
const gated = db.species.filter((e) => gateForSpeciesId(e.id));
for (const e of [...gated].sort((a, b) => a.displayName.localeCompare(b.displayName))) {
  const gate = gateForSpeciesId(e.id)!;
  const label = `${gate.kind}<${gate.thresholdLy}`;
  const verdicts = [...(gateSightings.get(e.id) ?? [])]
    .map((i) => evaluateSpatialGate(e.id, systems.get(i)!, catalogue))
    .filter((v): v is NonNullable<typeof v> => v != null);
  if (!verdicts.length) {
    console.log(`${e.displayName.padEnd(31)} ${label.padEnd(16)}    0`);
    continue;
  }
  const pass = verdicts.filter((v) => v.passes).length;
  const sorted = verdicts.map((v) => v.distanceLy).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  console.log(
    `${e.displayName.padEnd(31)} ${label.padEnd(16)} ${String(verdicts.length).padStart(4)}  ${pc(pass, verdicts.length).padStart(6)}  ${String(verdicts.length - pass).padStart(7)}  ${Math.round(median)}`,
  );
}

/* ---- 2. the region rollup ------------------------------------------------------------------ */
let absent = 0;
let present = 0;
let unknown = 0;
const misses: { species: string; region: string; systems: number; count: number; bio: number }[] = [];
for (const [id, seen] of sightings) {
  const per = new Map<number, { name: string; n: number; count: number; bio: number }>();
  for (const s of seen) {
    const idx = systems.get(s)?.regionIndex ?? 0;
    if (!idx) continue;
    const v = regionalPresence(root, idx, id);
    if (!v) continue;
    if (v.presence === "unknown") unknown++;
    else if (v.presence === "present") present++;
    else {
      absent++;
      const e = per.get(idx) ?? { name: v.regionName, n: 0, count: v.count, bio: v.bioSystems };
      e.n++;
      per.set(idx, e);
    }
  }
  for (const e of per.values())
    misses.push({ species: id, region: e.name, systems: e.n, count: e.count, bio: e.bio });
}
const judgeable = absent + present;
console.log("\nregion rule — sightings the rollup calls absent, which are demoted:");
console.log(`  present ${present}   absent ${absent}   region too sparse to judge ${unknown}`);
console.log(
  `  false-demotion rate against real sightings: ${pc(absent, judgeable)} of ${judgeable} judgeable system-species rows\n`,
);
for (const m of misses.sort((a, b) => b.systems - a.systems))
  console.log(
    `  ${m.species.padEnd(38)} ${m.region.padEnd(26)} ${String(m.systems).padStart(3)} systems seen · rollup holds ${m.count} of ${m.bio.toLocaleString()}`,
  );

/* ---- 3. the system-body gate --------------------------------------------------------------- */
const withSystemBodies = db.species.filter((e) => e.criteria?.systemBodyClassesAnyOf?.length);
console.log(`\nsystem-body gate carried by ${withSystemBodies.length} species:`);
for (const e of withSystemBodies)
  console.log(`  ${e.displayName.padEnd(30)} one of: ${e.criteria.systemBodyClassesAnyOf!.join(", ")}`);

if (unknownNames.size) {
  console.log("\nnames in the capture the tree cannot place (top 20 by rows):");
  for (const [n, c] of [...unknownNames].sort((a, b) => b[1] - a[1]).slice(0, 20))
    console.log(`  ${n} ×${c}`);
}
