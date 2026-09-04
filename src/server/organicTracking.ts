import type { JournalLine } from "../shared/types.js";
import { normOrganicToken } from "../shared/organicLabelMatch.js";

export { normOrganicToken } from "../shared/organicLabelMatch.js";

/** Stable key from journal symbols (preferred) or localised strings. */
export function speciesKeyFromOrganicJournal(line: JournalLine): string {
  const gv = typeof line.Genus === "string" ? line.Genus.trim() : "";
  const sv = typeof line.Species === "string" ? line.Species.trim() : "";
  const vv = typeof line.Variant === "string" ? line.Variant.trim() : "";
  if (gv || sv || vv) return normOrganicToken(`${gv}|${sv}|${vv}`);
  const gl = typeof line.Genus_Localised === "string" ? line.Genus_Localised.trim() : "";
  const sl = typeof line.Species_Localised === "string" ? line.Species_Localised.trim() : "";
  const vl = typeof line.Variant_Localised === "string" ? line.Variant_Localised.trim() : "";
  return normOrganicToken(`${gl}|${sl}|${vl}`);
}

export function speciesKeyFromSellBio(bio: Record<string, unknown>): string {
  return speciesKeyFromOrganicJournal(bio as JournalLine);
}

/**
 * Exobiology on-foot: typically two `Sample` then one `Analyse`; the `Analyse` line means
 * that genus/species/variant is complete on that body and ready to sell.
 * `Log` does not advance progress.
 */
export function nextOrganicProgressCount(prev: number, line: JournalLine): number | null {
  const st = line.ScanType as string | undefined;
  if (st === "Log") return null;
  if (st === "Analyse") return 3;
  if (st === "Sample") return Math.min(2, prev + 1);
  if (!st) return Math.min(3, prev + 1);
  return null;
}

export function displayLabelFromOrganicLine(line: JournalLine): string {
  const vl = typeof line.Variant_Localised === "string" ? line.Variant_Localised.trim() : "";
  if (vl) return vl;
  const sl = typeof line.Species_Localised === "string" ? line.Species_Localised.trim() : "";
  const gl = typeof line.Genus_Localised === "string" ? line.Genus_Localised.trim() : "";
  return [gl, sl].filter(Boolean).join(" ") || "Unknown";
}

export { speciesEntryMatchesOrganicLabel } from "../shared/organicLabelMatch.js";
