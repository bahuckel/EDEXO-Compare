/**
 * Constants, types and formatters the galaxy search and its dialogs share. Split out of GalaxySearchPanel.tsx (code review D, 2026-09-27).
 */
/** Evidence flags, mirroring src/server/bioIndex.ts. */
const TIER_FSS = 1;
export const TIER_DSS = 2;
const TIER_CODEX = 4;

export const crFmt = new Intl.NumberFormat("en-US");
export const cr = (n: number) => `${crFmt.format(Math.round(n))} CR`;
export const ly = (d: number | null) =>
  d == null ? "—" : d >= 10000 ? `${(d / 1000).toFixed(1)} kly` : `${crFmt.format(Math.round(d))} ly`;

/**
 * The slider's range, in credits: nothing to half a billion, per system, at 1x.
 *
 * Per system because that is the unit of a trip — four 5 M plants in one place beat one 15 M plant.
 * At 1x because the index cannot know whether anybody has already walked those bodies; a commander
 * who arrives and finds them untouched earns five times this, and the row says so beside it.
 *
 * Stepped in millions rather than credits: nobody is choosing between 19,000,000 and 19,000,001, and
 * a slider that pretends they are is 500 million positions of false precision.
 */
export const MAX_CR = 500e6;
export const STEP_CR = 1e6;
export const sliderLabel = (n: number) =>
  n === 0 ? "anything" : n >= 1e9 ? `${(n / 1e9).toFixed(2)} B CR` : `${Math.round(n / 1e6)} M CR`;

/**
 * One place the search found, as the map needs it.
 *
 * The map draws *places*, so this is the whole of what it is told about one: where it is, what it
 * is called, and one line of prose for the tooltip. `note` exists because the two searches make
 * different claims — "19,010,800 CR recorded" is a sighting somebody logged, "2 bodies could hold
 * it" is a shortlist — and a map that printed credits over a prediction would be quietly lying.
 */
export interface GalaxySearchMark {
  systemAddress: number;
  starSystem: string;
  x: number;
  y: number;
  z: number;
  distanceLy: number | null;
  /** What this mark is, in a few words. Goes straight into the tooltip. */
  note: string;
}

/**
 * What a search, once run, asks of the map below it.
 *
 * `genus` and `species` are **lowercase**, which is the sector map file's own vocabulary
 * (`"bacterium"`, `"bacterium aurasus"`). The map does the widening from a genus to its taxa,
 * because the map is what holds the file that knows which taxa exist.
 *
 * Both are **null in predicted mode**, deliberately. Those names light up the sectors where the
 * corpus has *recorded* the taxon, and a predicted search is by definition about the places where
 * nobody has. Narrowing the sectors to recorded ground while the marks sit outside it would be the
 * map contradicting itself.
 */
export interface GalaxySearchApplied {
  genus: string | null;
  species: string | null;
  /** What to call this filter on screen. */
  label: string;
  /**
   * What the **map** draws: one system per matching sector cell, over the whole search.
   *
   * Not the same rows the list shows. The list is nearest-first, which is right for choosing where
   * to fly and wrong for seeing where a species lives — the 200 nearest matches to a commander sit
   * inside about twelve pixels of a galaxy-wide plot, which is what the owner saw and could not
   * identify. Falls back to the nearest hits on a server that has no spread to give.
   */
  hits: GalaxySearchMark[];
  /** Distinct sector cells that matched, before the sample was capped. */
  spreadCells: number;
  matchedSystems: number;
}

/**
 * The strongest evidence a system carries, which is what colours its row.
 *
 * Strongest rather than all of them: a system with a confirmed species *and* unexplored signals is
 * best described by the species, and the extra signals show up in the body count beside it.
 */
export function evidence(tiers: number): { label: string; className: string; help: string } {
  if (tiers & TIER_CODEX)
    return {
      label: "species",
      className: "gsx-tier gsx-tier--codex",
      help: "A commander logged a species here on foot. The strongest evidence there is.",
    };
  if (tiers & TIER_DSS)
    return {
      label: "genus",
      className: "gsx-tier gsx-tier--dss",
      help: "Somebody mapped a body here with probes, so the genus is known but not which species.",
    };
  if (tiers & TIER_FSS)
    return {
      label: "signals",
      className: "gsx-tier gsx-tier--fss",
      help: "An FSS scan counted biological signals. Nothing has named them.",
    };
  return { label: "—", className: "gsx-tier", help: "No biological evidence recorded." };
}
