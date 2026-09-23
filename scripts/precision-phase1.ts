/**
 * Species precision, phase 1: how many species does the app show for each genus slot, and which?
 *
 *   npx tsx scripts/precision-phase1.ts
 *
 * Reads `docs/precision/truth-table.jsonl` from phase 0 — every body × genus whose species the
 * sources agree on — and replays each body through the **shipped** matcher, the way the app sees
 * it: `matchDatabaseToScan` with the spatial catalogue, the region rollup, host star, companion
 * bodies and genus hints. Behaviour, never gate text.
 *
 * ## The unit is a slot
 *
 * The game places at most one species per genus per body, so the question the app has to answer is
 * not "which of 108" but, for each genus really on the body, "which of *its* species". A slot's size
 * is how many species of that genus the app shows there. The target is 1, and never more than 2.
 *
 * ## Two scenarios
 *
 *  - **post-DSS** — genus hints supplied: the genera the truth table knows on the body, or the
 *    journal's own `SAASignalsFound` list where the commander scanned it. This is where the slot
 *    question is sharpest: the genus is known, the species is not.
 *  - **FSS-only** — no hints, the decision before flying there. Slot sizes are read off the same
 *    candidate list per genus.
 *
 * ## Physics, one source per body
 *
 * The journal's `Scan` where the commander has one (the app's own merge cache, so it is exactly what
 * the panel matched), then the EDDN capture (journal-shaped, full precision), then the Spansh corpus.
 * Stars and sibling bodies come from the same source, mapped through the app's own
 * `mapEdsmBodyToExplorationRecord` so host-star resolution is the app's and not a copy of it.
 *
 * Two deliberate differences from the live panel, both of which make the replay the commander's
 * view *at the body* rather than from a distance:
 *
 *  - `systemCoords` is always attached. The app attaches it only for the commander's current
 *    system, so spatial gates never fire on a system viewed remotely.
 *  - The capture's body list is always marked incomplete: the collector keeps no Earth-like worlds
 *    or gas giants, so a missing companion body there means nothing.
 *
 * ## Output — local only
 *
 * `docs/precision/phase1-report.md` and `phase1-slots.jsonl` (one row per slot, for phase 2).
 */
import path from "node:path";
import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { mergeScanForExomastery } from "../src/server/footScannedCatalog.js";
import { mapEdsmBodyToExplorationRecord } from "../src/server/edsmSystemHydration.js";
import { resolveHostStarBodyId, hostStarBodyIdsForExobiology } from "../src/server/orbitUtils.js";
import { hostStarClassKeys } from "../src/shared/hostStarGates.js";
import { starDistanceLs } from "../src/server/speciesMatchContext.js";
import { journalPressureToAtm } from "../src/shared/journalPhysics.js";
import { regionForSystem, regionIndexForSystem } from "../src/server/regionMapData.js";
import { loadSpatialCatalogue } from "../src/server/spatialCatalogue.js";
import { loadPriceList, lookupPrice } from "../src/server/priceList.js";
import { loadJournalMergeCacheForTool } from "./probeCache.js";
import type {
  BodyExoState,
  ExplorationScanRecord,
  GenusHint,
  PlanetScan,
  SpeciesMatchContext,
} from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const feederDir = process.env.EXOMASTERY_FEEDER_DIR?.trim() || path.resolve(root, "..", "exomastery-feeder");
const outDir = path.join(root, "docs", "precision");
const truthPath = path.join(outDir, "truth-table.jsonl");
if (!existsSync(truthPath)) {
  console.error("No truth table — run `npx tsx scripts/precision-phase0.ts` first.");
  process.exit(1);
}

const db = loadSpeciesDatabaseFromTree(root);
const byId = new Map(db.species.map((e) => [e.id, e]));
const spatial = loadSpatialCatalogue(root);
const prices = loadPriceList(root);
const priceOf = (id: string) => {
  const e = byId.get(id);
  return e ? (lookupPrice(prices, e.displayName, e.id) ?? 0) : 0;
};
const clean = (v: unknown): string => String(v ?? "").trim();

/* ------------------------------------------------------------------ the truth table, by body */

