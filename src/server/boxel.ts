/**
 * One boxel's systems (shared/boxel.ts): which the commander has flown, which the galaxy index knows
 * and what was recorded there, and what the boxel as a whole tends to grow.
 */
import {
  boxelIndexOf,
  MASS_CODES,
  parseBoxel,
  type BoxelDTO,
  type BoxelRowDTO,
  type BoxelTableDTO,
  type BoxelNotableDTO,
  type BoxelTableRowDTO,
  type PreviousBoxelDTO,
  type SavedBoxelDTO,
} from "../shared/boxel.js";
import type { TileIndex } from "./galaxyTiles.js";
import { sectorOrdinals } from "./galaxyFind.js";
import { TIER_DSS, TIER_FSS } from "./bioIndex.js";
import type { SystemTraits } from "./galaxyTraits.js";
import { BODY_TRAITS, STAR_CLASSES, STAR_NONE, starClassIndex } from "../shared/galaxyTraits.js";
import type { BoxelLookupRecord } from "./boxelLookup.js";

/** Listing more than this is not a boxel anyone flies by hand. */
export const BOXEL_MAX_ROWS = 2000;

/** A visited system: its name, or `[systemAddress, name]` when the address is known (for the stats). */
export type VisitedSystem = string | readonly [number, string];

/** What the commander found in one system he visited: bodies scanned and notable ones. */
export type SystemStats = (systemAddress: number) => { bodies: { scanned: number; total: number | null }; notable: number };

/** name, address (or null) of a visited entry. */
export function visitedEntry(v: VisitedSystem): { name: string; addr: number | null } {
  return typeof v === "string" ? { name: v, addr: null } : { name: v[1], addr: v[0] };
}

