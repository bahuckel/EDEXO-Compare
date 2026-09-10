/**
 * Which sector a system belongs to — INCLUDE-BODY-IDS Phase 10, step 1.
 *
 * The galaxy is divided into sectors, and the heat map draws sectors before it draws systems. So the
 * first question is how to put a system in one, and the obvious answer is wrong.
 *
 * ## Why not the bounding boxes
 *
 * `sector-list.csv` carries `Min/Max X/Y/Z` per sector and it is tempting to test a system's
 * coordinates against them. Measured 2026-09-07: **of 300 sector centres, 42 fall inside more than
 * one sector's box**, and `Swoiwns IZ-E d12-10` falls inside **eight** boxes, none of them Swoiwns.
 * Those columns describe the *observed* systems in a sector, so the boxes overlap heavily and are not
 * a partition of space. Coordinates give plausible, confident, wrong answers.
 *
 * ## The name is exact
 *
 * Procgen systems are named `<Sector> AA-A x0` or `<Sector> AA-A x0-0`, where `AA-A` is the boxel
 * identifier and `x` is the mass code `a`–`h`. The sector is everything before that, and it is
 * unambiguous because the suffix grammar cannot occur in a hand-given name.
 *
 * ```
 * Swoiwns IZ-E d12-10        -> Swoiwns
 * Ooscs Auf DR-T d4-1        -> Ooscs Auf
 * Col 132 Sector WL-C b29-2  -> Col 132 Sector
 * Lyncis Sector CL-Y c14     -> Lyncis Sector        (no dash suffix; still valid)
 * ```
 *
 * ## Hand-named systems are a real population, not an error
 *
 * `Sol`, `18 Andromedae`, `HIP 168444`, `Merope` carry no sector in their name. They are the bubble
 * and the catalogued stars around it — exactly the region the map is expected to look saturated in —
 * so they must be reported as their own group rather than dropped. {@link systemSector} returns
 * `null` for them and {@link classifySystemName} says *why*, so a caller can count them separately
 * instead of confusing "no sector" with "parse failed".
 *
 * ## The grid does better than the name, and covers everything
 *
 * The sector index is also a **fixed 1280 ly grid**, and that grid was solved from the catalogue
 * rather than taken from a wiki: `Avg − index × 1280` has a minimum of exactly
 * `(−49984, −40985, −24104)` across 11,649 sectors, which is the origin to within a light year.
 *
 * Verified 2026-09-07: `floor((coord − origin) / 1280)` reproduces the catalogue's own
 * `id64 X/Y/Z` for **11,648 of 11,649 sectors — 100.0 %**, one outlier (`Aucopp`). And the cells are
 * a real partition: **11,649 occupied cells, none holding more than one sector name**, which is
 * exactly what the bounding boxes are not.
 *
 * So {@link sectorCellFromCoords} is the primary method — it needs only coordinates, so it covers
 * hand-named systems too, and it places them where they belong: `Sol` → Wregoe, `Merope` →
 * Synuefai, while `Swoiwns IZ-E d12-10` lands in Swoiwns. The name parser stays as a **free
 * cross-check** on procgen systems, and disagreement between the two is a defect worth surfacing
 * rather than averaging away.
 */

/**
 * The galactic sector grid: 1280 ly cubes from this origin.
 *
 * Solved from `sector-list.csv` rather than trusted — see the note above. The published origin is
 * usually written `(−49985, −40985, −24105)`, which is what the data gives to within a light year;
 * that value is used because it reproduces the catalogue indices exactly.
 */
export const SECTOR_ORIGIN = { x: -49985, y: -40985, z: -24105 } as const;
export const SECTOR_SIZE_LY = 1280;

export interface SectorCell {
  x: number;
  y: number;
  z: number;
}

/** The grid cell a position falls in. Total: every coordinate is in exactly one cell. */
export function sectorCellFromCoords(x: number, y: number, z: number): SectorCell {
  return {
    x: Math.floor((x - SECTOR_ORIGIN.x) / SECTOR_SIZE_LY),
    y: Math.floor((y - SECTOR_ORIGIN.y) / SECTOR_SIZE_LY),
    z: Math.floor((z - SECTOR_ORIGIN.z) / SECTOR_SIZE_LY),
  };
}

