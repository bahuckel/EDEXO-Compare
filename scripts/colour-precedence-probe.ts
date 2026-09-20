/**
 * What actually decides a plant's colour when the body carries two of its materials.
 *
 * Twenty-six species take their colour from a material rather than from the parent star
 * (`data/species/eddsn-colour-variants.json`). A table lists six materials; bodies often carry two,
 * `colourFromBodyMaterials` then answers "Cyan or Orange", and that hedge is what raises the
 * `info gather` mark on omentum, scopulum, tela, verrata and Concha renibus. The standing hypothesis
 * was a fixed precedence — `cadmium < molybdenum < tin < niobium/mercury/tungsten`.
 *
 * ## The journal says which material won — it does not have to be inferred
 *
 * `ScanOrganic` carries `Variant`, and for these species the token **names the material**:
 *
 *     "$Codex_Ent_Conchas_01_Niobium_Name;"   ->  Concha Renibus - Blue
 *     "$Codex_Ent_Conchas_01_Tungsten_Name;"  ->  Concha Renibus - White
 *
 * So every scan is a labelled example. Reading the winner off the colour would have worked too, but
 * only where the table is already right; the token is ground truth independent of the table, which is
 * what lets this probe check the table as well as the precedence.
 *
 * ## What it reports
 *
 *   1. **Is the variant's material even on the body?** If the game names a material the Scan does not
 *      list, the whole material theory is wrong. It is not — see the run.
 *   2. **The table, checked against his own scans.** Each token pairs a material with a colour; any
 *      disagreement with ED-DSN's transcription is a transcription error worth fixing.
 *   3. **The precedence**, pooled and per species, with contradictions named rather than averaged.
 *   4. **The tie-breaks that are not precedence** — abundance, and the parent star class — measured on
 *      the same rows, because "then what does decide it" is the next question either way.
 *
 * A pair counts as settled only when every observation of it points one way. Right four times and
 * wrong once is not a precedence.
 *
 *   npm run colour-probe            # the summary
 *   npm run colour-probe -- --rows  # every contested body, for reading by hand
 *
 * Journals have gaps (a Windows reinstall), so a body whose `Scan` was lost drops out. Counts are
 * floors.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { listJournalFilesChronological, readJournalFull } from "../src/server/journalWatcher.js";
import { normaliseMaterial } from "../src/shared/speciesColour.js";
import type { JournalLine } from "../src/shared/types.js";

const showRows = process.argv.includes("--rows");

const journalDir =
  process.env.ED_JOURNAL_DIR?.trim() ||
  path.join(process.env.USERPROFILE || "", "Saved Games", "Frontier Developments", "Elite Dangerous");

/* ------------------------------------------------------------------ the colour tables */

interface Rule {
  source: "star" | "material";
  map: Record<string, string>;
}

const tables = JSON.parse(
  readFileSync(path.join("data", "species", "eddsn-colour-variants.json"), "utf8"),
) as { byGenus: Record<string, Rule>; bySpecies: Record<string, Rule> };

/**
 * `Species_Localised` is the *full* name — "Bacterium Acies", not "Acies" — so prepending the genus
 * gives "Bacterium Bacterium Acies", which matches nothing and falls through to the genus table. That
 * is how the first run of this probe reported 364 star-ruled species and zero material ones.
 */
function fullName(genus: string, species: string): string {
  const g = genus.trim();
  const s = species.trim();
  return s.toLowerCase().startsWith(g.toLowerCase()) ? s : `${g} ${s}`.trim();
}

/** Species first, genus as the fallback — the same order the app resolves in. */
function ruleFor(genus: string, species: string): Rule | null {
  const s = fullName(genus, species).toLowerCase();
  return tables.bySpecies[s] ?? tables.byGenus[genus.trim().toLowerCase()] ?? null;
}

/* ------------------------------------------------------------------ reading the journals */

interface Body {
  name: string;
  /** normalised material name -> percentage by mass. */
  materials: Map<string, number>;
  /** BodyID of the nearest `Star` above this body, from `Parents`. */
  parentStarId: number | null;
  starType: string | null;
}