export function boxelSystems(opts: {
  query: string;
  end: number | null;
  index: TileIndex | null;
  visited: Iterable<VisitedSystem>;
  speciesName: (id: string) => string;
  stats?: SystemStats;
}): BoxelDTO | null {
  const b = parseBoxel(opts.query);
  if (!b) return null;
  const mine = new Set<number>();
  const addrOf = new Map<number, number>();
  for (const v of opts.visited) {
    const { name, addr } = visitedEntry(v);
    const n = boxelIndexOf(name, b.prefix);
    if (n == null) continue;
    mine.add(n);
    if (addr != null) addrOf.set(n, addr);
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
    const addr = addrOf.get(n);
    const st = addr != null && opts.stats ? opts.stats(addr) : null;
    rows.push({
      n,
      name: `${b.prefix}${n}`,
      visited: mine.has(n),
      ...(addr != null ? { systemAddress: addr } : {}),
      known: known.get(n) ?? null,
      ...(st ? { bodies: st.bodies, notable: st.notable } : {}),
    });
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

/** What the journals say about one flown system (server/boxelFacts.ts). */
export interface JournalSystemFacts {
  mainStar: string | null;
  otherStars: string[];
  starClasses: string[];
  bodies: { scanned: number; total: number | null };
  notables: BoxelNotableDTO[];
  bodyTypes: string[];
  bio: { signals: number; species: string[] };
}

/**
 * Species from two sources, once each: "Concha labiata" (the app's name) and "Concha Labiata" (a
 * journal or Spansh) are one species. The first spelling seen is kept.
 */
function mergeSpecies(...lists: string[][]): string[] {
  const out = new Map<string, string>();
  for (const l of lists) for (const s of l) if (!out.has(s.toLowerCase())) out.set(s.toLowerCase(), s);
  return [...out.values()].sort((a, b) => a.localeCompare(b));
}

/** A star class key ("K") for the index's class position, or null. */
const classKeyAt = (i: number): string | null => STAR_CLASSES[i]?.key ?? null;

/** The index's facts for one ordinal: star classes and the bit-flagged notables and body types. */
function indexFacts(traits: SystemTraits | null, i: number) {
  if (!traits || i >= traits.count) return null;
  const main = traits.main[i] === STAR_NONE ? null : classKeyAt(traits.main[i]!);
  const stars: string[] = [];
  for (let b = 0; b < STAR_CLASSES.length; b++)
    if (traits.stars[i]! & (1 << b)) stars.push(STAR_CLASSES[b]!.key);
  const bodyTypes: string[] = [];
  for (let b = 0; b < BODY_TRAITS.length; b++)
    if (traits.bodies[i]! & (1 << b)) bodyTypes.push(BODY_TRAITS[b]!.key);
  const has = (k: string) => bodyTypes.includes(k);
  const notables: BoxelNotableDTO[] = [];
  if (has("elw")) notables.push({ kind: "earthlike", n: null });
  if (has("ww")) notables.push({ kind: "water", n: null });
  if (has("aw")) notables.push({ kind: "ammonia", n: null });
  // Exact class only (owner): the bit is never set from a Helium-rich gas giant (shared/galaxyTraits.ts).
  if (has("helium_gg")) notables.push({ kind: "helium", n: null });
  // One bit for every terraformable body: with an Earth-like, water or ammonia world it may be that one.
  if (has("terraformable") && !notables.length) notables.push({ kind: "terraformable", n: null });
  return {
    mainStar: main,
    otherStars: stars.filter((k) => k !== main),
    starClasses: main ? [main, ...stars.filter((k) => k !== main)] : stars,
    bodyTypes,
    notables,
  };
}

/**
 * The Boxels screen's table (owner, 2026-10-05): every system of every ticked saved boxel, -0 up to
 * its end, in one list, so one filter runs over all of them. Flown systems from the journals; the
 * rest from the galaxy index (bio-index species and body count, system-traits stars and bodies).
 */
export function boxelTable(opts: {
  boxels: SavedBoxelDTO[];
  index: TileIndex | null;
  traits?: SystemTraits | null;
  visited: Iterable<VisitedSystem>;
  speciesName: (id: string) => string;
  /** systemAddress → what the journals say about it. */
  journal?: (systemAddress: number) => JournalSystemFacts;
  /** systemAddress → when he last arrived there. */
  visitedAt?: (systemAddress: number) => string | null;
  /** The boxel's Spansh look-up (server/boxelLookup.ts), when there is one. */
  lookup?: (prefix: string) => BoxelLookupRecord | null;
  /** Systems on routes he plotted (the NavRoute finder's list): name and the star class NavRoute.json gave. */
  routed?: Iterable<{ name: string; starClass: string }>;
}): BoxelTableDTO {
  const lookups: BoxelTableDTO["lookups"] = [];
  const visited = [...opts.visited].map(visitedEntry);
  const rows: BoxelTableRowDTO[] = [];
  const tally = new Map<string, number>();
  const routed = [...(opts.routed ?? [])];
  for (const b of opts.boxels) {
    const onRoute = new Map<number, string>();
    for (const r of routed) {
      const n = boxelIndexOf(r.name, b.prefix);
      if (n != null) onRoute.set(n, r.starClass);
    }
    const mine = new Map<number, number | null>();
    for (const v of visited) {
      const n = boxelIndexOf(v.name, b.prefix);
      if (n != null && (v.addr != null || !mine.has(n))) mine.set(n, v.addr);
    }
    const known = new Map<number, number>();
    if (opts.index) {
      for (const i of sectorOrdinals(opts.index, b.sector)) {
        const n = boxelIndexOf(opts.index.index.nameOf(i), b.prefix);
        if (n != null) known.set(n, i);
      }
    }
    const skipped = new Set(b.skipped);
    const looked = opts.lookup?.(b.prefix) ?? null;
    const foundAny = !!looked && Object.keys(looked.systems).length > 0;
    if (looked)
      lookups.push({
        boxelId: b.id,
        fetchedAt: looked.fetchedAt,
        complete: looked.complete,
        systems: Object.keys(looked.systems).length,
        highest: Math.max(-1, ...Object.keys(looked.systems).map(Number)),
      });
    /*
      The highest system anything knows (owner, 2026-10-06, after SHBOXSEARCH's "gaps"): below it every
      number exists for mass codes a-g; h boxels have gaps, so nothing is inferred there.
    */
    const gapless = parseBoxel(`${b.prefix}0`)?.massCode !== "h";
    const highestKnown = Math.max(
      -1,
      ...mine.keys(),
      ...known.keys(),
      ...onRoute.keys(),
      ...(looked ? Object.keys(looked.systems).map(Number) : []),
    );
    for (let n = 0; n <= b.end; n++) {
      const flown = mine.has(n);
      const addr = mine.get(n) ?? null;
      const ord = known.get(n);
      const sys = ord != null ? opts.index!.index.systemAt(ord) : null;
      const idx = ord != null ? indexFacts(opts.traits ?? null, ord) : null;
      const indexSpecies = sys ? sys.species.map(opts.speciesName) : [];
      const indexSeen = sys ? (sys.tiers & (TIER_FSS | TIER_DSS)) !== 0 || sys.species.length > 0 : false;
      const j = flown && addr != null && opts.journal ? opts.journal(addr) : null;
      let row: BoxelTableRowDTO = {
        boxelId: b.id,
        boxel: b.boxel,
        sector: b.sector,
        n,
        name: `${b.prefix}${n}`,
        flown,
        skipped: !flown && skipped.has(n),
        visitedAt: addr != null ? (opts.visitedAt?.(addr) ?? null) : null,
        systemAddress: addr ?? looked?.systems[String(n)]?.id64 ?? null,
        from: null,
        mainStar: null,
        otherStars: [],
        starClasses: [],
        bodies: null,
        notables: [],
        bodyTypes: [],
        bio: null,
      };
      if (!flown && onRoute.has(n)) row.onRoute = true;
      if (j) {
        const species = mergeSpecies(indexSpecies, j.bio.species);
        row = {
          ...row,
          from: "journal",
          mainStar: j.mainStar ?? idx?.mainStar ?? null,
          otherStars: j.otherStars,
          starClasses: j.starClasses.length ? j.starClasses : (idx?.starClasses ?? []),
          bodies: j.bodies,
          notables: j.notables,
          bodyTypes: j.bodyTypes,
          bio: {
            signals: j.bio.signals,
            seen: j.bio.signals > 0 || species.length > 0 || indexSeen,
            species,
          },
        };
      } else if (looked?.systems[String(n)]) {
        // Spansh has every body, so it is read before the index; the index may add EDAstro's species.
        const l = looked.systems[String(n)]!;
        row = {
          ...row,
          from: "lookup",
          mainStar: l.mainStar,
          otherStars: l.otherStars,
          starClasses: l.starClasses,
          bodies: { scanned: null, total: l.bodyCount },
          notables: l.notables,
          bodyTypes: l.bodyTypes,
          bio: {
            signals: null,
            seen: indexSeen || l.species.length > 0,
            species: mergeSpecies(indexSpecies, l.species),
          },
        };
      } else if (sys) {
        row = {
          ...row,
          from: "index",
          mainStar: idx?.mainStar ?? null,
          otherStars: idx?.otherStars ?? [],
          starClasses: idx?.starClasses ?? [],
          bodies: sys.bodyCount ? { scanned: null, total: sys.bodyCount } : null,
          notables: idx?.notables ?? [],
          bodyTypes: idx?.bodyTypes ?? [],
          bio: { signals: null, seen: indexSeen, species: indexSpecies },
        };
      } else if (!flown && onRoute.has(n)) {
        // Only the main star's class: NavRoute.json names nothing else.
        const cls = onRoute.get(n)!.trim();
        const i = starClassIndex(cls);
        row = { ...row, from: "route", mainStar: cls || null, starClasses: i >= 0 ? [STAR_CLASSES[i]!.key] : [] };
      }
      /*
        Not on Spansh only when its search listed the boxel at all: a look-up that found none of it
        cannot tell an undiscovered boxel from a search that missed it, so it marks nothing.
      */
      if (!flown && looked?.complete && foundAny && !looked.systems[String(n)]) row.notOnSpansh = true;
      if (!flown && row.from == null && gapless && n < highestKnown) row.gap = true;
      rows.push(row);
      for (const sp of new Set(indexSpecies)) tally.set(sp, (tally.get(sp) ?? 0) + 1);
    }
  }
  return {
    boxels: opts.boxels,
    rows,
    common: [...tally]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, 8)
      .map(([name, systems]) => ({ name, systems })),
    noIndex: opts.index == null,
    lookups,
  };
}

/** Star classes that make a boxel worth a return (owner: "star types"). */
const RARE_STARS = new Set(["O", "B", "W", "C", "N", "H", "AeBe", "SG"]);
/** How much each notable kind weighs in "notable first". */
const NOTABLE_WEIGHT: Record<string, number> = {
  helium: 10,
  green: 6,
  earthlike: 5,
  ammonia: 4,
  water: 3,
  terraformable: 1,
};

/**
 * Every boxel the commander has flown through (owner, 2026-10-05: all of them, notable first), last
 * visit within `sinceIso` when given. A system with no recorded arrival time counts only under All.
 */
export function previousBoxels(opts: {
  visited: Iterable<VisitedSystem>;
  visitedAt: (systemAddress: number) => string | null;
  journal: (systemAddress: number) => JournalSystemFacts;
  sinceIso: string | null;
  savedPrefixes: ReadonlySet<string>;
}): PreviousBoxelDTO[] {
  const groups = new Map<
    string,
    {
      b: NonNullable<ReturnType<typeof parseBoxel>>;
      systems: { n: number; addr: number | null; name: string; at: string | null }[];
    }
  >();
  for (const v of opts.visited) {
    const { name, addr } = visitedEntry(v);
    const b = parseBoxel(name);
    if (!b || b.index == null) continue;
    const key = b.prefix.toLowerCase();
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { b, systems: [] }));
    g.systems.push({ n: b.index, addr, name, at: addr != null ? opts.visitedAt(addr) : null });
  }
  const out: PreviousBoxelDTO[] = [];
  for (const [key, { b, systems }] of groups) {
    const last = systems.reduce((x, y) => ((y.at ?? "") > (x.at ?? "") ? y : x));
    if (opts.sinceIso && !(last.at && last.at >= opts.sinceIso)) continue;
    const count = new Map<string, number>();
    const rare = new Set<string>();
    const species = new Set<string>();
    let bioSignals = 0;
    for (const s of systems) {
      if (s.addr == null) continue;
      const f = opts.journal(s.addr);
      for (const x of f.notables) count.set(x.kind, (count.get(x.kind) ?? 0) + (x.n ?? 1));
      for (const k of f.starClasses) if (RARE_STARS.has(k)) rare.add(k);
      for (const sp of f.bio.species) species.add(sp);
      bioSignals += f.bio.signals;
    }
    const notables = [...count].map(([kind, n]) => ({ kind, n }) as BoxelNotableDTO);
    const score =
      notables.reduce((t, x) => t + (NOTABLE_WEIGHT[x.kind] ?? 1) * (x.n ?? 1), 0) +
      2 * rare.size +
      species.size;
    out.push({
      prefix: b.prefix,
      boxel: b.boxel,
      sector: b.sector,
      flown: new Set(systems.map((s) => s.n)).size,
      highest: Math.max(...systems.map((s) => s.n)),
      lastVisit: last.at,
      lastSystem: last.name,
      notables,
      bioSignals,
      species: [...species].sort(),
      rareStars: STAR_CLASSES.map((c) => c.key).filter((k) => rare.has(k)),
      score,
      saved: opts.savedPrefixes.has(key),
    });
  }
  return out.sort((x, y) => y.score - x.score || (y.lastVisit ?? "").localeCompare(x.lastVisit ?? ""));
}
