import type { SpeciesEntry } from "./types.js";

/** Optional UI: genus folder `bacterium` excluded from matching by default elsewhere. */
export function isBacteriumSpeciesEntry(e: SpeciesEntry): boolean {
  if (e.genusDataDir.trim().toLowerCase() === "bacterium") return true;
  return (e.genus || "").trim().toLowerCase() === "bacterium";
}