interface TruthRow {
  body: string;
  genus: string;
  species: string;
  sources: ("journal" | "corpus" | "capture")[];
  physics: {
    journal: unknown;
    corpus: { body: Record<string, unknown>; systemCacheFile: string } | null;
    capture: Record<string, unknown> | null;
  };
}
const truthByBody = new Map<string, TruthRow[]>();
{
  const rl = createInterface({ input: createReadStream(truthPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as TruthRow;
    const k = r.body.toLowerCase();
    const list = truthByBody.get(k) ?? [];
    list.push(r);
    truthByBody.set(k, list);
  }
}

/* ------------------------------------------------------------------ journal: the app's own merge cache */

const payload = loadJournalMergeCacheForTool(true);
/*
  Keyed by system address and body id, not by name: the cache's `bodyName` is sometimes a panel label
  ("Body 47") rather than the body's full name, and a name join silently lost more than half of the
  commander's own bodies on the first run.
*/
const journalBodies = new Map<string, BodyExoState>();
for (const [, b] of payload.bodies) journalBodies.set(`${b.systemAddress}:${b.bodyId}`, b);
const journalRecsBySystem = new Map<number, Map<number, ExplorationScanRecord>>();
for (const [, r] of [...(payload.soldExplorationScans ?? []), ...payload.explorationScans]) {
  const m = journalRecsBySystem.get(r.systemAddress) ?? new Map<number, ExplorationScanRecord>();
  m.set(r.bodyId, r);
  journalRecsBySystem.set(r.systemAddress, m);
}
const journalPos = new Map<number, { x: number; y: number; z: number }>(payload.systemPositions ?? []);
const journalComplete = new Set<number>(
  ((payload as unknown as { fssAllBodiesCompleteSystems?: number[] }).fssAllBodiesCompleteSystems ?? []),
);

/* ------------------------------------------------------------------ capture: every row of every system */

function newestCapture(): string | null {
  const dir = path.join(root, "docs");
  const hits = readdirSync(dir).filter((f) => /^eddn-bio-.*\.jsonl$/.test(f)).sort();
  return hits.length ? path.join(dir, hits[hits.length - 1]!) : null;
}
const captureBodiesBySystem = new Map<string, Record<string, unknown>[]>();
const captureSystems = new Map<string, Record<string, unknown>>();
const capturePath = newestCapture();
if (capturePath) {
  const rl = createInterface({ input: createReadStream(capturePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.includes('"kind":"system"')) {
      const o = JSON.parse(line) as Record<string, unknown>;
      captureSystems.set(clean(o.id64), o);
    } else if (line.includes('"kind":"body"')) {
      const o = JSON.parse(line) as Record<string, unknown>;
      const k = clean(o.systemId64);
      const list = captureBodiesBySystem.get(k) ?? [];
      list.push(o);
      captureBodiesBySystem.set(k, list);
    }
  }
}

/* ------------------------------------------------------------------ corpus: system caches and coordinates */

const cacheDocs = new Map<string, { id64?: number; name?: string; bodyCount?: number; bodies?: Record<string, unknown>[] }>();
function systemCache(file: string) {
  let hit = cacheDocs.get(file);
  if (!hit) {
    try {
      hit = JSON.parse(readFileSync(path.join(feederDir, "data", "raw", "systems", file), "utf8"));
    } catch {
      hit = {};
    }
    cacheDocs.set(file, hit!);
  }
  return hit!;
}
const corpusCoords = new Map<string, { x: number; y: number; z: number }>();
{
  const dbPath = path.join(feederDir, "data", "feeder_store.sqlite");
  if (existsSync(dbPath)) {
    const { DatabaseSync } = (await import("node:sqlite")) as typeof import("node:sqlite");
    const f = new DatabaseSync(dbPath, { readOnly: true });
    for (const r of f.prepare("SELECT display_name, x, y, z FROM systems WHERE x IS NOT NULL").all() as {
      display_name: string;
      x: number;
      y: number;
      z: number;
    }[]) {
      corpusCoords.set(r.display_name.toLowerCase(), { x: r.x, y: r.y, z: r.z });
    }
    f.close();
  }
}

/* ------------------------------------------------------------------ one body, ready to match */

interface Prepared {
  source: "journal" | "capture" | "corpus";
  scan: PlanetScan;
  ctx: SpeciesMatchContext;
  hints: GenusHint[] | null;
  biologicalSignals: number | null;
}

/** The app's `buildSpeciesMatchContext`, over records instead of a live store. */
function contextFor(
  rec: ExplorationScanRecord,
  recs: Map<number, ExplorationScanRecord>,
  scan: PlanetScan,
  coords: { x: number; y: number; z: number } | null,
  complete: boolean,
): SpeciesMatchContext {
  const ctx: SpeciesMatchContext = {};
  const starId = resolveHostStarBodyId(rec, recs);
  const star = starId == null ? undefined : recs.get(starId);
  if (star?.starType?.trim()) ctx.parentStarType = star.starType.trim();
  if (typeof star?.subclass === "number" && Number.isFinite(star.subclass)) ctx.parentStarSubclass = star.subclass;
  if (star?.luminosity?.trim()) ctx.parentStarLuminosity = star.luminosity.trim();
  const keys = hostStarClassKeys(hostStarBodyIdsForExobiology(rec, recs).map((id) => recs.get(id)?.starType));
  if (keys.length) ctx.hostStarClasses = keys;
  const orbit = starDistanceLs(rec, scan, recs);
  if (orbit !== undefined) ctx.orbitDistanceFromParentStarLs = orbit;
  if (coords) {
    ctx.systemCoords = coords;
    const idx = regionIndexForSystem(root, coords.x, coords.z);
    if (idx != null && idx > 0) {
      const name = regionForSystem(root, coords.x, coords.y, coords.z);
      if (name) {
        ctx.regionName = name;
        ctx.regionIndex = idx;
      }
    }
  }
  const classes = new Set<string>();
  for (const [id, r] of recs) if (id !== rec.bodyId && r.planetClass?.trim()) classes.add(r.planetClass.trim());
  if (classes.size) ctx.systemBodyClasses = [...classes];
  ctx.systemBodyListComplete = complete;
  const p = scan.SurfacePressure ?? rec.surfacePressure;
  if (p != null && Number.isFinite(p)) ctx.surfacePressureAtm = journalPressureToAtm(p);
  return ctx;
}

function hintsFromTruth(rows: TruthRow[]): GenusHint[] {
  const out = new Map<string, GenusHint>();
  for (const r of rows) {
    const e = byId.get(r.species);
    if (e) out.set(e.genusDataDir, { Genus_Localised: e.genus, Genus: e.genusDataDir });
  }
  return [...out.values()];
}

function fromSpanshShape(
  target: Record<string, unknown>,
  siblings: Record<string, unknown>[],
  systemAddress: number,
  systemName: string,
): { rec: ExplorationScanRecord; recs: Map<number, ExplorationScanRecord>; scan: PlanetScan } | null {
  const recs = new Map<number, ExplorationScanRecord>();
  for (const b of siblings) {
    const r = mapEdsmBodyToExplorationRecord(b, systemAddress, systemName);
    if (r) recs.set(r.bodyId, r);
  }
  const rec = mapEdsmBodyToExplorationRecord(target, systemAddress, systemName);
  if (!rec) return null;
  recs.set(rec.bodyId, rec);
  const scan = mergeScanForExomastery(null, rec);
  return scan ? { rec, recs, scan } : null;
}

const skipped = { noPhysics: 0, noPlanetClass: 0 };
function prepare(bodyKey: string, rows: TruthRow[]): Prepared | null {
  const truthHints = hintsFromTruth(rows);

  const jScan = rows.find((r) => r.physics.journal)?.physics.journal as
    | { scan?: { SystemAddress?: number; BodyID?: number } }
    | undefined;
  const jb = jScan?.scan ? journalBodies.get(`${jScan.scan.SystemAddress}:${jScan.scan.BodyID}`) : undefined;
  if (jb) {
    const recs = journalRecsBySystem.get(jb.systemAddress) ?? new Map<number, ExplorationScanRecord>();
    const rec = recs.get(jb.bodyId);
    const scan = mergeScanForExomastery(jb.scan, rec);
    if (scan?.PlanetClass?.trim() && rec) {
      return {
        source: "journal",
        scan,
        ctx: contextFor(rec, recs, scan, journalPos.get(jb.systemAddress) ?? null, journalComplete.has(jb.systemAddress)),
        hints: jb.genusHints?.length ? jb.genusHints : truthHints,
        biologicalSignals: jb.biologicalSignals ?? null,
      };
    }
  }

  const cap = rows.find((r) => r.physics.capture)?.physics.capture;
  if (cap) {
    const sysId = clean(cap.systemId64);
    const sys = captureSystems.get(sysId);
    const built = fromSpanshShape(cap, captureBodiesBySystem.get(sysId) ?? [], Number(sysId), clean(sys?.name));
    if (built?.scan.PlanetClass?.trim()) {
      const c = sys?.coords as { x: number; y: number; z: number } | undefined;
      const sig = (cap.signals ?? {}) as { signals?: Record<string, number> };
      const bio = sig.signals?.["$SAA_SignalType_Biological;"];
      return {
        source: "capture",
        scan: built.scan,
        ctx: contextFor(built.rec, built.recs, built.scan, c ?? null, false),
        hints: truthHints,
        biologicalSignals: typeof bio === "number" ? bio : null,
      };
    }
  }

  const corp = rows.find((r) => r.physics.corpus)?.physics.corpus;
  if (corp) {
    const sc = systemCache(corp.systemCacheFile);
    const sysName = clean(sc.name);
    const built = fromSpanshShape(corp.body, sc.bodies ?? [], Number(sc.id64 ?? 0), sysName);
    if (built?.scan.PlanetClass?.trim()) {
      const complete = typeof sc.bodyCount === "number" && (sc.bodies?.length ?? 0) >= sc.bodyCount;
      return {
        source: "corpus",
        scan: built.scan,
        ctx: contextFor(built.rec, built.recs, built.scan, corpusCoords.get(sysName.toLowerCase()) ?? null, complete),
        hints: truthHints,
        biologicalSignals: null,
      };
    }
    skipped.noPlanetClass += 1;
    return null;
  }
  skipped.noPhysics += 1;
  return null;
}

/* ------------------------------------------------------------------ replay */

interface Slot {
  body: string;
  genus: string;
  truth: string;
  source: Prepared["source"];
  sourcesAgreeing: string[];
  region: string | null;
  post: { shown: string[]; all: string[] };
  fss: { shown: string[]; all: string[] };
  /** Why the truth landed in the unlikely tier, post-DSS: the soft failure fields. */
  truthDemotedBy: string[];
}

const slots: Slot[] = [];
const genusOf = (id: string) => byId.get(id)?.genusDataDir ?? "?";
type RunMatch = ReturnType<typeof matchDatabaseToScan>["matches"][number];
function perGenus(matches: RunMatch[], genus: string) {
  const inGenus = matches.filter((m) => m.entry.genusDataDir === genus);
  return { shown: inGenus.filter((m) => !m.unlikely).map((m) => m.entry.id), all: inGenus.map((m) => m.entry.id) };
}

let bodiesReplayed = 0;
const started = Date.now();
/** `LIMIT=500` replays only the first bodies — a smoke test, never a measurement. */
const LIMIT = Number(process.env.LIMIT ?? Infinity);
for (const [bodyKey, rows] of truthByBody) {
  if (bodiesReplayed >= LIMIT) break;
  const p = prepare(bodyKey, rows);
  if (!p) continue;
  bodiesReplayed += 1;
  const opts = (hints: GenusHint[] | null) =>
    matchDatabaseToScan(db, p.scan, hints, null, {
      includeBacterium: true,
      matchContext: p.ctx,
      spatialCatalogue: spatial,
      biologicalSignals: p.biologicalSignals,
    }).matches;
  const post = opts(p.hints);
  const fss = opts(null);
  for (const r of rows) {
    const g = genusOf(r.species);
    const truthMatch = post.find((m) => m.entry.id === r.species);
    slots.push({
      body: r.body,
      genus: g,
      truth: r.species,
      source: p.source,
      sourcesAgreeing: r.sources,
      region: p.ctx.regionName ?? null,
      post: perGenus(post, g),
      fss: perGenus(fss, g),
      truthDemotedBy: truthMatch?.unlikely
        ? [...new Set(truthMatch.reasons.filter((x) => x.soft).map((x) => x.field))]
        : [],
    });
  }
  if (bodiesReplayed % 2000 === 0) process.stderr.write(`  ${bodiesReplayed} bodies…\n`);
}
const seconds = ((Date.now() - started) / 1000).toFixed(0);

writeFileSync(path.join(outDir, "phase1-slots.jsonl"), slots.map((s) => JSON.stringify(s)).join("\n") + "\n");

/* ------------------------------------------------------------------ measures */

type Scenario = "post" | "fss";
interface Tally {
  slots: number;
  shownHit: number;
  allHit: number;
  sizes: number[]; // shown slot size, truth or not
}
const emptyTally = (): Tally => ({ slots: 0, shownHit: 0, allHit: 0, sizes: [] });
function tallyOf(list: Slot[], sc: Scenario): Tally {
  const t = emptyTally();
  for (const s of list) {
    t.slots += 1;
    if (s[sc].shown.includes(s.truth)) t.shownHit += 1;
    if (s[sc].all.includes(s.truth)) t.allHit += 1;
    t.sizes.push(s[sc].shown.length);
  }
  return t;
}
const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : "—");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const share = (xs: number[], f: (n: number) => boolean) => pc(xs.filter(f).length, xs.length);
function sizeCols(t: Tally): string {
  return [
    t.slots,
    pc(t.shownHit, t.slots),
    pc(t.allHit, t.slots),
    mean(t.sizes).toFixed(2),
    share(t.sizes, (n) => n === 1),
    share(t.sizes, (n) => n <= 2),
    share(t.sizes, (n) => n >= 3),
    share(t.sizes, (n) => n >= 5),
  ].join(" | ");
}
const HEAD = "| slots | truth shown | truth listed | mean size | size 1 | ≤ 2 | 3+ | 5+ |";
const RULE = "|---:|---:|---:|---:|---:|---:|---:|---:|";

const r: string[] = [];
r.push(`# Species precision — phase 1 baseline`, ``, `Generated ${new Date().toISOString()} by \`scripts/precision-phase1.ts\`. Local only.`, ``);
r.push(
  `Replayed **${bodiesReplayed}** bodies (${seconds} s) → **${slots.length}** slots. ` +
    `Physics from: ${(["journal", "capture", "corpus"] as const).map((s) => `${s} ${slots.filter((x) => x.source === s).length}`).join(", ")} slots. ` +
    `Skipped: ${skipped.noPhysics} bodies with no physics, ${skipped.noPlanetClass} with no planet class.`,
  ``,
  `*Slot* = a body × a genus really there. *Size* = species of that genus in the shown tier. ` +
    `*Truth shown* = the real species is among them; *truth listed* = shown or behind "show unlikely".`,
  ``,
);

for (const sc of ["post", "fss"] as Scenario[]) {
  r.push(`## ${sc === "post" ? "Post-DSS (genus known)" : "FSS-only (before flying there)"}`, ``);
  r.push(`| | ${HEAD.slice(2)}`, `|---${RULE.slice(0)}`);
  r.push(`| **all** | ${sizeCols(tallyOf(slots, sc))} |`);
  for (const src of ["journal", "capture", "corpus"] as const) {
    const l = slots.filter((s) => s.source === src);
    if (l.length) r.push(`| ${src} physics | ${sizeCols(tallyOf(l, sc))} |`);
  }
  r.push(``, `### by genus`, ``, `| genus ${HEAD}`, `|---${RULE}`);
  const genera = [...new Set(slots.map((s) => s.genus))].sort();
  for (const g of genera) r.push(`| ${g} | ${sizeCols(tallyOf(slots.filter((s) => s.genus === g), sc))} |`);
  r.push(``);
}

/* per species, post-DSS, with rivals */
r.push(`## Per species (post-DSS)`, ``, `Rivals: the species shown in the same slot most often, as a share of this species' slots.`, ``);
r.push(`| species | slots | truth shown | mean size | size 1 | top rivals | demoted by (when unlikely) |`, `|---|---:|---:|---:|---:|---|---|`);
const speciesIds = [...new Set(slots.map((s) => s.truth))].sort();
for (const id of speciesIds) {
  const l = slots.filter((s) => s.truth === id);
  const t = tallyOf(l, "post");
  const rivals = new Map<string, number>();
  const demoted = new Map<string, number>();
  for (const s of l) {
    for (const o of s.post.shown) if (o !== id) rivals.set(o, (rivals.get(o) ?? 0) + 1);
    for (const f of s.truthDemotedBy) demoted.set(f, (demoted.get(f) ?? 0) + 1);
  }
  const short = (x: string) => x.split("_").slice(-1)[0];
  const top = [...rivals].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([o, n]) => `${short(o)} ${pc(n, l.length)}`).join(", ");
  const dem = [...demoted].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, n]) => `${f} ×${n}`).join(", ");
  r.push(`| ${id} | ${t.slots} | ${pc(t.shownHit, t.slots)} | ${mean(t.sizes).toFixed(2)} | ${share(t.sizes, (n) => n === 1)} | ${top || "—"} | ${dem || "—"} |`);
}
r.push(``);

