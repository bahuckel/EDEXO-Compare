/**
 * Resolve host-star spectral info from feeder sample JSON (`starSummaries` + body designation),
 * aligned with Elite body names: `{system} {A 1}`, `{system} 1`, implicit primary A when no letter prefix.
 */
import { parseDesignationTailFromFullBodyName, parseShortDesignation } from "./eliteDesignation.js";

export interface FeederStarSummary {
  name: string;
  subType?: string;
  spectralClass?: string;
  /** EDSM / journal letter class when split out. */
  starType?: string;
  subclass?: number;
  luminosity?: string;
  /** Preformatted F1VI-style when source fields allow. */
  fullSpectralNotation?: string;
  isScoopable?: boolean;
}

/** Star suffix letter after `{systemName} `, or lone system name → `"A"` (implicit primary). */
export function feederStarLetterFromSummaryName(summaryName: string, systemName: string): string | null {
  const sn = summaryName.trim();
  const sys = systemName.trim();
  if (!sn || !sys) return null;
  if (sn.localeCompare(sys, undefined, { sensitivity: "accent" }) === 0) return "A";
  const prefix = `${sys} `;
  if (!sn.startsWith(prefix)) return null;
  const rest = sn.slice(prefix.length).trim();
  if (/^[A-Z]$/i.test(rest)) return rest.toUpperCase();
  return null;
}

export function summariesByLetter(
  summaries: FeederStarSummary[],
  systemName: string,
): Map<string, FeederStarSummary> {
  const m = new Map<string, FeederStarSummary>();
  for (const s of summaries) {
    const letter = feederStarLetterFromSummaryName(s.name, systemName);
    if (!letter || m.has(letter)) continue;
    m.set(letter, s);
  }
  return m;
}

function designationAfterSystem(fullBodyName: string, starSystem: string): string {
  const bn = fullBodyName.trim();
  const sys = starSystem.trim();
  if (!bn || !sys) return bn;
  const p = `${sys} `;
  if (bn.startsWith(p)) return bn.slice(p.length).trim();
  return bn;
}

/**
 * Infer host star summary row for this planet from designation (`B 3 a` → star `B`).
 * Single-star shorthand (`3`, `3 a`) uses implicit `A`.
 */
export function resolveFeederHostSummaryForBody(
  fullBodyName: string,
  starSystem: string,
  summaries: FeederStarSummary[] | undefined | null,
): FeederStarSummary | null {
  if (!summaries?.length || !fullBodyName.trim()) return null;
  const sys = starSystem.trim();
  const short = designationAfterSystem(fullBodyName, sys);
  const d = parseShortDesignation(short) ?? parseDesignationTailFromFullBodyName(fullBodyName);
  const byLet = summariesByLetter(summaries, sys || fullBodyName);
  if (!d) return null;

  /** `AB`: use first stellar letter slot for host metadata (closest to System Map letter ordering). */
  const lettersRaw = (d.starLetters ?? "").trim();
  const anchorLetter = lettersRaw ? lettersRaw.charAt(0).toUpperCase() : "A";
  return byLet.get(anchorLetter) ?? null;
}

export function syntheticStarTypeFromFeederSummary(s: FeederStarSummary): string {
  const full = (s.fullSpectralNotation ?? "").trim();
  if (full) return full;
  const sc = (s.spectralClass ?? "").trim();
  if (sc) return sc;
  return (s.subType ?? "").trim();
}
