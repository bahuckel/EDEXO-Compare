/**
 * Probe seam (C1e): P(species | this *kind* of body), counted jointly instead of assembled.
 *
 * The model's prior is galaxy-wide — "how much of all recorded biology is this species" — and three
 * field misses on 2026-09-21 were all the same shape: the corpus knows the answer **for that body
 * type** and the model reaches for it through a galaxy-wide number instead. Tela is 52 % of hot thin
 * sulphur dioxide bodies; verrata is 43-48 % of water-magma ones; both lost to a species that is more
 * common overall.
 *
 * Three earlier attempts (§C1, §C1d) all moved the *balance* between prior and likelihood and all
 * failed. This moves neither: it replaces the prior with a count conditioned on the body, leaving the
 * likelihood exactly as it is.
 *
 * ### Why a joint count rather than more likelihood terms
 *
 * The likelihood already multiplies ~7-27 damped terms that assume independence, which is why it has
 * to be damped at all. A joint count over a coarse key assumes nothing: the corpus is asked "on
 * bodies like this one, what grew" and answers with one number per species.
 *
 * ### The key, and the backoff
 *
 * `planet class | atmosphere | volcanism family | temperature band`, each coarse enough to have
 * counts: five classes, folded atmosphere (`NeonRich` → `neon`), the volcanism family with its
 * intensity stripped (`Major Water Magma` → `watermagma`), and four temperature bands. A cell with
 * fewer than {@link MIN_CELL} bodies is not trusted; the reader falls back through successively
 * coarser keys and finally returns null, at which point the caller keeps the galaxy-wide prior.
 *
 * Built by a throwaway script from `exomastery-feeder/data/raw/planets` — 51,272 bodies over 99
 * species, each a body record with the species that was actually found on it. Not shipped: the table
 * lives in `build-artifacts/` and this module returns null when it is absent.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./paths.js";
import type { PlanetScan } from "../shared/types.js";

/** Bodies a cell needs before its shares are believed rather than backed off. */
export const MIN_CELL = 20;

/** Half a body of smoothing, so a species absent from a cell is rare there rather than impossible. */
const CELL_SMOOTHING = 0.5;

interface PriorFile {
  levels: Record<string, Record<string, number>>[];
}

interface PriorFileV2 extends PriorFile {
  /** Which key scheme built it — the reader must produce keys in the same order. */
  scheme?: "B" | "C" | "D";
  /** Gravity band edges in g, ascending. Absent on the scheme with no gravity in the key. */
  edges?: number[];
  /** Temperature band edges in K, ascending. Absent means the original [100, 200, 300]. */
  tEdges?: number[];
  /**
   * Two-stage mode (§C1h): `P(genus | body) x P(species | genus, body)`.
   *
   * Per-genus temperature bands cannot be used on a single global table — two species in different
   * genera would be scored against different partitions of the same body and their shares would not
   * be comparable. Factorised, each stage is coherent on its own: the genus stage uses one global
   * band set, and each genus's species stage uses bands cut from that genus's own bodies.
   */
  mode?: "per-genus";
  genusTables?: Record<string, Record<string, number>>[];
  speciesTables?: Record<string, Record<string, Record<string, number>>[]>;
  /** Per-genus temperature edges, keyed by `genusDataDir`. */
  genusEdges?: Record<string, number[]>;
}

const cache = new Map<string, PriorFileV2 | null>();

/**
 * Load a prior table. `variant` picks a `build-artifacts/body-type-prior-<variant>.json`; the default
 * is the original no-gravity table.
 */
