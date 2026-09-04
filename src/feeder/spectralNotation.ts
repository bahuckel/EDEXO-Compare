/**
 * MK-style spectral shorthand: letter + subclass (0–9) + Yerkes luminosity (roman), e.g. F1VI.
 * Align with {@link edexo-compare} `shared/spectralNotation.ts`.
 */
export function formatFullSpectralNotation(
  starType: string | null | undefined,
  subclass: number | null | undefined,
  luminosity: string | null | undefined,
): string | null {
  const raw = (starType ?? "").trim().toUpperCase();
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
  const parts: string[] = [];
  if (letter) parts.push(letter);
  if (sub != null) parts.push(String(sub));
  if (lum) parts.push(lum.replace(/[^\dIVLX]/g, ""));
  const s = parts.join("");
  return s.length ? s : null;
}