/**
 * The same cell coordinates without the floor, for things that know exactly where they are.
 *
 * A sector is 1 280 ly on a side and the galaxy is only about ±2 000 ly thick, so flooring y leaves
 * **four** possible values — which is why an edge-on map of cell coordinates draws every system in
 * the galaxy as two or three stacked rows. Aggregated sector data really is that coarse vertically
 * and cannot be helped, but a system with its own coordinates should never be rounded into a 1 280 ly
 * bucket before being drawn: it already knows better.
 *
 * Same origin and scale as {@link sectorCellFromCoords}, so the two plot in one space.
 */
export function sectorCellFractional(x: number, y: number, z: number): SectorCell {
  return {
    x: (x - SECTOR_ORIGIN.x) / SECTOR_SIZE_LY,
    y: (y - SECTOR_ORIGIN.y) / SECTOR_SIZE_LY,
    z: (z - SECTOR_ORIGIN.z) / SECTOR_SIZE_LY,
  };
}

/** The catalogue key for a cell — `x:y:z`, matching `sector-list.csv`'s `id64 X/Y/Z`. */
export function sectorCellKey(cell: SectorCell): string {
  return `${cell.x}:${cell.y}:${cell.z}`;
}

/**
 * `<Sector> <AA-A> <mass code><number>[-<number>]`.
 *
 * The boxel block is two letters, a dash, one letter; the mass code is a single letter `a`–`h`. Both
 * anchors have to be present, which is what stops a hand-named system like `Col 285 Sector IR-V c2-16`
 * — itself procgen — being confused with one like `18 Andromedae`.
 */
const PROCGEN = /^(.+?) [A-Z][A-Z]-[A-Z] [a-h]\d+(?:-\d+)?$/;

/** Why a system has no sector in its name. */
export type SectorKind =
  /** Procgen name; the sector is the prefix. */
  | "procgen"
  /** A catalogued or hand-given name — `Sol`, `18 Andromedae`, `Merope`. No sector encoded. */
  | "named"
  /** Not a system name we can read at all: empty, or whitespace. */
  | "unreadable";

export interface SectorClassification {
  kind: SectorKind;
  /** The sector name for `procgen`, otherwise null. */
  sector: string | null;
}

/**
 * The sector a system name encodes, or null when the name does not carry one.
 *
 * Null is a fact about the name, not a failure — see {@link classifySystemName} to tell the two
 * apart.
 */
export function systemSector(systemName: string): string | null {
  const m = PROCGEN.exec(systemName.trim());
  return m ? (m[1] as string).trim() || null : null;
}

/** The sector *and* the reason there is not one, so a coverage report can be honest. */
export function classifySystemName(systemName: string): SectorClassification {
  const name = systemName.trim();
  if (!name) return { kind: "unreadable", sector: null };
  const sector = systemSector(name);
  if (sector) return { kind: "procgen", sector };
  return { kind: "named", sector: null };
}

export interface SectorCoverage {
  total: number;
  procgen: number;
  named: number;
  unreadable: number;
  /** Distinct sectors seen. */
  sectors: number;
  /** Procgen names whose sector is not in the supplied catalogue — should be zero. */
  unknownSector: number;
  /** Up to a handful of examples of the above, for the report. */
  unknownExamples: string[];
  /** Examples of hand-named systems, so the group is legible rather than a number. */
  namedExamples: string[];
}

/**
 * Classify a list of system names, optionally checking each sector against a known catalogue.
 *
 * `knownSectors` is the 12,083-row set from `sector-list.csv`. Passing it turns "we parsed a sector"
 * into "we parsed a sector that exists", which is the number worth reporting — a parser that invents
 * plausible sector names would otherwise score 100 %.
 */
export function measureSectorCoverage(
  systemNames: Iterable<string>,
  knownSectors?: ReadonlySet<string>,
): SectorCoverage {
  const sectors = new Set<string>();
  const unknownExamples: string[] = [];
  const namedExamples: string[] = [];
  let total = 0;
  let procgen = 0;
  let named = 0;
  let unreadable = 0;
  let unknownSector = 0;

  for (const raw of systemNames) {
    total += 1;
    const c = classifySystemName(raw);
    if (c.kind === "unreadable") {
      unreadable += 1;
      continue;
    }
    if (c.kind === "named") {
      named += 1;
      if (namedExamples.length < 8) namedExamples.push(raw.trim());
      continue;
    }
    procgen += 1;
    sectors.add(c.sector!);
    if (knownSectors && !knownSectors.has(c.sector!)) {
      unknownSector += 1;
      if (unknownExamples.length < 8) unknownExamples.push(raw.trim());
    }
  }

  return {
    total,
    procgen,
    named,
    unreadable,
    sectors: sectors.size,
    unknownSector,
    unknownExamples,
    namedExamples,
  };
}
