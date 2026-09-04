import type { JournalHostStarObservation, SpeciesMatchContext } from "../shared/types.js";
import { journalStarPrimarySpectralLetter } from "../shared/genusStarColorSoft.js";

export function journalHostObservationFromSpeciesContext(
  ctx: SpeciesMatchContext,
): JournalHostStarObservation | null {
  const rawStar = ctx.parentStarType?.trim() ?? "";
  if (!rawStar) return null;
  const jl = journalStarPrimarySpectralLetter(rawStar);
  const spectralLetter = jl !== "—" ? jl : null;
  let subclass: number | null =
    typeof ctx.parentStarSubclass === "number" && Number.isFinite(ctx.parentStarSubclass)
      ? ctx.parentStarSubclass
      : null;
  subclass = subclass != null ? Math.min(99, Math.max(0, Math.round(subclass))) : null;

  const lum = ctx.parentStarLuminosity?.trim() || null;
  return {
    starTypeRaw: rawStar,
    spectralLetter,
    subclass,
    luminosity: lum,
  };
}