/* confusion pairs */
interface Pair {
  truth: string;
  rival: string;
  n: number;
  stake: number;
}
const pairs = new Map<string, Pair>();
for (const s of slots) {
  if (!s.post.shown.includes(s.truth)) continue;
  for (const o of s.post.shown) {
    if (o === s.truth) continue;
    const k = `${s.truth}|${o}`;
    const p = pairs.get(k) ?? { truth: s.truth, rival: o, n: 0, stake: 0 };
    p.n += 1;
    p.stake += Math.abs(priceOf(s.truth) - priceOf(o));
    pairs.set(k, p);
  }
}
const M = (cr: number) => `${(cr / 1e6).toFixed(1)} M`;
const pairRow = (p: Pair) =>
  `| ${p.truth} | ${p.rival} | ${p.n} | ${M(priceOf(p.truth))} | ${M(priceOf(p.rival))} | ${M(p.stake)} |`;
r.push(`## Confusion pairs (post-DSS, truth shown, rival shown beside it)`, ``);
r.push(`### by credits at stake — Σ |price difference| over the slots`, ``, `| truth | rival | slots | truth pays | rival pays | at stake |`, `|---|---|---:|---:|---:|---:|`);
for (const p of [...pairs.values()].sort((a, b) => b.stake - a.stake).slice(0, 40)) r.push(pairRow(p));
r.push(``, `### by count`, ``, `| truth | rival | slots | truth pays | rival pays | at stake |`, `|---|---|---:|---:|---:|---:|`);
for (const p of [...pairs.values()].sort((a, b) => b.n - a.n).slice(0, 40)) r.push(pairRow(p));
r.push(``);

