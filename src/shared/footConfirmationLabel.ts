import type { FootCatalogConfirmation } from "./dto/footCatalog.js";

/**
 * How far the commander got with a species on that body, in words (2026-09-30). The lists used to
 * say "Analyse" for anything that was not a Sample, so a species that was only logged read as
 * analysed. Rows written before the source was recorded count as analysed, as the catalog does.
 */
export function footConfirmationLabel(s: FootCatalogConfirmation | null | undefined): string {
  return s === "log" ? "Logged" : s === "sample" ? "Sampled" : "Analysed";
}
