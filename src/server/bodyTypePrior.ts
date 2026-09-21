/**
 * P(species | this *kind* of body), counted jointly instead of assembled.
 *
 * The model's other prior is galaxy-wide — "how much of all recorded biology is this species" — and
 * three field misses on 2026-09-21 were the same shape: the corpus knows the answer **for that kind
 * of body** and the model reached for it through a galaxy-wide number instead. Bacterium tela is
 * 52 % of hot thin-sulphur-dioxide bodies and verrata 43-48 % of water-magma ones; both lost to a
 * species more common overall.
 *
 * ### Why a joint count rather than more likelihood terms
 *
 * The likelihood multiplies seven to twenty-seven damped terms that assume independence, which is
 * the reason it has to be damped at all. A joint count over a coarse key assumes nothing: the corpus
 * is asked "on bodies like this one, what grew", and answers with one number per species.
 *
 * Four earlier ideas moved the *balance* between prior and likelihood — per-species informativeness,
 * ambient normalisation, adaptive damping, per-genus bands — and all four failed. This changes what
 * the prior **is**, and was the first to gain on every headline at once.
 *
 * ### The backoff
 *
 * The key is `planet class | atmosphere | volcanism family | temperature band` (see
 * `shared/bodyTypeKey.ts`, which the builder shares so the two cannot drift). A cell holding fewer
 * than {@link MIN_CELL} bodies is not trusted and the reader falls through to a coarser level; when
 * none answers it returns null and the caller keeps the galaxy-wide prior. Null is "this corpus has
 * nothing to say about bodies like this", never "the species is absent".
 *
 * ### What it is worth
 *
 * Measured on the owner's cache, 659 ranked species over 2,056 candidate rows, against the model as
 * it shipped:
 *
 * ```
 *   without   mean 2.965   top-1 215 (32.6 %)   top-3 454   calibration 0.0112
 *   with      mean 2.971   top-1 227 (34.4 %)   top-3 459   calibration 0.0096
 * ```
 *
 * Twelve more bodies where the panel's first row is right, five more where the answer is visible
 * without scrolling, and a calibration gap a seventh smaller. It costs six Bacterium first places
 * and returns seventeen across Tussock, Fungoida, Frutexa, Cactoida, Fonticulua and Clypeus.
 *
 * The table is built by `scripts/build-body-type-prior.ts` from a corpus that does not ship, and the
 * 57 KB result does. When it is missing every lookup returns null and the app ranks as it did
 * before — which is what happens in a checkout that has never run the builder.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./paths.js";
import type { PlanetScan } from "../shared/types.js";
import { BODY_TYPE_T_EDGES, bodyTypeKeyParts } from "../shared/bodyTypeKey.js";

/**
 * How far to move from the galaxy-wide prior toward the share among bodies of this kind, 0…1.
 *
 * One. The two are shares on the same scale so the blend is a plain mixture, and the sweep is flat
 * between 0.25 and 1.0 — the conditional prior agrees with the galaxy-wide one nearly everywhere and
 * differs where the body type is distinctive, which is the whole point. Full weight takes the most
 * top-1 and the most top-3, and the calibration column does not punish it.
 */
export const BODY_TYPE_PRIOR_WEIGHT = 1;

/**
 * Bodies a cell needs before its shares are believed rather than backed off.
 *
 * Ten. Swept at 10, 20, 50 and 100 — the headline barely moves, and the smaller floor keeps the
 * finest level answering on body types the corpus has only met a few dozen times, which is where a
 * conditional prior earns its keep.
 */
export const MIN_CELL = 10;

/** Half a body of smoothing, so a species absent from a cell is rare there rather than impossible. */
const CELL_SMOOTHING = 0.5;

interface PriorFile {
  formatVersion?: number;
  builtAt?: string;
  /** Temperature band edges the table was built with. Absent means {@link BODY_TYPE_T_EDGES}. */
  tEdges?: number[];
  levels: Record<string, Record<string, number>>[];
}

const cache = new Map<string, PriorFile | null>();

/**
 * Load a prior table. `variant` reads a `build-artifacts/body-type-prior-<variant>.json` instead of
 * the shipped one — the seam the band sets were swept through, and absent from a shipped build.
 */
export function loadBodyTypePrior(root = getProjectRoot(), variant = ""): PriorFile | null {
  const key = `${root}::${variant}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const file = variant
    ? path.join(root, "build-artifacts", `body-type-prior-${variant}.json`)
    : path.join(root, "data", "exomastery", "body-type-prior.json");
  let loaded: PriorFile | null = null;
  try {
    loaded = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as PriorFile) : null;
  } catch {
    // A truncated or hand-edited table must not stop the app starting; rank without it.
    loaded = null;
  }
  cache.set(key, loaded);
  return loaded;
}

export function clearBodyTypePriorCache(): void {
  cache.clear();
}

/** The keys this body matches, finest first — the same order the table's levels were built in. */
export function bodyTypeKeys(scan: PlanetScan, file?: PriorFile | null): string[] {
  const { planetClass, atmosphere, volcanism, temperature } = bodyTypeKeyParts(
    {
      subType: scan.PlanetClass,
      atmosphereType: (scan.AtmosphereType ?? scan.Atmosphere) as string | undefined,
      volcanismType: scan.Volcanism as string | undefined,
      temperatureK: scan.SurfaceTemperature,
    },
    file?.tEdges ?? BODY_TYPE_T_EDGES,
  );
  const vb = volcanism === "none" ? "none" : "volc";
  return [
    `${planetClass}|${atmosphere}|${volcanism}|${temperature}`,
    `${planetClass}|${atmosphere}|${volcanism}`,
    `${planetClass}|${atmosphere}|${vb}`,
    `${planetClass}|${atmosphere}`,
    atmosphere,
  ];
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
export function bodyTypeLogPrior(
  scan: PlanetScan,
  speciesId: string,
  root = getProjectRoot(),
  minCell = MIN_CELL,
  variant = "",
): BodyTypePriorHit | null {
  const table = loadBodyTypePrior(root, variant);
  if (!table?.levels) return null;
  const keys = bodyTypeKeys(scan, table);
  for (const [level, key] of keys.entries()) {
    const cell = table.levels[level]?.[key];
    if (!cell) continue;
    let total = 0;
    let species = 0;
    let categories = 0;
    for (const [id, n] of Object.entries(cell)) {
      if (!Number.isFinite(n) || n <= 0) continue;
      total += n;
      categories++;
      if (id === speciesId) species = n;
    }
    if (total < minCell) continue;
    const share = (species + CELL_SMOOTHING) / (total + CELL_SMOOTHING * Math.max(1, categories));
    return { logShare: Math.log(share), level, cellSize: total, count: species };
  }
  return null;
}