/* recall losses */
const lost = slots.filter((s) => !s.post.all.includes(s.truth));
const lostBy = new Map<string, number>();
for (const s of lost) lostBy.set(s.truth, (lostBy.get(s.truth) ?? 0) + 1);
r.push(`## Truth not listed at all (post-DSS) — ${lost.length} slots`, ``);
r.push(
  [...lostBy].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id, n]) => `- ${id}: ${n} of ${slots.filter((s) => s.truth === id).length}`).join("\n") || "_none_",
  ``,
);

writeFileSync(path.join(outDir, "phase1-report.md"), r.join("\n"));
const all = tallyOf(slots, "post");
const fssT = tallyOf(slots, "fss");
console.log(
  `bodies ${bodiesReplayed}, slots ${slots.length} (${seconds} s)\n` +
    `post-DSS: truth shown ${pc(all.shownHit, all.slots)}, listed ${pc(all.allHit, all.slots)}, mean slot ${mean(all.sizes).toFixed(2)}, size1 ${share(all.sizes, (n) => n === 1)}, ≤2 ${share(all.sizes, (n) => n <= 2)}\n` +
    `FSS-only: truth shown ${pc(fssT.shownHit, fssT.slots)}, listed ${pc(fssT.allHit, fssT.slots)}, mean slot ${mean(fssT.sizes).toFixed(2)}, size1 ${share(fssT.sizes, (n) => n === 1)}, ≤2 ${share(fssT.sizes, (n) => n <= 2)}\n` +
    `report ${path.relative(root, path.join(outDir, "phase1-report.md"))}`,
);
