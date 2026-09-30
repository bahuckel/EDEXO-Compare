/**
 * One boxel's systems (shared/boxel.ts): which the commander has flown, which the galaxy index knows
 * and what was recorded there, and what the boxel as a whole tends to grow.
 */
import { boxelIndexOf, MASS_CODES, parseBoxel, type BoxelDTO, type BoxelRowDTO } from "../shared/boxel.js";
import type { TileIndex } from "./galaxyTiles.js";
import { sectorOrdinals } from "./galaxyFind.js";
import { TIER_DSS, TIER_FSS } from "./bioIndex.js";

/** Listing more than this is not a boxel anyone flies by hand. */
export const BOXEL_MAX_ROWS = 2000;

export function boxelSystems(opts: {
  query: string;
  end: number | null;
  index: TileIndex | null;
  visited: Iterable<string>;
  speciesName: (id: string) => string;
}): BoxelDTO | null {
  const b = parseBoxel(opts.query);
  if (!b) return null;
  const mine = new Set<number>();
  for (const name of opts.visited) {
    const n = boxelIndexOf(name, b.prefix);
    if (n != null) mine.add(n);
  }
  const known = new Map<number, NonNullable<BoxelRowDTO["known"]>>();
  if (opts.index) {
    for (const i of sectorOrdinals(opts.index, b.sector)) {
      const n = boxelIndexOf(opts.index.index.nameOf(i), b.prefix);
      if (n == null) continue;
      const s = opts.index.index.systemAt(i);
      known.set(n, {
        species: s.species.map(opts.speciesName),
        bodyCount: s.bodyCount,
        signals: (s.tiers & (TIER_FSS | TIER_DSS)) !== 0 || s.species.length > 0,
      });
    }
  }
  const highest = Math.max(b.index ?? 0, ...mine, ...known.keys());
  const end = Math.min(BOXEL_MAX_ROWS - 1, Math.max(0, opts.end ?? highest));
  const rows: BoxelRowDTO[] = [];
  for (let n = 0; n <= end; n++) {
    rows.push({ n, name: `${b.prefix}${n}`, visited: mine.has(n), known: known.get(n) ?? null });
  }
  const tally = new Map<string, number>();
  for (const k of known.values())
    for (const sp of new Set(k.species)) tally.set(sp, (tally.get(sp) ?? 0) + 1);
  const mass = MASS_CODES[b.massCode]!;
  return {
    query: opts.query,
    sector: b.sector,
    boxel: b.boxel,
    massCode: b.massCode,
    cubeLy: mass.cubeLy,
    massHint: mass.hint,
    prefix: b.prefix,
    end,
    rows,
    visitedCount: rows.filter((r) => r.visited).length,
    knownCount: rows.filter((r) => r.known).length,
    common: [...tally]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, 8)
      .map(([name, systems]) => ({ name, systems })),
    nextUnvisited: rows.find((r) => !r.visited)?.name ?? null,
    noIndex: opts.index == null,
  };
}
