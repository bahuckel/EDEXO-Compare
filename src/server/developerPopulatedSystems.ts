/**
 * The systems Frontier populated — "the Bubble like Tewi" (owner, 2026-09-25).
 *
 * `data/galaxy/developer-populated-systems.json` lists every system Spansh reports as populated and
 * **not** colonised (`is_colonised: false`): the hand-placed populated galaxy, 20,640 systems when it
 * was built. Nothing in a journal separates these from player colonies — both carry a population, and
 * the "Colony" economy also appears on Barnard's Star and 36 Ophiuchi — so the list is how the app
 * tells them apart, and how it knows a system it has never visited is populated.
 *
 * Built by `scripts/build-developer-systems.mjs` from Spansh's system search. The developer set
 * practically never changes; colonies are anything populated that is not on it.
 *
 * System addresses are read with `JSON.parse`, the same way journal lines are, so the few addresses
 * above 2^53 round identically on both sides and still match.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProjectRoot } from "./paths.js";

export interface DeveloperSystemsFile {
  source: string;
  builtAt: string;
  count: number;
  systems: number[];
}

let cached: Set<number> | null = null;

export function developerPopulatedSystemsPath(projectRoot = getProjectRoot()): string {
  return join(projectRoot, "data", "galaxy", "developer-populated-systems.json");
}

/** The list, loaded once. Empty when the file is missing — then only the journal decides. */
export function developerPopulatedSystems(): Set<number> {
  if (cached) return cached;
  try {
    const j = JSON.parse(readFileSync(developerPopulatedSystemsPath(), "utf8")) as DeveloperSystemsFile;
    cached = new Set(Array.isArray(j.systems) ? j.systems : []);
  } catch {
    cached = new Set();
  }
  return cached;
}

export function isDeveloperPopulatedSystem(systemAddress: number): boolean {
  return developerPopulatedSystems().has(systemAddress);
}

/** Test seam. */
/**
 * Did this commander discover this body? The game's `WasDiscovered: false`, unless the system is one
 * Frontier populated.
 *
 * Bubble data says `false` far more often than anyone would guess: in the owner's journals 145 of 487
 * planet scans in Frontier-populated systems, and the arrival stars of Barnard's Star, Alpha Centauri,
 * Ross 775 and Procyon. Nobody discovers those — the game ships them charted — so a "first discovery"
 * there was flying through the Bubble (Discord, 2026-09-25), and so is the first-discoverer bonus in
 * the value estimates: the game does not pay it.
 */
export function commanderFirstDiscoveredBody(
  systemAddress: number,
  wasDiscovered: boolean | undefined,
): boolean {
  return wasDiscovered === false && !isDeveloperPopulatedSystem(systemAddress);
}

export function setDeveloperPopulatedSystemsForTests(addrs: Iterable<number> | null): void {
  cached = addrs ? new Set(addrs) : null;
}
