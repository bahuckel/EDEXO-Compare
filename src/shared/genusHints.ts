import type { GenusHint } from "./types.js";

/** True when journal DSS genus hints mention Bacterium (localised or codex symbol). */
export function dssHintsIncludeBacterium(hints: GenusHint[] | null | undefined): boolean {
  if (!hints?.length) return false;
  for (const h of hints) {
    const loc = (h.Genus_Localised ?? "").trim().toLowerCase();
    const sym = (h.Genus ?? "").trim().toLowerCase();
    if (loc === "bacterium" || loc.includes("bacteria")) return true;
    if (sym.includes("bacterial")) return true;
  }
  return false;
}
