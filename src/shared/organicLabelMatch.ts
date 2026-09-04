import type { SpeciesEntry } from "./types.js";

export function normOrganicToken(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Fuzzy match of journal `ScanOrganic` display label to a codex {@link SpeciesEntry}. */
export function speciesEntryMatchesOrganicLabel(entry: SpeciesEntry, scanLabel: string): boolean {
  const a = normOrganicToken(entry.displayName);
  const b = normOrganicToken(scanLabel);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.includes(a) || a.includes(b)) return true;
  const idn = normOrganicToken(entry.id);
  if (idn && (b.includes(idn) || idn.includes(b))) return true;
  return false;
}