const bodies = new Map<string, Body>();

interface Obs {
  species: string;
  bodyKey: string;
  when: string;
  /** The material the token names, lower case. Null when the token is a star-class letter. */
  variantMaterial: string | null;
  variantColour: string;
}

const observations: Obs[] = [];
const seen = new Set<string>();

const bodyKey = (sys: unknown, id: unknown): string | null =>
  sys === undefined || id === undefined ? null : `${String(sys)}:${String(id)}`;

/** "Bacterium Tela - Green" -> "Green". */
function colourFromVariant(label: string): string | null {
  const i = label.lastIndexOf(" - ");
  return i < 0 ? null : label.slice(i + 3).trim() || null;
}

/**
 * `$Codex_Ent_Conchas_01_Niobium_Name;` -> "niobium"; `$Codex_Ent_Aleoids_01_K_Name;` -> null, since
 * `K` is a star class, not a material. Anything under three letters is a class letter.
 */
function materialFromVariantToken(token: string): string | null {
  const m = /_([A-Za-z]+)_Name;?$/.exec(token.trim());
  const word = m?.[1];
  if (!word || word.length <= 3) return null;
  return normaliseMaterial(word);
}

const files = await listJournalFilesChronological(journalDir, { minFileStartUtcMs: 0 });
if (files.length === 0) {
  console.error(`No journals under ${journalDir}`);
  process.exit(1);
}

let organicLines = 0;

function handle(line: JournalLine): void {
  if (line.event === "Scan") {
    const key = bodyKey(line.SystemAddress, line.BodyID);
    if (!key) return;
    const mats = line.Materials as { Name?: string; Percent?: number }[] | undefined;
    const parents = line.Parents as Record<string, number>[] | undefined;
    const materials = new Map<string, number>();
    for (const m of mats ?? []) {
      const name = normaliseMaterial(String(m?.Name ?? ""));
      if (name) materials.set(name, Number(m?.Percent ?? 0));
    }
    let parentStarId: number | null = null;
    for (const p of parents ?? []) {
      if (typeof p?.Star === "number") {
        parentStarId = p.Star;
        break;
      }
    }
    const prior = bodies.get(key);
    bodies.set(key, {
      name: typeof line.BodyName === "string" ? line.BodyName : (prior?.name ?? key),
      materials: materials.size > 0 ? materials : (prior?.materials ?? materials),
      parentStarId: parentStarId ?? prior?.parentStarId ?? null,
      starType: typeof line.StarType === "string" ? line.StarType : (prior?.starType ?? null),
    });
    return;
  }

  if (line.event !== "ScanOrganic") return;
  organicLines += 1;

  const key = bodyKey(line.SystemAddress, line.Body);
  if (!key) return;

  const genus = String(line.Genus_Localised ?? "").trim();
  const species = String(line.Species_Localised ?? "").trim();
  const token = String(line.Variant ?? "").trim();
  const label = String(line.Variant_Localised ?? "").trim();
  if (!genus || !species || !token) return;

  const name = fullName(genus, species);
  const dedupe = `${key}|${name}`;
  if (seen.has(dedupe)) return;
  seen.add(dedupe);

  observations.push({
    species: name,
    bodyKey: key,
    when: String(line.timestamp ?? ""),
    variantMaterial: materialFromVariantToken(token),
    variantColour: colourFromVariant(label) ?? "",
  });
}

for (const file of files) await readJournalFull(file, handle);

/* ------------------------------------------------------------------ 1. is the material there? */

/** The parent star's class, resolved through `Parents` — not the arrival star (§10 of the notes). */
function parentStarType(key: string): string | null {
  const body = bodies.get(key);
  if (!body) return null;
  const sys = key.split(":")[0]!;
  if (body.parentStarId === null) return null;
  return bodies.get(`${sys}:${body.parentStarId}`)?.starType ?? null;
}

