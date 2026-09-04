/**
 * In-game planet orbital slots use stripped designations: `N`, `A N`, `Body N`, etc. (no moon letter).
 * Journal may still classify some occupiers as stellar (`explorationRecordIsStellar`); map + placeholder
 * merge must key them by the same designation as worlds.
 */
import type { ExplorationScanRecord } from "./types.js";
import { parseDesignationTailFromFullBodyName, parseShortDesignation } from "./eliteDesignation.js";
import { shortBodyLabel } from "./systemMapLabels.js";

export function bodyNameHasPlanetSlotDesignation(bodyName: string, starSystemName: string): boolean {
  const sys = starSystemName.trim();
  if (!sys) return false;
  const bn = bodyName.trim();
  const short = shortBodyLabel(bn, sys);
  /** Primary star row — never treat as a numbered planet slot. */
  if (short === "★") return false;
  const fromShort = parseShortDesignation(short);
  if (fromShort) return !fromShort.moon && fromShort.major >= 1;
  /**
   * Tail parse on the full `BodyName` sees trailing digits in procedural system coordinates (… d2-3).
   * Only run when the body is not the bare system name (that case is already ★ above).
   */
  if (bn === sys) return false;
  const tail = parseDesignationTailFromFullBodyName(bn);
  return tail != null && !tail.moon && tail.major >= 1;
}

export function explorationRecordHasPlanetSlotDesignation(
  r: ExplorationScanRecord,
  starSystemName: string,
): boolean {
  if (r.isBarycentreJournal) return false;
  return bodyNameHasPlanetSlotDesignation(r.bodyName, starSystemName);
}
