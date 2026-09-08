/**
 * What is still worth flying to, in systems this commander found first.
 *
 * A first discovery is not itself worth anything on the exobiology ledger — the bonus that matters
 * is **first footfall**, which pays 5× and is claimed by whoever steps on the body first. The two
 * coincide often enough to be useful: a system nobody had visited when the commander scanned it is
 * a system whose landable bodies were, at that moment, unwalked.
 *
 * So this asks the narrow question the router will need answered:
 *
 *   in systems whose main star this commander scanned before anyone else, which landable bodies
 *   carry biological signals, have never been scanned or walked on, and what are they worth at 5×?
 *
 * Reads the journal merge cache, so the answer is specific to this commander. Run the app once
 * first if the cache does not exist.
 *
 *   npx tsx scripts/first-discovery-probe.ts
 *   npx tsx scripts/first-discovery-probe.ts --limit 40
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";
import { computeExoPayoutRangeFromMatches, resolveOrganicSlotCount } from "../src/server/exoPayoutRange.js";
import { loadPriceList } from "../src/server/priceList.js";
import { resolveHostStarBodyId } from "../src/server/orbitUtils.js";
import { loadJournalMergeCacheForTool } from "./probeCache.js";
import type {
  BodyExoState,
  ExplorationScanRecord,
  SpeciesMatchContext,
} from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) || 25 : 25;

const db = loadSpeciesDatabaseFromTree(root);
const prices = loadPriceList(root);
const payload = loadJournalMergeCacheForTool();

const bodies: BodyExoState[] = payload.bodies.map(([, b]) => b);
const firstDiscovery = new Set(
  (payload.mainStarWasDiscoveredBySystem ?? [])
    .filter(([, wasDiscovered]) => wasDiscovered === false)
    .map(([addr]) => addr),
);
// ObservedFlag, not a boolean: `.value` is the claim and null means nobody ever reported either way.
const footfalled = new Set(
  payload.bodyFootfallFlag?.filter(([, f]) => f?.value === true).map(([k]) => k) ?? [],
);
const detailedFootfall = new Map(payload.bodyDetailedFootfallState ?? []);

const scansBySystem = new Map<number, Map<number, ExplorationScanRecord>>();
for (const [, r] of [...(payload.soldExplorationScans ?? []), ...payload.explorationScans]) {
  const byId = scansBySystem.get(r.systemAddress) ?? new Map<number, ExplorationScanRecord>();
  byId.set(r.bodyId, r);
  scansBySystem.set(r.systemAddress, byId);
}

function matchContextFor(b: BodyExoState): SpeciesMatchContext | undefined {
  const byId = scansBySystem.get(b.systemAddress);
  const rec = byId?.get(b.bodyId);
  if (!byId || !rec) return undefined;
  const ctx: SpeciesMatchContext = {};
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

interface Row {
  system: string;
  body: string;
  signals: number;
  minCr: number;
  maxCr: number;
  candidates: number;
  genusKnown: boolean;
  footfallSeen: boolean | null;
}

const t0 = Date.now();
const rows: Row[] = [];
let considered = 0;
let noScan = 0;
let noPayout = 0;
let notLandable = 0;

for (const b of bodies) {
  if (!firstDiscovery.has(b.systemAddress)) continue;
  if (!b.biologicalSignals || b.biologicalSignals <= 0) continue;
  // Already worked: an organic lock means a ScanOrganic named something here.
  if (b.organicGenusLocks.length > 0) continue;
  if (footfalled.has(b.key)) continue;
  considered++;

  if (!b.scan) { noScan++; continue; }
  // `Landable`, capitalised — PlanetScan mirrors the journal's own field names and carries an index
  // signature, so a lower-case guess type-checks and silently reads undefined.
  if (b.scan.Landable !== true) { notLandable++; continue; }

  const run = matchDatabaseToScan(db, b.scan, b.genusHints, b.organicGenusLocks, {
    includeBacterium: true,
    matchContext: matchContextFor(b) ?? null,
    biologicalSignals: b.biologicalSignals,
  });
  const shown = shownSpeciesMatches(run.matches);
  const { count: slots, source } = resolveOrganicSlotCount(b);
  if (slots <= 0 || source === "none") continue;

  // Nobody has walked here as far as the journal ever said, so the 5x is the honest assumption.
  const seen = detailedFootfall.get(b.key);
  const range = computeExoPayoutRangeFromMatches(shown, prices, slots, source, 5, seen ?? null, true);
  if (!range) { noPayout++; continue; }

  rows.push({
    system: b.starSystem,
    body: b.bodyName,
    signals: b.biologicalSignals,
    minCr: range.minCr,
    maxCr: range.maxCr,
    candidates: range.pricedCandidateCount,
    genusKnown: (b.genusHints?.length ?? 0) > 0,
    footfallSeen: seen ?? null,
  });
}
const ms = Date.now() - t0;

rows.sort((a, b) => b.minCr - a.minCr || b.maxCr - a.maxCr);
const cr = (n: number) => n.toLocaleString("en-US");
const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);

console.log(`\nfirst-discovery systems in cache: ${firstDiscovery.size}`);
console.log(`candidate bodies (bio signals, unscanned, unwalked): ${considered}`);
console.log(`  with a landable scan and a priced prediction: ${rows.length}`);
console.log(`  dropped: no scan ${noScan}, not landable ${notLandable}, no priced candidate ${noPayout}`);
console.log(`  systems involved: ${new Set(rows.map((r) => r.system)).size}`);
console.log(`  genus already known (DSS done): ${rows.filter((r) => r.genusKnown).length}`);
console.log(`\nfloor if every body pays its cheapest candidates: ${cr(sum((r) => r.minCr))} CR`);
console.log(`ceiling if every body pays its dearest:           ${cr(sum((r) => r.maxCr))} CR`);
console.log(`matched ${rows.length} bodies in ${ms} ms (${(ms / Math.max(rows.length, 1)).toFixed(1)} ms each)\n`);

console.log(`--- top ${Math.min(LIMIT, rows.length)} by guaranteed floor (all at 5x) ---`);
for (const r of rows.slice(0, LIMIT)) {
  console.log(
    `${cr(r.minCr).padStart(12)} - ${cr(r.maxCr).padStart(12)} CR  ` +
      `sig=${r.signals} cand=${String(r.candidates).padStart(2)} ${r.genusKnown ? "DSS" : "   "}  ` +
      `${r.system}  |  ${r.body}`,
  );
}