const materialObs = observations.filter((o) => o.variantMaterial !== null);
const withBody = materialObs.filter((o) => (bodies.get(o.bodyKey)?.materials.size ?? 0) > 0);

const namedPresent = withBody.filter((o) => bodies.get(o.bodyKey)!.materials.has(o.variantMaterial!));
const namedAbsent = withBody.filter((o) => !bodies.get(o.bodyKey)!.materials.has(o.variantMaterial!));

console.log(`journals                       ${files.length}`);
console.log(`ScanOrganic lines              ${organicLines}`);
console.log(`distinct body+species          ${observations.length}`);
console.log(`  variant names a material     ${materialObs.length}`);
console.log(`  ... and the Scan survives    ${withBody.length}`);
console.log("");
console.log("1. is the material the variant names actually on the body?");
console.log(`   present  ${namedPresent.length}`);
console.log(`   absent   ${namedAbsent.length}`);
for (const o of namedAbsent.slice(0, 10)) {
  console.log(
    `     ${o.species.padEnd(24)} ${bodies.get(o.bodyKey)!.name.padEnd(30)} names ${o.variantMaterial}`,
  );
}

/* ------------------------------------------------------------------ 2. the table, checked */

const observedMap = new Map<string, Map<string, string>>(); // species -> material -> colour
for (const o of materialObs) {
  if (!o.variantColour) continue;
  const per = observedMap.get(o.species) ?? new Map<string, string>();
  per.set(o.variantMaterial!, o.variantColour);
  observedMap.set(o.species, per);
}

let agree = 0;
const disagree: string[] = [];
const missing: string[] = [];
for (const [species, per] of observedMap) {
  const rule = tables.bySpecies[species.toLowerCase()];
  for (const [material, colour] of per) {
    const claimed = rule?.map?.[material];
    if (!claimed) missing.push(`${species}: ${material} -> ${colour} (table has no row)`);
    else if (claimed.trim().toLowerCase() === colour.toLowerCase()) agree += 1;
    else disagree.push(`${species}: ${material} -> ${colour}, table says ${claimed}`);
  }
}
console.log("\n2. ED-DSN's material -> colour rows against his own variant tokens");
console.log(`   agree     ${agree}`);
console.log(`   disagree  ${disagree.length}`);
for (const d of disagree) console.log(`     ${d}`);
if (missing.length > 0) {
  console.log(`   not in the table  ${missing.length}`);
  for (const m of missing) console.log(`     ${m}`);
}

/* ------------------------------------------------------------------ 3. the precedence */

interface Contest {
  species: string;
  body: string;
  when: string;
  winner: string;
  losers: string[];
  percent: Map<string, number>;
  star: string | null;
}

const contests: Contest[] = [];

for (const o of namedPresent) {
  const rule = ruleFor(o.species.split(" ")[0]!, o.species);
  if (rule?.source !== "material") continue;
  const body = bodies.get(o.bodyKey)!;
  const present = Object.keys(rule.map)
    .map((m) => normaliseMaterial(m))
    .filter((m) => body.materials.has(m));
  if (present.length < 2) continue;
  contests.push({
    species: o.species,
    body: body.name,
    when: o.when,
    winner: o.variantMaterial!,
    losers: present.filter((m) => m !== o.variantMaterial),
    percent: new Map(present.map((m) => [m, body.materials.get(m) ?? 0])),
    star: parentStarType(o.bodyKey),
  });
}

const pairs = new Map<string, number>();
const pairsBySpecies = new Map<string, Map<string, number>>();
for (const c of contests) {
  for (const loser of c.losers) {
    const k = `${c.winner}|${loser}`;
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
    const per = pairsBySpecies.get(c.species) ?? new Map<string, number>();
    per.set(k, (per.get(k) ?? 0) + 1);
    pairsBySpecies.set(c.species, per);
  }
}

