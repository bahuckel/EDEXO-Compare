/**
 * "Unknown plant" rows (owner, 2026-10-03): a body whose signals the candidate list cannot fill gets
 * a placeholder for each empty slot, so a one-signal body with no candidate still says "there is
 * something here, go and look" instead of an empty panel.
 *
 * After a DSS the slots are the named genera with no shown row (the server's
 * `dssGenusOrphanHints`). Before it, the slots are the signals left once each shown genus has taken
 * one — the game places one genus per signal and never the same genus twice. With Bacterium switched
 * off, one signal is taken to be its slot, as the shortfall alert does.
 */
import type { GenusHint, SpeciesMatch } from "./types.js";
import { genusNameForCodexToken } from "./codexGenusNames.js";
import { dssHintsIncludeBacterium } from "./genusHints.js";

export interface UnknownPlantSlot {
  /** The genus the DSS named, or null before a DSS. */
  genus: string | null;
  /** Nothing else is listed and Bacterium is switched off: most likely that. */
  maybeBacterium?: boolean;
}

export function unknownPlantSlots(input: {
  signals: number | null | undefined;
  matches: readonly SpeciesMatch[];
  genusHints: readonly GenusHint[] | null | undefined;
  orphanHints: readonly GenusHint[] | null | undefined;
  includeBacterium: boolean;
}): UnknownPlantSlot[] {
  const shown = input.matches.filter((m) => !m.unlikely || m.sampledHere === true);
  if (input.genusHints?.length) {
    const orphans = input.orphanHints ?? [];
    // Bacterium switched off: its rows are left out on purpose, so a named Bacterium is not unknown.
    const bacteriumHidden =
      !input.includeBacterium && orphans.some((h) => dssHintsIncludeBacterium([h as GenusHint]));
    const slots = orphans
      .filter((h) => input.includeBacterium || !dssHintsIncludeBacterium([h as GenusHint]))
      .map((h) => ({
        genus: h.Genus_Localised?.trim() || genusNameForCodexToken(h.Genus ?? "") || h.Genus || null,
      }));
    // ... but a body with nothing else on it says so rather than showing an empty list.
    if (bacteriumHidden && slots.length === 0 && shown.length === 0)
      return [{ genus: "Bacterium", maybeBacterium: true }];
    return slots;
  }
  const signals = input.signals ?? 0;
  if (!(signals > 0)) return [];
  const genera = new Set(shown.map((m) => m.entry.genusDataDir));
  const assumedBacterium = !input.includeBacterium && !genera.has("bacterium") ? 1 : 0;
  const empty = Math.max(0, signals - genera.size - assumedBacterium);
  // A body with nothing listed at all still gets its row, even when the one signal is likely the
  // Bacterium the toggle hides.
  if (empty === 0 && genera.size === 0) return [{ genus: null, maybeBacterium: true }];
  return Array.from({ length: empty }, () => ({ genus: null }));
}
