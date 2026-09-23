/**
 * The replay the precision tools share: every truth body, prepared exactly as the app would match it.
 *
 * Phase 1 measures slot sizes with it; the gate checks re-run it against a patched species tree to
 * say what a proposed change would do *before* anyone decides on it. One module, so the two can
 * never disagree about which physics a body had — see `precision-phase1.ts` for why each choice is
 * what it is (journal first, then capture, then corpus; coordinates always attached; the capture's
 * body list never treated as complete).
 */
import path from "node:path";
import { cpSync, createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { mergeScanForExomastery } from "../src/server/footScannedCatalog.js";
import { mapEdsmBodyToExplorationRecord } from "../src/server/edsmSystemHydration.js";
import { resolveHostStarBodyId, hostStarBodyIdsForExobiology } from "../src/server/orbitUtils.js";
import { hostStarClassKeys } from "../src/shared/hostStarGates.js";
import { mainStarClassOf, starDistanceLs } from "../src/server/speciesMatchContext.js";
import { journalPressureToAtm } from "../src/shared/journalPhysics.js";
import { regionForSystem, regionIndexForSystem } from "../src/server/regionMapData.js";
import { loadSpatialCatalogue } from "../src/server/spatialCatalogue.js";
import { loadJournalMergeCacheForTool } from "./probeCache.js";
import type {
  BodyExoState,
  ExplorationScanRecord,
  GenusHint,
  PlanetScan,
  SpeciesDatabase,
  SpeciesMatchContext,
} from "../src/shared/types.js";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const feederDir = process.env.EXOMASTERY_FEEDER_DIR?.trim() || path.resolve(root, "..", "exomastery-feeder");
export const precisionDir = path.join(root, "docs", "precision");
const clean = (v: unknown): string => String(v ?? "").trim();

export type Source = "journal" | "capture" | "corpus";

export interface TruthRow {
  body: string;
  genus: string;
  species: string;
  colour: string | null;
  sources: Source[];
  physics: {
    journal: unknown;
    corpus: { body: Record<string, unknown>; systemCacheFile: string } | null;
    capture: Record<string, unknown> | null;
  };
}

export interface Prepared {
  source: Source;
  scan: PlanetScan;
  ctx: SpeciesMatchContext;
  /**
   * What the body orbits directly: a star, a planet (a moon), or a barycentre. The scan does not
   * carry `Parents`; the record does. For the separator search, not the matcher.
   */
  parentKind: "star" | "planet" | "barycentre" | null;
  /** Bodies the source knows in the system, this one included. */
  systemBodies: number;
  /** Genus hints: the journal's own DSS list where there is one, else the genera the truth knows. */
  hints: GenusHint[] | null;
  biologicalSignals: number | null;
}

/* ------------------------------------------------------------------ the truth table */

export async function loadTruthByBody(): Promise<Map<string, TruthRow[]>> {
  const truthPath = path.join(precisionDir, "truth-table.jsonl");
  if (!existsSync(truthPath)) {
    console.error("No truth table — run `npx tsx scripts/precision-phase0.ts` first.");
    process.exit(1);
  }
  const out = new Map<string, TruthRow[]>();
  const rl = createInterface({ input: createReadStream(truthPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as TruthRow;
    const k = r.body.toLowerCase();
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  return out;
}


/** The first entry of a `Parents` chain, named. */
function parentKindOf(rec: ExplorationScanRecord): Prepared["parentKind"] {
  const first = (Array.isArray(rec.parents) ? rec.parents[0] : null) as Record<string, unknown> | null | undefined;
  if (!first || typeof first !== "object") return null;
  if ("Star" in first) return "star";
  if ("Planet" in first) return "planet";
  if ("Null" in first) return "barycentre";
  return null;
}

/* ------------------------------------------------------------------ the three physics sources */

export interface Replay {
  prepare(bodyKey: string, rows: TruthRow[]): Prepared | null;
  skipped: { noPhysics: number; noPlanetClass: number };
}

export async function createReplay(db: SpeciesDatabase): Promise<Replay> {
  const byId = new Map(db.species.map((e) => [e.id, e]));

  /*
    Journal bodies are keyed by system address and body id, not by name: the cache's `bodyName` is
    sometimes a panel label ("Body 47"), and a name join silently lost more than half of them.
  */
  const payload = loadJournalMergeCacheForTool(true);
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
    (payload as unknown as { fssAllBodiesCompleteSystems?: number[] }).fssAllBodiesCompleteSystems ?? [],
  );

  const captureBodiesBySystem = new Map<string, Record<string, unknown>[]>();
  const captureSystems = new Map<string, Record<string, unknown>>();
  const docs = path.join(root, "docs");
  const captures = readdirSync(docs).filter((f) => /^eddn-bio-.*\.jsonl$/.test(f)).sort();
  if (captures.length) {
    const rl = createInterface({ input: createReadStream(path.join(docs, captures[captures.length - 1]!)), crlfDelay: Infinity });
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

  const cacheDocs = new Map<string, { id64?: number; name?: string; bodyCount?: number; bodies?: Record<string, unknown>[] }>();
  const systemCache = (file: string) => {
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
  };
  const corpusCoords = new Map<string, { x: number; y: number; z: number }>();
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
    const mainStar = mainStarClassOf(recs);
    if (mainStar) ctx.systemMainStarClass = mainStar;
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
  function prepare(_bodyKey: string, rows: TruthRow[]): Prepared | null {
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
          parentKind: parentKindOf(rec),
          systemBodies: recs.size,
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
          parentKind: parentKindOf(built.rec),
          systemBodies: built.recs.size,
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
          parentKind: parentKindOf(built.rec),
          systemBodies: built.recs.size,
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

  return { prepare, skipped };
}

/* ------------------------------------------------------------------ running the matcher */

const spatial = loadSpatialCatalogue(root);
export type RunMatch = ReturnType<typeof matchDatabaseToScan>["matches"][number];

export function runMatcher(db: SpeciesDatabase, p: Prepared, withHints: boolean): RunMatch[] {
  return matchDatabaseToScan(db, p.scan, withHints ? p.hints : null, null, {
    includeBacterium: true,
    matchContext: p.ctx,
    spatialCatalogue: spatial,
    biologicalSignals: p.biologicalSignals,
  }).matches;
}

/* ------------------------------------------------------------------ a patched species tree */

/** Raw `conditions` keys to merge into one species row. `null` deletes a key. */
export type ConditionsPatch = Record<string, unknown>;

/**
 * Load the species tree with some rows' `conditions` changed — through the real loader, so a patch is
 * judged by exactly the code that would read it if it shipped.
 *
 * The JSON files are copied to a temporary tree (photos are not: the matcher never reads them), the
 * patch is written into the copy, and `EDEXO_SPECIES_DATA_DIR` points the loader at it for the one
 * call. `data/species` itself is never touched.
 */
export function loadPatchedDb(patches: Record<string, ConditionsPatch>): SpeciesDatabase {
  const src = path.join(root, "data", "species");
  const tmp = mkdtempSync(path.join(tmpdir(), "edexo-species-"));
  try {
    for (const genus of readdirSync(src)) {
      const from = path.join(src, genus);
      if (!statSync(from).isDirectory()) continue;
      for (const f of readdirSync(from)) {
        const full = path.join(from, f);
        if (statSync(full).isFile() && /\.(json|txt)$/i.test(f)) cpSync(full, path.join(tmp, genus, f));
      }
    }
    const pending = new Set(Object.keys(patches));
    for (const genus of readdirSync(tmp)) {
      for (const f of readdirSync(path.join(tmp, genus)).filter((n) => n.endsWith(".json"))) {
        const file = path.join(tmp, genus, f);
        const doc = JSON.parse(readFileSync(file, "utf8")) as { species?: { id: string; conditions?: Record<string, unknown> }[] };
        let changed = false;
        for (const s of doc.species ?? []) {
          const patch = patches[s.id];
          if (!patch) continue;
          const cond = { ...(s.conditions ?? {}) };
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) delete cond[k];
            else cond[k] = v;
          }
          s.conditions = cond;
          pending.delete(s.id);
          changed = true;
        }
        if (changed) writeFileSync(file, JSON.stringify(doc, null, 2));
      }
    }
    if (pending.size) throw new Error(`patch names species not in the tree: ${[...pending].join(", ")}`);
    const prior = process.env.EDEXO_SPECIES_DATA_DIR;
    process.env.EDEXO_SPECIES_DATA_DIR = tmp;
    try {
      return loadSpeciesDatabaseFromTree(root);
    } finally {
      if (prior === undefined) delete process.env.EDEXO_SPECIES_DATA_DIR;
      else process.env.EDEXO_SPECIES_DATA_DIR = prior;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