console.log(`\n3. contested bodies (two or more of the species' materials present)  ${contests.length}`);
console.log("\n   pooled across species:");
const done = new Set<string>();
for (const [k, n] of [...pairs].sort((a, b) => b[1] - a[1])) {
  const [w, l] = k.split("|") as [string, string];
  const id = [w, l].sort().join("|");
  if (done.has(id)) continue;
  done.add(id);
  const back = pairs.get(`${l}|${w}`) ?? 0;
  console.log(
    `     ${w.padEnd(11)} vs ${l.padEnd(11)} ${back === 0 ? `${w} wins ${n}-0` : `CONTRADICTORY ${w} ${n} / ${l} ${back}`}`,
  );
}

console.log("\n   per species — a contradiction here kills the per-species form too:");
for (const [species, per] of [...pairsBySpecies].sort()) {
  const bad: string[] = [];
  const parts: string[] = [];
  for (const [k, n] of per) {
    const [w, l] = k.split("|") as [string, string];
    parts.push(`${w}>${l}×${n}`);
    if ((per.get(`${l}|${w}`) ?? 0) > 0) bad.push(`${w}/${l}`);
  }
  const flag =
    bad.length > 0
      ? `   <- CONTRADICTS on ${[...new Set(bad.map((b) => b.split("/").sort().join("/")))].join(", ")}`
      : "";
  console.log(`     ${species.padEnd(24)} ${parts.join("  ")}${flag}`);
}

/* ------------------------------------------------------------------ 4. what else might decide it */

let mostRight = 0;
let leastRight = 0;
let ties = 0;
for (const c of contests) {
  const sorted = [...c.percent].sort((a, b) => b[1] - a[1]);
  if (sorted[0]![1] === sorted[sorted.length - 1]![1]) {
    ties += 1;
    continue;
  }
  if (sorted[0]![0] === c.winner) mostRight += 1;
  if (sorted[sorted.length - 1]![0] === c.winner) leastRight += 1;
}
const scored = contests.length - ties;

console.log("\n4. if not a precedence, then what?");
console.log(
  `   abundance decides:  most abundant wins ${mostRight}/${scored}, least abundant wins ${leastRight}/${scored} (chance ≈ ${(scored / 2).toFixed(1)})`,
);

/*
  Abundance in raw per-cent is not comparable across materials — tungsten is scarcer than cadmium
  everywhere, so "the biggest number wins" is mostly a statement about which material it is. The
  fairer form of the same idea is enrichment: how does this body's share compare with that material's
  usual share? The medians come from every Scan in the commander's own journals.
*/
const medianPercent = new Map<string, number>();
{
  const samples = new Map<string, number[]>();
  for (const b of bodies.values()) {
    for (const [m, p] of b.materials) samples.set(m, [...(samples.get(m) ?? []), p]);
  }
  for (const [m, list] of samples) {
    list.sort((a, b) => a - b);
    medianPercent.set(m, list[Math.floor(list.length / 2)] ?? 0);
  }
}

let enrichedRight = 0;
let depletedRight = 0;
for (const c of contests) {
  const scoredBy = [...c.percent]
    .map(([m, p]) => [m, p / (medianPercent.get(m) || p || 1)] as const)
    .sort((a, b) => b[1] - a[1]);
  if (scoredBy[0]![0] === c.winner) enrichedRight += 1;
  if (scoredBy[scoredBy.length - 1]![0] === c.winner) depletedRight += 1;
}
console.log(
  `   enrichment decides: most enriched wins ${enrichedRight}/${contests.length}, least ${depletedRight}/${contests.length}`,
);

/*
  The standing hypothesis, written out and scored. Same rank means the pair says nothing either way,
  which is most of the tungsten/niobium/mercury rows — counting those as agreement would be flattering
  it for staying silent.
*/
const HYPOTHESIS: Record<string, number> = {
  cadmium: 0,
  molybdenum: 1,
  tin: 2,
  niobium: 3,
  mercury: 3,
  tungsten: 3,
};

