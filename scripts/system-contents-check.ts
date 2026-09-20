/**
 * Could the app answer the companion-body conditions it currently shrugs at?
 *
 * `speciesTreeLoader.detectPredictionUnsupported` keeps `predictionUnsupported` on Amphora plant and
 * the Brain Trees because their condition needs a *different* body in the same system — an Earth-like
 * world, an ammonia world, a water giant, a gas giant with life. Nothing in the matcher's inputs
 * answers that, so the rows are listed and never predicted.
 *
 * The merge cache does hold the sibling scans. This asks whether that is enough in practice: how
 * often those species are candidates, and how often the system's other bodies are known well enough
 * for the test to come back yes or no rather than "not scanned".
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { loadJournalMergeCacheForTool } from "./probeCache.js";
import type { BodyExoState, ExplorationScanRecord } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);
const payload = loadJournalMergeCacheForTool();
const bodies: BodyExoState[] = payload.bodies.map(([, b]) => b);

/** The classes Amphora's row names, in journal spelling. */
const WANTED = [
  "earthlike body",
  "ammonia world",
  "water giant",
  "gas giant with water based life",
  "gas giant with ammonia based life",
];

const bySystem = new Map<number, ExplorationScanRecord[]>();
for (const [, r] of [...(payload.soldExplorationScans ?? []), ...payload.explorationScans]) {
  bySystem.set(r.systemAddress, [...(bySystem.get(r.systemAddress) ?? []), r]);
}

const norm = (s: string) => s.trim().toLowerCase();

let candidates = 0;
let demoted = 0;
let alreadyGone = 0;
let shown = 0;
let systemsKnown = 0;
let wouldPass = 0;
let wouldFail = 0;
const perSpecies = new Map<string, { rows: number; pass: number; fail: number; unknown: number }>();

for (const b of bodies) {
  // The panel's population: a body the FSS says has biology on it. Amphora is a candidate on plenty
  // of metal-rich bodies with no signal at all, and counting those overstates what he actually sees.
  if (!b.scan?.PlanetClass?.trim() || (b.biologicalSignals ?? 0) <= 0) continue;
  /*
    The merge cache carries the sibling scans but not `FSSAllBodiesFound`, so completeness is assumed
    here. That makes this the *upper bound* on what the gate removes: the app itself abstains until
    the honk is finished, and will therefore demote fewer than this.
  */
  const siblingClasses = (bySystem.get(b.systemAddress) ?? [])
    .filter((r) => r.bodyId !== b.bodyId)
    .map((r) => r.planetClass?.trim())
    .filter((x): x is string => Boolean(x));

  const matches = matchDatabaseToScan(db, b.scan, null, null, {
    includeBacterium: true,
    biologicalSignals: b.biologicalSignals,
    matchContext: { systemBodyClasses: [...new Set(siblingClasses)], systemBodyListComplete: true },
  }).matches;

  /*
    The rows the companion-body gate judges. Before it existed these were `predictionUnsupported` --
    listed, never predicted; now they are ordinary candidates that the gate can demote, so the thing
    worth counting is the split between the two tiers.
  */
  const flagged = matches.filter((m) => m.entry.criteria?.systemBodyClassesAnyOf?.length);
  if (flagged.length === 0) continue;

  const siblings = bySystem.get(b.systemAddress) ?? [];
  const classes = new Set(siblings.map((r) => norm(r.planetClass ?? "")).filter(Boolean));
  const known = siblings.length > 1;
  const hit = WANTED.some((w) => classes.has(w));

  for (const m of flagged) {
    candidates += 1;
    /*
      Attribute the demotion. Amphora is already demoted on most bodies by its own gates -- an
      A-class star, airless, metal-rich -- so counting every `unlikely` row as this gate's work
      credits it with 1,493 rows it never touched. Only the reason it writes says it was this one.
    */
    const mine = m.unlikelyReasons?.some((r) => r.field === "System bodies") === true;
    if (mine) demoted += 1;
    else if (m.unlikely) alreadyGone += 1;
    else shown += 1;
    const e = perSpecies.get(m.entry.displayName) ?? { rows: 0, pass: 0, fail: 0, unknown: 0 };
    e.rows += 1;
    if (!known) e.unknown += 1;
    else if (hit) e.pass += 1;
    else e.fail += 1;
    perSpecies.set(m.entry.displayName, e);
  }
  if (known) {
    systemsKnown += 1;
    hit ? (wouldPass += 1) : (wouldFail += 1);
  }
}

console.log(`rows carrying a companion-body rule    ${candidates}`);
console.log(`  demoted by THIS gate                 ${demoted}`);
console.log(`  already demoted by another gate      ${alreadyGone}`);
console.log(`  still shown                          ${shown}`);
console.log(`bodies whose system is scanned at all  ${systemsKnown}`);
console.log(`  a companion body is present          ${wouldPass}`);
console.log(`  none present (the row could be cut)  ${wouldFail}`);
console.log("");
for (const [name, e] of [...perSpecies].sort((a, b) => b[1].rows - a[1].rows)) {
  console.log(
    `  ${name.padEnd(28)} rows ${String(e.rows).padStart(5)}   companion ${String(e.pass).padStart(4)}   none ${String(e.fail).padStart(5)}   system unscanned ${e.unknown}`,
  );
}
