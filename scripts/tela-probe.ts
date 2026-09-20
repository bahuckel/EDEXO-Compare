/**
 * Why Bacterium tela is offered on nearly every body, and what would narrow it without losing it.
 *
 * The owner's report: "I shouldn't be getting Tela as a suggestion for every single body with 1 bio
 * signal". The cause is visible in `data/species/bacterium/bacterium_new.json` before any measurement
 * — tela's entire condition set is:
 *
 *     "atmosphere": "Any thin atmosphere",  "atmospherePressureCategory": "thin"
 *
 * No temperature, no gravity, no pressure, no body class, no star, no volcanism. Every landable
 * thin-atmosphere body passes, which is very nearly the definition of a bio body. The volcanism gate
 * it used to carry was removed for good reason (84.8 % of its corpus has none — see the
 * `_volcanismNote` and `tests/bacteriumTelaVolcanism.test.ts`), and nothing replaced it.
 *
 * The feeder profile says tela is not actually unbounded. Across 836 corpus bodies it sits inside
 * gravity 0.036-0.603 g, pressure 0.0012-0.0985 atm, 20-698 K, three body classes and ten atmosphere
 * types. This probe asks what each of those bounds would cost and buy, on this commander's cache:
 *
 *   1. **How often is tela offered**, over every FSS body with a signal, split by signal count — and
 *      the same figure for every other species, because "offered a lot" only means something against
 *      what the others do. A generalist that is genuinely everywhere is not a defect.
 *   2. **How often is it actually there** — the ambient rate, from his own confirmed scans. A species
 *      offered on 90 % of bodies and found on 30 % of them is over-offered by a measurable amount.
 *   3. **What each candidate bound would remove**, and — the number that decides it — **how many of
 *      his own confirmed tela bodies each one would throw away**. A gate that loses a true body is
 *      worse than the hedge it replaces.
 *
 * Nothing is changed here. The condition rows are data and the owner decides data.
 *
 *   npx tsx scripts/tela-probe.ts
 *   npx tsx scripts/tela-probe.ts --species "Bacterium cerbrus"   # the same report for another
 */
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { collectResolvedOrganicLockSpeciesIds } from "../src/server/organicLocks.js";
import { loadJournalMergeCacheForTool } from "./probeCache.js";
import { regionIndexForSystem, regionForSystem } from "../src/server/regionMapData.js";
import { resolveHostStarBodyId } from "../src/server/orbitUtils.js";
import { journalHostObservationFromSpeciesContext } from "../src/server/journalHostObservation.js";
import { rankSpeciesOnBody, REGION_PRIOR_WEIGHT } from "../src/server/speciesLikelihood.js";
import { demoteBelowPresenceFloor, PRESENCE_FLOOR_PCT } from "../src/server/snapshot.js";
import { genusShares } from "../src/shared/systemTriage.js";
import type {
  BodyExoState,
  ExplorationScanRecord,
  SpeciesEntry,
  SpeciesMatchContext,
} from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const wantedName = (() => {
  const i = argv.indexOf("--species");
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : "Bacterium tela";
})();