let fits = 0;
let breaks = 0;
let silent = 0;
const counterexamples: string[] = [];
for (const c of contests) {
  const w = HYPOTHESIS[c.winner];
  for (const loser of c.losers) {
    const l = HYPOTHESIS[loser];
    if (w === undefined || l === undefined) continue;
    if (w === l) silent += 1;
    else if (w > l) fits += 1;
    else {
      breaks += 1;
      counterexamples.push(`${c.when.slice(0, 10)}  ${c.species}: ${c.winner} beat ${loser} on ${c.body}`);
    }
  }
}
console.log(`   the standing hypothesis (cadmium < molybdenum < tin < niobium/mercury/tungsten):`);
console.log(`     holds ${fits}, breaks ${breaks}, says nothing (equal rank) ${silent}`);
for (const x of counterexamples) console.log(`       ${x}`);

/*
  The three counterexamples are all Fumerola, which is the shape of a genus with its own order rather
  than of noise. Grouping by genus asks that directly: does each genus's own evidence hold together,
  and does any genus contradict itself?
*/
const genusOf = (species: string) => species.split(" ")[0]!;
const byGenus = new Map<string, Map<string, number>>();
for (const c of contests) {
  for (const loser of c.losers) {
    const per = byGenus.get(genusOf(c.species)) ?? new Map<string, number>();
    per.set(`${c.winner}|${loser}`, (per.get(`${c.winner}|${loser}`) ?? 0) + 1);
    byGenus.set(genusOf(c.species), per);
  }
}
console.log("\n   by genus (> means beats):");
for (const [genus, per] of [...byGenus].sort()) {
  const seenPair = new Set<string>();
  const parts: string[] = [];
  let selfContradiction = false;
  for (const [k, n] of per) {
    const [w, l] = k.split("|") as [string, string];
    const id = [w, l].sort().join("|");
    if (seenPair.has(id)) continue;
    seenPair.add(id);
    const back = per.get(`${l}|${w}`) ?? 0;
    if (back > 0) {
      selfContradiction = true;
      parts.push(`${w}/${l} BOTH WAYS (${n}/${back})`);
    } else parts.push(`${w}>${l}${n > 1 ? `×${n}` : ""}`);
  }
  let fitsG = 0;
  let breaksG = 0;
  for (const c of contests) {
    if (genusOf(c.species) !== genus) continue;
    for (const loser of c.losers) {
      const w = HYPOTHESIS[c.winner];
      const l = HYPOTHESIS[loser];
      if (w === undefined || l === undefined || w === l) continue;
      w > l ? (fitsG += 1) : (breaksG += 1);
    }
  }
  const vs = `  [vs the hypothesis: ${fitsG} hold, ${breaksG} break]`;
  console.log(
    `     ${genus.padEnd(11)} ${parts.join("  ")}${selfContradiction ? "  <- CONTRADICTS ITSELF" : ""}${vs}`,
  );
}

/* Does the parent star's class split the contradictions? */
const byPair = new Map<string, Contest[]>();
for (const c of contests) {
  for (const loser of c.losers) {
    const id = [c.winner, loser].sort().join("|");
    byPair.set(id, [...(byPair.get(id) ?? []), c]);
  }
}
console.log("   the parent star on the contradicting pairs:");
let shown = 0;
for (const [id, list] of byPair) {
  const [a, b] = id.split("|") as [string, string];
  const winners = new Set(list.map((c) => c.winner));
  if (winners.size < 2) continue;
  shown += 1;
  console.log(`     ${a} vs ${b}:`);
  for (const c of list) {
    console.log(
      `       ${c.species.padEnd(22)} ${c.body.padEnd(34)} won ${c.winner.padEnd(11)} star ${c.star ?? "?"}`,
    );
  }
}
if (shown === 0) console.log("     none — no pair was won by both sides");

if (showRows) {
  console.log("\nevery contested body:");
  for (const c of contests) {
    const mats = [...c.percent].map(([m, p]) => `${m} ${p.toFixed(2)}%`).join(", ");
    console.log(
      `  ${c.when.slice(0, 10)}  ${c.species.padEnd(24)} ${c.body.padEnd(34)} won ${c.winner.padEnd(11)} star ${(c.star ?? "?").padEnd(4)} [${mats}]`,
    );
  }
}
