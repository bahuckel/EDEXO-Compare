/**
 * Full MK-style spectral string from Elite journal Scan ({@link ExplorationScanRecord}):
 * letter + subclass (0–9) + Yerkes luminosity roman (e.g. F1VI).
 */
export function formatFullSpectralNotation(
  starType: string | null | undefined,
  subclass: number | null | undefined,
  luminosity: string | null | undefined,
): string | null {
  const raw = (starType ?? "").trim().toUpperCase();
  /** Game uses "F", "Ae", neutron classes, brown dwarfs L/T/Y … */
  const letterMatch = /^([OBAFGKMNLTTYWD])[A-Z]?/i.exec(raw);
  const letter = letterMatch?.[1]?.toUpperCase() ?? "";
  const lum = (luminosity ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^IVLX0-9]+/g, "");
  const sub =
    subclass != null && Number.isFinite(subclass)
      ? Math.min(99, Math.max(0, Math.round(subclass as number)))
      : null;

  if (!letter && !lum && sub == null) return null;
  const core = letter + (sub != null ? String(sub) : "");
  const lumClean = lum ? lum.replace(/[^\dIVLX]/g, "") : "";
  if (lumClean) {
    const s = core || letter ? `${core || letter} ${lumClean}`.trim() : lumClean;
    return s.length ? s : null;
  }
  return core.length ? core : null;
}

/**
 * One-character map disc glyph (spectral letter when `StarType` parses; else YSO / compact-object hints from `PlanetClass`).
 */
export function spectralDiscGlyph(
  starType: string | null | undefined,
  subclass: number | null | undefined,
  planetClass: string | null | undefined,
): string {
  const mk = formatFullSpectralNotation(starType, subclass, null);
  if (mk) return mk.charAt(0).toUpperCase();

  const raw = (starType ?? "").trim();
  if (raw.length > 0) return raw.charAt(0).toUpperCase();

  const pc = (planetClass ?? "").toLowerCase();
  if (pc.includes("t tauri") || pc.includes("ttauri") || pc.includes("t-tauri")) return "T";
  if (pc.includes("herbig")) return "H";
  if (pc.includes("protostar") || pc.includes("proto-star")) return "P";
  if (pc.includes("young stellar") || /\byso\b/.test(pc)) return "Y";
  if (pc.includes("white dwarf")) return "D";
  if (pc.includes("neutron")) return "N";
  if (pc.includes("black hole")) return "B";
  if (pc.includes("wolf-rayet") || pc.includes("wolf–rayet")) return "W";
  if (pc.includes("carbon star")) return "C";
  if (pc.includes("brown dwarf")) return "L";

  return "?";
}