const db = loadSpeciesDatabaseFromTree(root);
const target = db.species.find((e) => e.displayName.toLowerCase() === wantedName.toLowerCase());
if (!target) {
  console.error(`No species called ${wantedName}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ the profile's own bounds */

interface Numeric {
  min: number;
  max: number;
  count: number;
}

function loadProfile(entry: SpeciesEntry): {
  numerics: Record<string, Numeric>;
  categorical: Record<string, Record<string, number>>;
  sampleCount: number;
} | null {
  const slug = entry.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const file = path.join(
    root,
    "data",
    "species",
    entry.genusDataDir,
    "exomastery",
    `${slug}_exomastery.json`,
  );
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as {
    numerics: Record<string, Numeric>;
    categorical: Record<string, Record<string, number>>;
    sampleCount: number;
  };
}

const profile = loadProfile(target);

/* ------------------------------------------------------------------ the cache */

const payload = loadJournalMergeCacheForTool();
const bodies: BodyExoState[] = payload.bodies.map(([, b]) => b);
const systemPositions = new Map<number, { x: number; y: number; z: number }>(payload.systemPositions ?? []);

const scansBySystem = new Map<number, Map<number, ExplorationScanRecord>>();
for (const [, r] of [...(payload.soldExplorationScans ?? []), ...payload.explorationScans]) {
  const byId = scansBySystem.get(r.systemAddress) ?? new Map<number, ExplorationScanRecord>();
  byId.set(r.bodyId, r);
  scansBySystem.set(r.systemAddress, byId);
}

/** The same context the app builds; without it every star and region term measures as absent. */
function matchContextFor(b: BodyExoState): SpeciesMatchContext | undefined {
  const byId = scansBySystem.get(b.systemAddress);
  const rec = byId?.get(b.bodyId);
  const ctx: SpeciesMatchContext = {};
  const pos = systemPositions.get(b.systemAddress);
  if (pos) {
    const idx = regionIndexForSystem(root, pos.x, pos.z);
    if (idx != null && idx > 0) {
      const name = regionForSystem(root, pos.x, pos.y, pos.z);
      if (name) {
        ctx.regionName = name;
        ctx.regionIndex = idx;
      }
    }
  }
  if (!byId || !rec) return Object.keys(ctx).length ? ctx : undefined;
  const starId = resolveHostStarBodyId(rec, byId);
  const star = starId == null ? null : byId.get(starId);
  if (star?.starType?.trim()) {
    ctx.parentStarType = star.starType;
    if (typeof star.subclass === "number" && Number.isFinite(star.subclass))
      ctx.parentStarSubclass = star.subclass;
    if (star.luminosity?.trim()) ctx.parentStarLuminosity = star.luminosity;
  }
  return Object.keys(ctx).length ? ctx : undefined;
}

/* ------------------------------------------------------------------ pass one: who is offered where */

/** Every truth species' own within-genus share, for the recall side of a post-DSS floor. */
const truthShares: { body: string; species: string; sharePct: number; genusRows: number }[] = [];

interface Seen {
  body: BodyExoState;
  signals: number;
  offeredTarget: boolean;
  truth: string[];
  star: string | null;
  region: string | null;
  /** 1 = the panel's top row. Null when it was not offered or the model could not score it. */
  rank: number | null;
  /** The same number the panel prints as "chance here". */
  presencePct: number | null;
  shownCount: number;
  /** Survived `demoteBelowPresenceFloor`, which is what the panel actually renders. */
  offeredAfterFloor: boolean;
  pctAtFloor: number | null;
  genusSharePct: number | null;
  /** How many candidates share its genus on this body — 2 means "the only other thing it could be". */
  genusRowCount: number;
  flags: { approximate: boolean; analysisComplete: boolean; unmeasured: boolean } | null;
  shownAfterFloor: number;
  /** The post-DSS list, before any floor. */
  offeredWithHints: boolean;
  /** The post-DSS list the panel actually renders, once the floor has run. */
  shownWithHintsAfterFloor: boolean;
  hintedGenera: number;
}

const seen: Seen[] = [];
const offeredCount = new Map<string, number>();
const truthCount = new Map<string, number>();
let fssBodies = 0;

for (const b of bodies) {
  const sig = b.biologicalSignals ?? 0;
  if (sig <= 0 || !b.scan?.PlanetClass?.trim()) continue;
  fssBodies += 1;

  const ctx = matchContextFor(b);
  /*
    FSS-only, which is the case the owner is complaining about: the list he reads before deciding
    whether to fly there. Genus hints arrive with the DSS, after the trip is paid for.
  */
  const matches = matchDatabaseToScan(db, b.scan, null, null, {
    includeBacterium: true,
    matchContext: ctx,
    biologicalSignals: b.biologicalSignals,
  }).matches.filter((m) => !m.unlikely);

  for (const id of new Set(matches.map((m) => m.entry.id))) {
    offeredCount.set(id, (offeredCount.get(id) ?? 0) + 1);
  }

  const truth = collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db);
  for (const id of new Set(truth)) truthCount.set(id, (truthCount.get(id) ?? 0) + 1);

  /*
    The panel's own ordering, not a re-derivation: `attachPresenceProbability` in `snapshot.ts` calls
    exactly this, with the region prior on, and multiplies the normalised share by the signal count.
    Listing a species and ranking it last are different complaints and this is what separates them.
  */
  const rec = scansBySystem.get(b.systemAddress)?.get(b.bodyId) ?? null;
  const host = ctx ? journalHostObservationFromSpeciesContext(ctx) : null;
  const { ranked } = rankSpeciesOnBody(matches, b.scan, rec, host, {
    root,
    regionPrior: true,
    regionIndex: ctx?.regionIndex ?? null,
    regionPriorWeight: REGION_PRIOR_WEIGHT,
  });
  const order = [...ranked].sort((a, x) => x.probability - a.probability);
  const at = order.findIndex((r) => r.match.entry.id === target.id);
  const scale = sig > 0 ? sig : 1;

  /*
    The floor the panel ships. `demoteBelowPresenceFloor` reads `presenceProbabilityPercent`, which
    `snapshot.ts` writes from exactly the ranking above, so the numbers have to be attached before it
    is called or every row looks unmeasured and immune. Measuring the matcher's raw list and calling
    it "what he sees" was this probe's first mistake.
  */
  for (const r of ranked) {
    const p = Math.max(0, Math.min(1, r.probability * scale));
    r.match.presenceProbabilityPercent = Math.round(p * 1000) / 10;
  }
  const targetMatch = matches.find((m) => m.entry.id === target.id) ?? null;
  const targetPctBefore = targetMatch?.presenceProbabilityPercent ?? null;
  const targetFlags = targetMatch
    ? {
        approximate: targetMatch.approximateMatch === true,
        analysisComplete: targetMatch.organicAnalysisComplete === true,
        unmeasured: targetPctBefore == null || !Number.isFinite(targetPctBefore),
      }
    : null;
  // The matcher returns rows before the snapshot decorates them with photo and price; the floor
  // reads neither.
  demoteBelowPresenceFloor(matches as unknown as Parameters<typeof demoteBelowPresenceFloor>[0], b, db);
  const afterFloor = matches.filter((m) => !m.unlikely);

  /*
    Post-DSS. The probes have named the genera, the matcher drops everything outside them, and the
    floor is skipped on purpose — nothing left is a guess about whether the genus is there. If tela
    is what he sees on every body, this is the list it would be on.
  */
  /*
    Within-genus share, the number the panel already computes as `genusSharePercent`. After a DSS the
    genus is settled and this is the only open question, so it — not the presence probability — is
    what a post-DSS floor would have to read.
  */
  const shareRows = ranked.map((r) => ({ genus: r.match.entry.genusDataDir, probability: r.probability, r }));
  const shareMap = genusShares(shareRows);
  const targetShareRow = shareRows.find((row) => row.r.match.entry.id === target.id) ?? null;
  const targetGenusShare = targetShareRow ? (shareMap.get(targetShareRow) ?? null) : null;

  if (b.genusHints?.length && truth.length > 0) {
    /*
      The cost side. A floor is only worth having if it hides noise and not answers, and the only
      answers on record are the species he actually confirmed. Their share is read off the same
      hinted list the panel would floor.
    */
    const hintedMatches = matchDatabaseToScan(db, b.scan, b.genusHints, null, {
      includeBacterium: true,
      matchContext: ctx,
      biologicalSignals: b.biologicalSignals,
    }).matches.filter((m) => !m.unlikely);
    const hintedRanked = rankSpeciesOnBody(hintedMatches, b.scan, rec, host, {
      root,
      regionPrior: true,
      regionIndex: ctx?.regionIndex ?? null,
      regionPriorWeight: REGION_PRIOR_WEIGHT,
    }).ranked;
    const rows = hintedRanked.map((r) => ({
      genus: r.match.entry.genusDataDir,
      probability: r.probability,
      r,
    }));
    const shares = genusShares(rows);
    for (const id of new Set(truth)) {
      const row = rows.find((x) => x.r.match.entry.id === id);
      if (!row) continue;
      const share = shares.get(row);
      if (share == null) continue;
      truthShares.push({
        body: b.bodyName,
        species: db.species.find((e) => e.id === id)?.displayName ?? id,
        sharePct: share * 100,
        genusRows: rows.filter((x) => x.genus === row.genus).length,
      });
    }
  }

  let hinted: typeof matches = [];
  let hintedAfterFloor: typeof matches = [];
  if (b.genusHints?.length) {
    hinted = matchDatabaseToScan(db, b.scan, b.genusHints, null, {
      includeBacterium: true,
      matchContext: ctx,
      biologicalSignals: b.biologicalSignals,
    }).matches.filter((m) => !m.unlikely);
    /*
      The post-DSS panel end to end: rank, write the two percentages the snapshot writes, then let
      the floor judge. Without the percentages every row reads as unmeasured and the floor is a no-op,
      which is the shape of a measurement that always agrees with itself.
    */
    const hr = rankSpeciesOnBody(hinted, b.scan, rec, host, {
      root,
      regionPrior: true,
      regionIndex: ctx?.regionIndex ?? null,
      regionPriorWeight: REGION_PRIOR_WEIGHT,
    }).ranked;
    for (const r of hr) {
      const p = Math.max(0, Math.min(1, r.probability * scale));
      r.match.presenceProbabilityPercent = Math.round(p * 1000) / 10;
    }
    const hrRows = hr.map((r) => ({ genus: r.match.entry.genusDataDir, probability: r.probability, r }));
    const hrShares = genusShares(hrRows);
    for (const row of hrRows) {
      const sh = hrShares.get(row);
      row.r.match.genusSharePercent = sh == null ? null : Math.round(sh * 1000) / 10;
    }
    demoteBelowPresenceFloor(hinted as unknown as Parameters<typeof demoteBelowPresenceFloor>[0], b, db);
    hintedAfterFloor = hinted.filter((m) => !m.unlikely);
  }

  seen.push({
    body: b,
    signals: sig,
    offeredAfterFloor: afterFloor.some((m) => m.entry.id === target.id),
    pctAtFloor: targetPctBefore,
    genusSharePct: targetGenusShare == null ? null : targetGenusShare * 100,
    genusRowCount: targetShareRow ? shareRows.filter((row) => row.genus === targetShareRow.genus).length : 0,
    flags: targetFlags,
    shownAfterFloor: afterFloor.length,
    offeredWithHints: hinted.some((m) => m.entry.id === target.id),
    shownWithHintsAfterFloor: hintedAfterFloor.some((m) => m.entry.id === target.id),
    hintedGenera: b.genusHints?.length ?? 0,
    offeredTarget: matches.some((m) => m.entry.id === target.id),
    truth,
    star: ctx?.parentStarType ?? null,
    region: ctx?.regionName ?? null,
    rank: at >= 0 ? at + 1 : null,
    presencePct: at >= 0 ? Math.min(100, order[at]!.probability * scale * 100) : null,
    shownCount: matches.length,
  });
}

const bySignals = new Map<number, { total: number; offered: number; floored: number }>();
for (const s of seen) {
  const key = s.signals >= 4 ? 4 : s.signals;
  const e = bySignals.get(key) ?? { total: 0, offered: 0, floored: 0 };
  e.total += 1;
  if (s.offeredTarget) e.offered += 1;
  if (s.offeredAfterFloor) e.floored += 1;
  bySignals.set(key, e);
}

const offeredTotal = offeredCount.get(target.id) ?? 0;

console.log(`${target.displayName}`);
console.log(`conditions: ${JSON.stringify(target.criteria)}`.slice(0, 300));
console.log("");
const afterFloorTotal = seen.filter((s) => s.offeredAfterFloor).length;
const hintBodies = seen.filter((s) => s.hintedGenera > 0);
const hintOffered = hintBodies.filter((s) => s.offeredWithHints).length;

console.log(`bodies with a bio signal and a scan   ${fssBodies}`);
console.log(
  `the matcher lets it through on        ${offeredTotal} (${((offeredTotal / fssBodies) * 100).toFixed(1)} %)`,
);
console.log(
  `the panel still shows it on           ${afterFloorTotal} (${((afterFloorTotal / fssBodies) * 100).toFixed(1)} %)   <- after the ${PRESENCE_FLOOR_PCT} % floor`,
);
console.log(
  `post-DSS list, before any floor       ${hintOffered} of ${hintBodies.length} hinted bodies (${((hintOffered / Math.max(1, hintBodies.length)) * 100).toFixed(1)} %)`,
);
console.log("\nby signal count:");
for (const key of [...bySignals.keys()].sort()) {
  const e = bySignals.get(key)!;
  const label = key >= 4 ? "4+" : String(key);
  console.log(
    `  ${label} signal(s)  matcher ${String(e.offered).padStart(5)} of ${String(e.total).padStart(5)} (${((e.offered / e.total) * 100).toFixed(1).padStart(5)} %)   panel ${String(e.floored).padStart(5)} (${((e.floored / e.total) * 100).toFixed(1).padStart(5)} %)`,
  );
}

/* The ambient comparison: a generalist that really is everywhere is not a defect. */
console.log("\nmost-offered species, for scale:");
const leaderboard = [...offeredCount].sort((a, b) => b[1] - a[1]).slice(0, 12);
for (const [id, n] of leaderboard) {
  const e = db.species.find((s) => s.id === id);
  const found = truthCount.get(id) ?? 0;
  const mark = id === target.id ? "  <-" : "";
  console.log(
    `  ${(e?.displayName ?? id).padEnd(26)} offered ${String(n).padStart(5)} (${((n / fssBodies) * 100).toFixed(1).padStart(5)} %)  confirmed ${String(found).padStart(4)}${mark}`,
  );
}

/* ------------------------------------------------------------------ where does it sit in the list */

/*
  "Offered" and "offered near the top" are different complaints with different fixes. If a species is
  listed on every body but ranked last at 2 %, the model already knows and the list simply has no
  floor. If it is ranked first, the model does not know and a condition row is missing.
*/
const ranksSeen = seen.filter((s) => s.rank != null);
const rankBuckets = new Map<string, number>();
for (const s of ranksSeen) {
  const key = s.rank === 1 ? "1st" : s.rank! <= 3 ? "2nd-3rd" : s.rank! <= 6 ? "4th-6th" : "7th or worse";
  rankBuckets.set(key, (rankBuckets.get(key) ?? 0) + 1);
}
const pcts = ranksSeen.map((s) => s.presencePct ?? 0).sort((a, b) => a - b);
const median = pcts.length ? pcts[Math.floor(pcts.length / 2)]! : 0;
const p90 = pcts.length ? pcts[Math.floor(pcts.length * 0.9)]! : 0;

console.log("\nwhere it sits in the panel's own ordering:");
for (const key of ["1st", "2nd-3rd", "4th-6th", "7th or worse"]) {
  const n = rankBuckets.get(key) ?? 0;
  console.log(
    `  ${key.padEnd(14)} ${String(n).padStart(5)}  ${((n / Math.max(1, ranksSeen.length)) * 100).toFixed(1)} %`,
  );
}
console.log(`  chance-here: median ${median.toFixed(1)} %, 90th percentile ${p90.toFixed(1)} %`);
console.log(
  `  shown list length: median ${[...seen.map((s) => s.shownCount)].sort((a, b) => a - b)[Math.floor(seen.length / 2)]} candidates`,
);

const found = seen.filter((s) => s.truth.includes(target.id));
for (const s of found) {
  console.log(
    `  where it really grew: ${s.body.bodyName} — ranked ${s.rank} of ${s.shownCount} at ${(s.presencePct ?? 0).toFixed(1)} %`,
  );
}

/*
  A row under the floor that the panel still shows got there one of three ways, and they need
  different fixes: it was the single best row on a body where nothing cleared (by design), the model
  had no opinion at all (`presenceProbabilityPercent` null, which is "unmeasured" and immune), or it
  was flagged approximate. Counting them apart is the difference between a data gap and a bug.
*/
/*
  The floor does not run at all on a body the commander has already probed: `demoteBelowPresenceFloor`
  returns early when `genusHints` are present, on the argument that the probes have named the genera
  so nothing left is a guess about whether the genus is there. That early return is why a first cut
  of this breakdown reported 357 rows as "the single best row on a body where nothing cleared" when
  the truth is that the floor never looked at them.

  So the two populations have to be counted apart. Every body in his cache that he actually landed on
  carries hints, which is exactly the set he is looking at when he complains.
*/
const preDss = seen.filter((s) => s.hintedGenera === 0);
const postDss = seen.filter((s) => s.hintedGenera > 0);
const preShown = preDss.filter((s) => s.offeredAfterFloor);
const preUnderFloor = preShown.filter((s) => (s.pctAtFloor ?? 0) < PRESENCE_FLOOR_PCT);

console.log(`
the two populations, counted apart:`);
console.log(
  `  never probed (the floor runs)   ${preDss.length} bodies, shown on ${preShown.length} (${((preShown.length / Math.max(1, preDss.length)) * 100).toFixed(1)} %)`,
);
console.log(`    of those, under the floor and kept as the single best row  ${preUnderFloor.length}`);
console.log(
  `  probed (the genus-share floor)  ${postDss.length} bodies, shown on ${postDss.filter((s) => s.offeredWithHints).length} (${((postDss.filter((s) => s.offeredWithHints).length / Math.max(1, postDss.length)) * 100).toFixed(1)} %)`,
);
const postUnder = postDss.filter((s) => s.offeredWithHints && (s.pctAtFloor ?? 0) < PRESENCE_FLOOR_PCT);
console.log(
  `    after the floor, the panel shows it on ${postDss.filter((s) => s.shownWithHintsAfterFloor).length} of them`,
);
console.log(
  `    of those, rows the floor would have hidden  ${postUnder.length} (${((postUnder.length / Math.max(1, postDss.length)) * 100).toFixed(1)} % of probed bodies)`,
);

/*
  What a post-DSS floor would have to read. "Is the genus here" is settled by the probe; "which
  species" is not, and that is `genusSharePercent`.
*/
const sharesOnProbed = postDss
  .filter((s) => s.offeredWithHints && s.genusSharePct != null)
  .map((s) => s.genusSharePct!)
  .sort((a, b) => a - b);
if (sharesOnProbed.length > 0) {
  const at = (q: number) =>
    sharesOnProbed[Math.min(sharesOnProbed.length - 1, Math.floor(q * sharesOnProbed.length))]!;
  console.log(
    `    its share within its own genus on those bodies: median ${at(0.5).toFixed(1)} %, 25th ${at(0.25).toFixed(1)} %, 75th ${at(0.75).toFixed(1)} %`,
  );
  for (const cut of [2, 5, 10]) {
    const hidden = sharesOnProbed.filter((x) => x < cut).length;
    console.log(
      `      a ${cut} % within-genus floor would hide it on ${hidden} of ${sharesOnProbed.length} probed bodies`,
    );
  }
  /*
    `presenceFloor.test.ts` already settled one case the other way: after a DSS a runner-up is "the
    only other thing it could be". That argument holds when the genus has two candidates and thins out
    as the list grows, so the sizes matter before a floor is allowed to overrule it.
  */
  const hiddenAt5 = postDss.filter((s) => s.offeredWithHints && (s.genusSharePct ?? 100) < 5);
  const pairs = hiddenAt5.filter((s) => s.genusRowCount <= 2).length;
  console.log(
    `      of the ${hiddenAt5.length} it would hide, ${pairs} are on a body where its genus has 2 or fewer candidates`,
  );
}
for (const s of seen.filter((x) => x.truth.includes(target.id))) {
  console.log(
    `    where it really grew: ${s.body.bodyName} — chance ${(s.pctAtFloor ?? 0).toFixed(1)} %, within-genus ${(s.genusSharePct ?? 0).toFixed(1)} %`,
  );
}

/*
  Where it sits, split by atmosphere.

  The genus comparison says tela is a Water/Neon-rich species, not a catch-all. If the ranking model
  already knows that, its rank on a Water body will be near the top and on a carbon-dioxide body near
  the bottom, and "promote it on its best atmospheres" is already done. This is the check before
  building anything.
*/
const atmKey = (r: Seen) => (r.body.scan?.AtmosphereType ?? "(none)").replace(/^(hot\s+)?thin\s+/i, "");
const byAtmRank = new Map<string, { n: number; rank1: number; top3: number; pct: number[] }>();
for (const s of seen) {
  if (s.rank == null) continue;
  const k = atmKey(s);
  const e = byAtmRank.get(k) ?? { n: 0, rank1: 0, top3: 0, pct: [] };
  e.n += 1;
  if (s.rank === 1) e.rank1 += 1;
  if (s.rank <= 3) e.top3 += 1;
  e.pct.push(s.presencePct ?? 0);
  byAtmRank.set(k, e);
}
console.log("\nwhere tela ranks, by the body's atmosphere:");
console.log(
  `  ${"atmosphere".padEnd(20)} ${"bodies".padStart(7)} ${"1st".padStart(7)} ${"top 3".padStart(7)} ${"median chance".padStart(14)}`,
);
for (const [k, e] of [...byAtmRank].sort((a, b) => b[1].n - a[1].n)) {
  if (e.n < 5) continue;
  const med = [...e.pct].sort((a, b) => a - b)[Math.floor(e.pct.length / 2)] ?? 0;
  console.log(
    `  ${k.padEnd(20)} ${String(e.n).padStart(7)} ${`${((e.rank1 / e.n) * 100).toFixed(0)} %`.padStart(7)} ${`${((e.top3 / e.n) * 100).toFixed(0)} %`.padStart(7)} ${`${med.toFixed(1)} %`.padStart(14)}`,
  );
}

/* ------------------------------------------------------------------ pass two: is it actually there */

const truthBodies = seen.filter((s) => s.truth.length > 0);
const targetTruth = truthBodies.filter((s) => s.truth.includes(target.id));
const offeredOnTruthBody = truthBodies.filter((s) => s.offeredTarget);
const offeredAndRight = offeredOnTruthBody.filter((s) => s.truth.includes(target.id));

/*
  A body is "complete" when its distinct truth genera equal the FSS signal count: nothing there went
  unsampled, so a candidate outside the truth set is provably wrong rather than merely unconfirmed.
  On any other body an offer that was not found may simply be a plant he walked past.
*/
const genusOf = (id: string) => db.species.find((e) => e.id === id)?.genusDataDir ?? null;
const complete = truthBodies.filter((s) => {
  const genera = new Set(s.truth.map(genusOf).filter(Boolean));
  return genera.size === s.signals;
});
const completeOffered = complete.filter((s) => s.offeredTarget);
const completeRight = completeOffered.filter((s) => s.truth.includes(target.id));

console.log(`\nagainst his own confirmed scans:`);
console.log(`  bodies with any confirmed species    ${truthBodies.length}`);
console.log(
  `  ... where it was actually found      ${targetTruth.length} (ambient ${((targetTruth.length / truthBodies.length) * 100).toFixed(1)} %)`,
);
console.log(`  ... where it was offered             ${offeredOnTruthBody.length}`);
console.log(`  offered and found                    ${offeredAndRight.length}`);
console.log(
  `  on fully-sampled bodies only:        offered ${completeOffered.length}, found ${completeRight.length}` +
    (completeOffered.length
      ? `  -> precision ${((completeRight.length / completeOffered.length) * 100).toFixed(1)} %`
      : ""),
);

/* ------------------------------------------------------------------ spelling, journal vs corpus */

/*
  The journal and the feeder corpus do not spell these the same way, and comparing them raw is how
  the first run of this probe reported that 1,438 of 1,438 bodies were "outside" tela's atmosphere
  set. The journal says `SulphurDioxide` and `High metal content body`; the corpus, which follows
  Spansh, says `Thin Sulphur dioxide` and `High metal content world`. Both get flattened to a key.
*/
function atmosphereKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^(hot\s+)?(thin|thick)\s+/, "")
    .replace(/[\s_-]+/g, "");
}

function bodyClassKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+(body|world)$/, "")
    .replace(/[\s_-]+/g, "");
}

/* ------------------------------------------------------------------ pass three: what would a bound cost */

const g = (b: BodyExoState) => (b.scan?.SurfaceGravity ?? NaN) / 9.80665;
const tempK = (b: BodyExoState) => b.scan?.SurfaceTemperature ?? NaN;
const pressureAtm = (b: BodyExoState) => (b.scan?.SurfacePressure ?? NaN) / 101_325;
const atmType = (b: BodyExoState) => (b.scan?.AtmosphereType ?? "").trim();
const planetClass = (b: BodyExoState) => (b.scan?.PlanetClass ?? "").trim();

interface Bound {
  name: string;
  /** True when the body is OUTSIDE what the corpus has ever shown for this species. */
  outside: (b: BodyExoState) => boolean;
  describe: string;
}

const bounds: Bound[] = [];
if (profile) {
  const grav = profile.numerics["body.gravity"];
  const temp = profile.numerics["body.surfaceTemperature"];
  const pres = profile.numerics["body.surfacePressure"];
  const atmos = profile.categorical["body.atmosphereType"] ?? {};
  const sub = profile.categorical["body.subType"] ?? {};

  if (grav) {
    bounds.push({
      name: "gravity",
      describe: `outside ${grav.min.toFixed(3)}-${grav.max.toFixed(3)} g`,
      outside: (b) => Number.isFinite(g(b)) && (g(b) < grav.min || g(b) > grav.max),
    });
  }
  if (temp) {
    bounds.push({
      name: "temperature",
      describe: `outside ${temp.min.toFixed(0)}-${temp.max.toFixed(0)} K`,
      outside: (b) => Number.isFinite(tempK(b)) && (tempK(b) < temp.min || tempK(b) > temp.max),
    });
  }
  if (pres) {
    bounds.push({
      name: "pressure",
      describe: `outside ${pres.min.toFixed(4)}-${pres.max.toFixed(4)} atm`,
      outside: (b) =>
        Number.isFinite(pressureAtm(b)) && (pressureAtm(b) < pres.min || pressureAtm(b) > pres.max),
    });
  }
  const atmosSet = new Set(Object.keys(atmos).map(atmosphereKey));
  if (atmosSet.size > 0) {
    bounds.push({
      name: "atmosphere type",
      describe: `not one of the ${atmosSet.size} it has been seen on`,
      outside: (b) => atmType(b) !== "" && !atmosSet.has(atmosphereKey(atmType(b))),
    });
  }
  const subSet = new Set(Object.keys(sub).map(bodyClassKey));
  if (subSet.size > 0) {
    bounds.push({
      name: "body class",
      describe: `not one of ${[...Object.keys(sub)].join(", ")}`,
      outside: (b) => planetClass(b) !== "" && !subSet.has(bodyClassKey(planetClass(b))),
    });
  }
}

if (!profile) {
  console.log("\nNo feeder profile for this species, so there is nothing to bound it with.");
} else {
  console.log(`\nwhat the corpus says, over ${profile.sampleCount} bodies — and what each bound would do:`);
  console.log(`  ${"bound".padEnd(18)} ${"range".padEnd(42)} removes   loses`);
  const offeredBodies = seen.filter((s) => s.offeredTarget);
  const confirmedBodies = targetTruth;
  for (const bound of bounds) {
    const removes = offeredBodies.filter((s) => bound.outside(s.body)).length;
    const loses = confirmedBodies.filter((s) => bound.outside(s.body)).length;
    console.log(
      `  ${bound.name.padEnd(18)} ${bound.describe.padEnd(42)} ${String(removes).padStart(5)}   ${String(loses).padStart(5)}`,
    );
  }
  const anyOutside = (b: BodyExoState) => bounds.some((x) => x.outside(b));
  const removesAll = offeredBodies.filter((s) => anyOutside(s.body)).length;
  const losesAll = confirmedBodies.filter((s) => anyOutside(s.body)).length;
  console.log(
    `  ${"all together".padEnd(18)} ${"".padEnd(42)} ${String(removesAll).padStart(5)}   ${String(losesAll).padStart(5)}`,
  );
  console.log(
    `\n  offered on ${offeredBodies.length} bodies; ${removesAll} of them (${((removesAll / Math.max(1, offeredBodies.length)) * 100).toFixed(1)} %) are outside everything the corpus has ever shown.`,
  );
  console.log(
    `  it has been confirmed on ${confirmedBodies.length} of his bodies; the bounds together lose ${losesAll}.`,
  );

  if (losesAll > 0) {
    console.log("\n  the confirmed bodies a bound would throw away:");
    for (const s of confirmedBodies.filter((x) => anyOutside(x.body))) {
      const which = bounds
        .filter((x) => x.outside(s.body))
        .map((x) => x.name)
        .join(", ");
      console.log(
        `    ${s.body.bodyName.padEnd(34)} ${planetClass(s.body).padEnd(22)} ${g(s.body).toFixed(3)} g  ${tempK(s.body).toFixed(0)} K  ${atmType(s.body).padEnd(20)} -> ${which}`,
      );
    }
  }
}

/* ------------------------------------------------------------------ what a post-DSS floor costs */

console.log(`
the cost side: every species he confirmed on a probed body, by its within-genus share`);
console.log(`  confirmed rows measured   ${truthShares.length}`);
for (const cut of [2, 5, 10]) {
  const lost = truthShares.filter((t) => t.sharePct < cut);
  console.log(
    `  a ${String(cut).padStart(2)} % floor would hide ${String(lost.length).padStart(3)} of them (${((lost.length / Math.max(1, truthShares.length)) * 100).toFixed(1)} %)`,
  );
}
const lostAt5 = truthShares.filter((t) => t.sharePct < 5).sort((a, b) => a.sharePct - b.sharePct);
if (lostAt5.length > 0) {
  console.log("  the ones a 5 % floor would hide, lowest first:");
  for (const t of lostAt5.slice(0, 15)) {
    console.log(
      `    ${t.species.padEnd(26)} ${t.sharePct.toFixed(2).padStart(6)} %  of ${t.genusRows} in its genus   ${t.body}`,
    );
  }
  if (lostAt5.length > 15) console.log(`    ... and ${lostAt5.length - 15} more`);
}

/* ------------------------------------------------------------------ pass four: what tells it apart */

/*
  The bounds above only remove what the corpus has literally never shown, and on a species this wide
  that is very little. The useful question is the other one: on each axis, is this species'
  distribution different from what a bio body looks like in general? A share is meaningless alone —
  69 % Thin Water only matters if bio bodies are not 69 % Thin Water anyway.

  Two ambients, because either one alone is arguable:

    - **corpus** — every species profile's categorical counts summed. One row per (species, body), so
      a body carrying three species counts three times, which is the right denominator for "given a
      body with biology on it".
    - **his own** — the atmosphere and class of the bodies in his cache that carry a bio signal. Far
      smaller, and exactly the population the panel scores.

  Where the two disagree, believe neither and say so.
*/

interface Tally {
  total: number;
  byKey: Map<string, number>;
}

function newTally(): Tally {
  return { total: 0, byKey: new Map() };
}

function add(t: Tally, key: string, n = 1): void {
  if (!key) return;
  t.byKey.set(key, (t.byKey.get(key) ?? 0) + n);
  t.total += n;
}

const AXES = [
  { label: "atmosphere", path: "body.atmosphereType", key: atmosphereKey },
  { label: "body class", path: "body.subType", key: bodyClassKey },
  { label: "volcanism", path: "body.volcanismType", key: (v: string) => v.trim().toLowerCase() },
  {
    label: "host star",
    path: "exo.host_star_spectral_primary",
    key: (v: string) => v.trim().toUpperCase().slice(0, 1),
  },
] as const;

const corpusAmbient = new Map<string, Tally>(AXES.map((a) => [a.path, newTally()]));
const targetTally = new Map<string, Tally>(AXES.map((a) => [a.path, newTally()]));

let profilesRead = 0;
for (const entry of db.species) {
  const prof = loadProfile(entry);
  if (!prof) continue;
  profilesRead += 1;
  for (const axis of AXES) {
    const counts = prof.categorical?.[axis.path] ?? {};
    for (const [raw, n] of Object.entries(counts)) {
      add(corpusAmbient.get(axis.path)!, axis.key(raw), n);
      if (entry.id === target.id) add(targetTally.get(axis.path)!, axis.key(raw), n);
    }
  }
}

/** His own bio bodies, for the axes the journal carries directly. */
const ownAmbient = new Map<string, Tally>([
  ["body.atmosphereType", newTally()],
  ["body.subType", newTally()],
  ["body.volcanismType", newTally()],
  ["exo.host_star_spectral_primary", newTally()],
]);
for (const s of seen) {
  add(ownAmbient.get("body.atmosphereType")!, atmosphereKey(atmType(s.body)));
  add(ownAmbient.get("body.subType")!, bodyClassKey(planetClass(s.body)));
  const volc = (s.body.scan?.Volcanism ?? "").trim().toLowerCase();
  add(ownAmbient.get("body.volcanismType")!, volc === "" ? "no volcanism" : volc);
  add(
    ownAmbient.get("exo.host_star_spectral_primary")!,
    (s.star ?? "").trim().toUpperCase().slice(0, 1) || "?",
  );
}

const share = (t: Tally, key: string) => (t.total === 0 ? 0 : ((t.byKey.get(key) ?? 0) / t.total) * 100);

console.log(`
what sets it apart, ${profilesRead} profiles pooled as the corpus ambient:`);
for (const axis of AXES) {
  const mine = targetTally.get(axis.path)!;
  if (mine.total === 0) continue;
  const corpus = corpusAmbient.get(axis.path)!;
  const own = ownAmbient.get(axis.path)!;
  console.log(`
  ${axis.label}   (${mine.total} rows for ${target.displayName})`);
  console.log(
    `    ${"value".padEnd(26)} ${"this".padStart(7)} ${"corpus".padStart(8)} ${"lift".padStart(6)}   ${"his bodies".padStart(10)}`,
  );
  const rows = [...mine.byKey].sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [key, n] of rows) {
    const mineShare = (n / mine.total) * 100;
    const ambientShare = share(corpus, key);
    const lift = ambientShare > 0 ? mineShare / ambientShare : Infinity;
    console.log(
      `    ${key.padEnd(26)} ${mineShare.toFixed(1).padStart(6)}% ${ambientShare.toFixed(1).padStart(7)}% ${(Number.isFinite(lift) ? lift.toFixed(2) : "inf").padStart(6)}x  ${share(own, key).toFixed(1).padStart(9)}%`,
    );
  }
  /* What share of the ambient this species' own values cover: a low number is a usable gate. */
  const covered = [...mine.byKey.keys()].reduce((sum, k) => sum + share(corpus, k), 0);
  const coveredOwn = [...mine.byKey.keys()].reduce((sum, k) => sum + share(own, k), 0);
  console.log(
    `    the values it has ever shown cover ${covered.toFixed(1)}% of corpus rows, ${coveredOwn.toFixed(1)}% of his bio bodies`,
  );
}
