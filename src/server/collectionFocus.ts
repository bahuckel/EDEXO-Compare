/**
 * Which species are worth going out of your way for, because our data on them is thin.
 *
 * This is not a ranking of what grows on the body in front of you — that is the matcher's job. It is
 * the other question: *of the things that might be here, which would teach the app the most if you
 * actually sampled one.* A species the corpus has fourteen bodies for is one the envelope is guessing
 * at; a species the commander has already confirmed three times is one we can stop asking about.
 *
 * Measured 2026-09-14 across the shipped profiles: the corpus holds a median of 307 bodies per
 * species but 23 of 101 sit under fifty, and the thin end is where the money is — Fonticulua fluctus
 * (20 M) rests on **14** bodies, Fonticulua segmentatus (19 M) on 16, Concha biconcavis (19 M) on 26.
 * Per-species depth by atmosphere runs from 1,254 bodies on Thin Water down to 10 on airless worlds,
 * a 70× spread, so "rare atmosphere" and "thin data" are very nearly the same statement.
 *
 * **Local only, and deliberately so.** The file lives beside the user's settings, never in the
 * repository: it is derived from one commander's journal, and the owner's standing rule is that the
 * app ships statistics rather than his rows. Nothing here is shipped, committed, or sent anywhere.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveUserSettingsJsonPath } from "./paths.js";
import { collectResolvedOrganicLockSpeciesIds } from "./organicLocks.js";
import {
  hasExomasteryProfileFile,
  loadExomasteryProfile,
  feederProfileBodyCount,
} from "./exomasteryProfile.js";
import type { BodyExoState, SpeciesDatabase, SpeciesEntry } from "../shared/types.js";
import type { CollectionFocusConfig } from "../shared/collectionFocus.js";

export type { CollectionFocusConfig } from "../shared/collectionFocus.js";

export const DEFAULT_COLLECTION_FOCUS: CollectionFocusConfig = {
  formatVersion: 1,
  enabled: true,
  // Three is the sampling run itself: one confirmed body tells us the species can live there, and a
  // third tells us the first was not a freak. Beyond that the corpus learns more than we do.
  targetScans: 3,
  // Just above the thin tail. 23 of 101 profiles sit under 50 bodies and 36 under 150; past that the
  // percentile bands stop moving when another body arrives.
  corpusFloor: 150,
  dismissed: [],
};

export function collectionFocusPath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-collection-focus.json");
}

export function loadCollectionFocusConfig(): CollectionFocusConfig {
  try {
    const p = collectionFocusPath();
    if (!existsSync(p)) return { ...DEFAULT_COLLECTION_FOCUS };
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<CollectionFocusConfig>;
    return {
      formatVersion: 1,
      enabled: raw.enabled !== false,
      targetScans: Number.isFinite(raw.targetScans)
        ? Math.max(1, Number(raw.targetScans))
        : DEFAULT_COLLECTION_FOCUS.targetScans,
      corpusFloor: Number.isFinite(raw.corpusFloor)
        ? Math.max(0, Number(raw.corpusFloor))
        : DEFAULT_COLLECTION_FOCUS.corpusFloor,
      dismissed: Array.isArray(raw.dismissed)
        ? raw.dismissed.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    // A malformed local file is not worth a failed snapshot; the defaults are all this needs.
    return { ...DEFAULT_COLLECTION_FOCUS };
  }
}

export function saveCollectionFocusConfig(cfg: CollectionFocusConfig): void {
  try {
    writeFileSync(collectionFocusPath(), `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  } catch {
    /* best-effort: the marker is a convenience, not state the app depends on */
  }
}

/**
 * How many distinct bodies you have confirmed each species on.
 *
 * Distinct *bodies*, not `ScanOrganic` lines — the sampling run fires three or four events for one
 * plant, and counting those would retire a species after a single patch of ground.
 *
 * A `Log` counts. It names the species in the journal exactly as `Analyse` does, and the whole point
 * of the marker is to stop asking once we know the species grows there; making the commander finish
 * a run they had already decided to walk away from would measure their patience, not the plant.
 */
/*
  What counts as one of "yours": Analyse, Sample **and** Log.

  `organicGenusLocks` is pushed for all three (`gameState.ts`, `isOrganicConfirmation`), so a species
  the commander logged once and walked away from is already answered as far as this marker goes. That
  is deliberate and the owner asked for it explicitly: the point is to stop asking about a species we
  know grows there, and making him finish a run he had decided to abandon would measure his patience
  rather than the plant.
*/
export function ownScanCountsBySpecies(
  bodies: Iterable<BodyExoState>,
  db: SpeciesDatabase,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of bodies) {
    if (!b.organicGenusLocks?.length) continue;
    for (const id of new Set(collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db))) {
      out.set(id, (out.get(id) ?? 0) + 1);
    }
  }
  return out;
}

export interface CollectionFocusReason {
  speciesId: string;
  ownScans: number;
  corpusBodies: number;
  /**
   * How many more of your own confirmations this species still wants, `targetScans - ownScans`.
   *
   * Sent rather than derived on the client so the number on screen always matches the threshold in
   * the local config — which is editable, and will get an Options screen. A client computing
   * `3 - ownScans` would quietly disagree with a commander who had set four.
   */
  remaining: number;
}

/**
 * Species still worth a detour, and why.
 *
 * Both conditions must hold: we are short of your confirmations **and** the corpus is short of
 * bodies. Either alone is not a gap — a species you have never seen but the corpus knows a thousand
 * of needs nothing from you, and one you have sampled ten times is answered whatever the corpus says.
 */
export function computeCollectionFocus(
  bodies: Iterable<BodyExoState>,
  db: SpeciesDatabase,
  projectRoot: string,
  cfg: CollectionFocusConfig = loadCollectionFocusConfig(),
): Map<string, CollectionFocusReason> {
  const out = new Map<string, CollectionFocusReason>();
  if (!cfg.enabled) return out;
  const own = ownScanCountsBySpecies(bodies, db);
  const dismissed = new Set(cfg.dismissed);
  for (const entry of db.species as SpeciesEntry[]) {
    if (dismissed.has(entry.id)) continue;
    const ownScans = own.get(entry.id) ?? 0;
    if (ownScans >= cfg.targetScans) continue;
    const corpusBodies = hasExomasteryProfileFile(projectRoot, entry)
      ? feederProfileBodyCount(loadExomasteryProfile(projectRoot, entry) ?? ({} as never)) || 0
      : 0;
    if (corpusBodies >= cfg.corpusFloor) continue;
    out.set(entry.id, {
      speciesId: entry.id,
      ownScans,
      corpusBodies,
      remaining: Math.max(0, cfg.targetScans - ownScans),
    });
  }
  return out;
}

/**
 * The same answer, memoised for a few seconds.
 *
 * The snapshot builds one body at a time and every one of them would otherwise walk the whole
 * journal's worth of bodies and load every profile — quadratic in a system the commander is
 * scrolling through. A marker that takes a moment to notice your third sighting is no worse for it.
 */
let cached: { at: number; map: Map<string, CollectionFocusReason> } | null = null;
const CACHE_MS = 5_000;

export function collectionFocusCached(
  bodies: Iterable<BodyExoState>,
  db: SpeciesDatabase,
  projectRoot: string,
): Map<string, CollectionFocusReason> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.map;
  const map = computeCollectionFocus(bodies, db, projectRoot);
  cached = { at: now, map };
  return map;
}

/** Drop the memo — for tests, and after the config changes. */
export function clearCollectionFocusCache(): void {
  cached = null;
}
