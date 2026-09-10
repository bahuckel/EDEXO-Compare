/**
 * What state each sector of the galaxy is in, for this commander.
 *
 * The map's dots used to be coloured by the strongest evidence anyone had. That answers "what is
 * known here", which is not the question a commander looking at a map is asking. They are asking
 * "is there anything here for me", and the two give opposite answers in the case that matters most:
 * a sector where they have scanned one plant of a thousand comes out "confirmed — you scanned it",
 * when what they need to see is the nine hundred and ninety-nine.
 *
 * So this combines two things that live apart:
 *
 *   the journal   where this commander has been, and what they scanned when they were there
 *   the corpus    what everybody else has recorded, aggregated per 1 280 ly sector
 *
 * and hands the ladder in `shared/galaxyTier.ts` enough to decide. The ladder does the deciding;
 * this only gathers.
 *
 * ## The commander's half never leaves the machine
 *
 * Journal-derived facts are computed here, at request time, from the local store. They are not in
 * the shipped index and never will be — every user gets the same bytes and their own answer. That is
 * the same rule the backlog panel follows, for the same reason.
 */
import type { GalaxyTier, TierFacts } from "../shared/galaxyTier.js";
import { tierFor } from "../shared/galaxyTier.js";
import { sectorCellFromCoords, sectorCellKey } from "../shared/sectorName.js";
import type { GameStateStore } from "./gameState.js";

export interface SectorTierRow {
  /** `x:y:z` sector cell key, matching the sector map file. */
  key: string;
  tier: GalaxyTier;
  facts: TierFacts;
}

/**
 * Facts from the journal alone, per sector cell.
 *
 * A body counts as *scanned by you* when an on-foot scan named something on it — the organic locks.
 * It counts as *unscanned* when the game said there is biology there and no lock exists. Anything
 * with no biological signal is neither: an ordinary rock is not unfinished business.
 */
export function commanderSectorFacts(store: GameStateStore): Map<string, TierFacts> {
  const out = new Map<string, TierFacts>();

  const cellOf = (systemAddress: number): string | null => {
    const pos = store.systemPositions.get(systemAddress);
    if (!pos) return null;
    return sectorCellKey(sectorCellFromCoords(pos.x, pos.y, pos.z));
  };

  const blank = (): TierFacts => ({
    visited: false,
    scannedByYou: 0,
    unscannedByYou: 0,
    confirmedElsewhere: false,
    genusKnown: false,
    signals: false,
  });

  // Visited systems first, so a cell the commander has been to is marked even when it held nothing.
  for (const [addr] of store.visitedSystems) {
    const key = cellOf(addr);
    if (!key) continue;
    const f = out.get(key) ?? blank();
    f.visited = true;
    out.set(key, f);
  }

  for (const body of store.bodies.values()) {
    const key = cellOf(body.systemAddress);
    if (!key) continue;
    const f = out.get(key) ?? blank();
    f.visited = true;
    const hasBiology = (body.biologicalSignals ?? 0) > 0 || (body.genusHints?.length ?? 0) > 0;
    if (body.organicGenusLocks.length > 0) f.scannedByYou++;
    else if (hasBiology) f.unscannedByYou++;
    out.set(key, f);
  }

  return out;
}

/**
 * Merge the commander's facts with the corpus totals for the same cell and pick a tier.
 *
 * `corpus` is the sector map file's per-cell counts, keyed the same way. A cell nobody has visited
 * still gets a row, because "somebody else found a species over there" is exactly the sort of thing
 * a map should be able to say about somewhere you have never been.
 */
export function sectorTiers(
  store: GameStateStore,
  corpus: Map<string, { confirmed: number; genus: number; signal: number }>,
): SectorTierRow[] {
  const mine = commanderSectorFacts(store);
  const keys = new Set<string>([...mine.keys(), ...corpus.keys()]);
  const rows: SectorTierRow[] = [];

  for (const key of keys) {
    const m = mine.get(key);
    const c = corpus.get(key);
    const facts: TierFacts = {
      visited: m?.visited ?? false,
      scannedByYou: m?.scannedByYou ?? 0,
      unscannedByYou: m?.unscannedByYou ?? 0,
      /*
       * Somebody else's confirmed species only counts as a reason to go when *you* have not already
       * worked this cell out. Without that, every sector the commander has finished would keep
       * shouting "confirmed species here" at them forever — the corpus does not know they were the
       * one who logged it.
       */
      confirmedElsewhere: (c?.confirmed ?? 0) > 0 && (m?.scannedByYou ?? 0) === 0,
      genusKnown: (c?.genus ?? 0) > 0,
      signals: (c?.signal ?? 0) > 0,
    };
    rows.push({ key, tier: tierFor(facts), facts });
  }

  return rows;
}

/**
 * Only the commander's half, for the client to merge with the sector file it already loaded.
 *
 * Sending the merged answer would mean the server parsing a 900 kB corpus the browser is holding
 * anyway, and would put the ladder in two places. This sends the part only the server can know —
 * what is in the journals — and the shared module decides on the client.
 *
 * Small: a few thousand visited cells against 5.3 million systems.
 */
export function commanderSectorsDto(store: GameStateStore): {
  available: true;
  rows: { key: string; visited: boolean; scannedByYou: number; unscannedByYou: number }[];
} {
  return {
    available: true,
    rows: [...commanderSectorFacts(store).entries()].map(([key, f]) => ({
      key,
      visited: f.visited,
      scannedByYou: f.scannedByYou,
      unscannedByYou: f.unscannedByYou,
    })),
  };
}