export function loadBodyTypePrior(root = getProjectRoot(), variant = ""): PriorFileV2 | null {
  const key = `${root}::${variant}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const name = variant ? `body-type-prior-${variant}.json` : "body-type-prior.json";
  const file = path.join(root, "build-artifacts", name);
  const loaded = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as PriorFileV2) : null;
  cache.set(key, loaded);
  return loaded;
}

export function clearBodyTypePriorCache(): void {
  cache.clear();
}

function gravityBand(scan: PlanetScan, edges: number[] | undefined): string {
  if (!edges?.length) return "?";
  const raw = scan.SurfaceGravity;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return "?";
  // The journal reports m/s^2; the corpus records Earth g. 9.80665 is the same constant
  // `journalSurfaceGravityToG` uses, kept local so this module stays dependency-free.
  const g = raw > 3 ? raw / 9.80665 : raw;
  let i = 0;
  while (i < edges.length && g >= edges[i]!) i++;
  return String.fromCharCode(97 + i);
}

function planetClassKey(s: string | undefined): string {
  const t = (s ?? "").toLowerCase();
  if (t.includes("rocky ice")) return "rockyice";
  if (t.includes("high metal")) return "hmc";
  if (t.includes("metal rich")) return "metalrich";
  if (t.startsWith("icy")) return "icy";
  if (t.startsWith("rocky")) return "rocky";
  if (t.includes("water world")) return "water";
  if (t.includes("earth")) return "earthlike";
  if (t.includes("ammonia")) return "ammoniaworld";
  return t.replace(/\s+/g, "").slice(0, 14) || "?";
}

function atmosphereKey(scan: PlanetScan): string {
  const raw = (scan.AtmosphereType ?? scan.Atmosphere ?? "") as string;
  return (
    raw
      .toLowerCase()
      .replace(/thin |hot |-rich| rich|atmosphere/g, "")
      .trim()
      .replace(/[^a-z]/g, "") || "none"
  );
}

function volcanismKey(scan: PlanetScan): string {
  const t = String(scan.Volcanism ?? "").toLowerCase();
  if (!t.trim() || t.includes("no volcanism")) return "none";
  return (
    t
      .replace(/^(minor|major)\s+/, "")
      .replace(/\s*volcanism\s*$/, "")
      .trim()
      .replace(/[^a-z]/g, "") || "volc"
  );
}

/** The original bands. Three quarters of the corpus falls in the middle one — see §C1g. */
const DEFAULT_T_EDGES = [100, 200, 300];

function temperatureKey(scan: PlanetScan, edges: number[] = DEFAULT_T_EDGES): string {
  const t = scan.SurfaceTemperature;
  if (typeof t !== "number" || !Number.isFinite(t)) return "?";
  let i = 0;
  while (i < edges.length && t >= edges[i]!) i++;
  return String.fromCharCode(97 + i);
}

/**
 * The keys this body matches, finest first — the same order the table's levels were built in.
 *
 * The scheme letter comes from the file, so the reader cannot drift from the builder: `B` keeps the
 * temperature band one level longer than gravity, `D` keeps gravity longer, `C` drops temperature
 * from the key entirely. Absent, the original no-gravity chain.
 */
export function bodyTypeKeys(scan: PlanetScan, file?: PriorFileV2 | null): string[] {
  const c = planetClassKey(scan.PlanetClass);
  const a = atmosphereKey(scan);
  const v = volcanismKey(scan);
  const t = temperatureKey(scan, file?.tEdges);
  const vb = v === "none" ? "none" : "volc";
  const g = gravityBand(scan, file?.edges);
  const tail = [`${c}|${a}|${v}`, `${c}|${a}|${vb}`, `${c}|${a}`, a];
  switch (file?.scheme) {
    case "B":
      return [`${c}|${a}|${v}|${t}|${g}`, `${c}|${a}|${v}|${t}`, ...tail];
    case "C":
      return [`${c}|${a}|${v}|${g}`, ...tail];
    case "D":
      return [`${c}|${a}|${v}|${t}|${g}`, `${c}|${a}|${v}|${g}`, ...tail];
    default:
      return [`${c}|${a}|${v}|${t}`, ...tail];
  }
}

export interface BodyTypePriorHit {
  /** log share of this species among the bodies in the cell. */
  logShare: number;
  /** Which backoff level answered, 0 = finest. */
  level: number;
  /** Bodies in the cell, for reporting and for the caller's own thresholds. */
  cellSize: number;
  count: number;
}

/**
 * The species' share of the cell this body falls in, or null when no level has enough bodies.
 *
 * Null means "this corpus has nothing to say about bodies like this", and the caller must keep
 * whatever prior it would otherwise have used. It is not an opinion that the species is absent.
 */
/** One backoff walk over one level stack. Returns the matching cell, or null if none is big enough. */
function walk(
  levels: Record<string, Record<string, number>>[] | undefined,
  keys: string[],
  minCell: number,
): { cell: Record<string, number>; level: number; total: number } | null {
  if (!levels) return null;
  for (const [level, key] of keys.entries()) {
    const cell = levels[level]?.[key];
    if (!cell) continue;
    let total = 0;
    for (const n of Object.values(cell)) total += n;
    if (total < minCell) continue;
    return { cell, level, total };
  }
  return null;
}

function shareOf(cell: Record<string, number>, total: number, id: string): number {
  const n = cell[id] ?? 0;
  return (n + CELL_SMOOTHING) / (total + CELL_SMOOTHING * Math.max(1, Object.keys(cell).length));
}

export function bodyTypeLogPrior(
  scan: PlanetScan,
  speciesId: string,
  root = getProjectRoot(),
  minCell = MIN_CELL,
  variant = "",
  genusId?: string,
): BodyTypePriorHit | null {
  const table = loadBodyTypePrior(root, variant);
  if (!table) return null;

  if (table.mode === "per-genus") {
    if (!genusId) return null;
    const genusKeys = bodyTypeKeys(scan, table);
    const g = walk(table.genusTables, genusKeys, minCell);
    if (!g) return null;
    const speciesKeys = bodyTypeKeys(scan, {
      ...table,
      tEdges: table.genusEdges?.[genusId] ?? [],
    } as PriorFileV2);
    const sp = walk(table.speciesTables?.[genusId], speciesKeys, minCell);
    // Genus known, species not: the genus stage still says something and the within-genus part falls
    // back to uniform, which is honest rather than a refusal.
    const pGenus = shareOf(g.cell, g.total, genusId);
    const pSpecies = sp ? shareOf(sp.cell, sp.total, speciesId) : null;
    return {
      logShare: Math.log(pGenus) + (pSpecies === null ? 0 : Math.log(pSpecies)),
      level: g.level,
      cellSize: g.total,
      count: g.cell[genusId] ?? 0,
    };
  }

  const keys = bodyTypeKeys(scan, table);
  for (const [level, key] of keys.entries()) {
    const cell = table.levels[level]?.[key];
    if (!cell) continue;
    let total = 0;
    let species = 0;
    for (const [id, n] of Object.entries(cell)) {
      total += n;
      if (id === speciesId) species = n;
    }
    if (total < minCell) continue;
    const share = (species + CELL_SMOOTHING) / (total + CELL_SMOOTHING * species_count(cell));
    return { logShare: Math.log(share), level, cellSize: total, count: species };
  }
  return null;
}

function species_count(cell: Record<string, number>): number {
  return Math.max(1, Object.keys(cell).length);
}
