/**
 * Map planet sample → host star spectral row from `context.starSummaries` (see ED Exo Compare `feederStarHost.ts`).
 */
import { parseDesignationTailFromFullBodyName, parseShortDesignation } from "./eliteDesignation.js";

export interface FeederStarSummary {
  name: string;
  subType?: string;
  spectralClass?: string;
  isScoopable?: boolean;
  /** EDSM body id, present when the summary came from the cached system body list. */
  bodyId?: number;
}

/**
 * ## Host-star luminosity: built, measured and REJECTED (§55)
 *
 * A6 accepted it and §8.2 called it "one line". It is available — EDSM supplies a Yerkes class for
 * **100 %** of stars — so it was built: `luminosity` carried on this summary, collapsed to the
 * numeral (Va/Vab/Vb/Vz → V, the same vocabulary problem as §27), emitted as
 * `exo.host_star_luminosity`, all 93 profiles rebuilt, and measured.
 *
 * | | without | with |
 * |---|---|---|
 * | mean rank | 4.847 | **4.808** |
 * | top-1 | 113 / 437 | **115 / 437** |
 * | top-3 | 230 | 230 |
 * | calibration, mean squared gap | **0.1755** | 0.1832 |
 * | recall, value-weighted, genus, ambiguity, precision, decidable, missing gate | — | **all unchanged** |
 *
 * Two more species ranked first out of 437, no accuracy headline moved at all, and the **calibration
 * got 4.4 % worse**. That is the wrong side of the trade: §32.3's calibration is what licenses the
 * one percentage the app shows a commander (§18 rule 3), and it is not worth spending on an ordering
 * gain this size.
 *
 * The reason is visible in the distribution. Across all 38,403 profile observations the term is
 * **85.6 % a single value** (V), with the remaining 14 % split over five classes thin enough that
 * per-species counts are a handful. A term that says the same thing about six bodies in seven cannot
 * separate them, and the rare classes it could separate are largely re-encoded by the spectral
 * letter already in the model.
 *
 * The sixth idea this project has built and deleted, after expected value (§26.4), region priors
 * (§28), the availability background (§29), the codex envelope (§34) and the no-volcanism rescue
 * (§42.3). Do not rebuild it without new data — rebuild it with a *reason*, and re-measure.
 */

/**
 * The star a body actually orbits, read from its EDSM `parents` chain.
 *
 * `parents` is ordered from the immediate parent outward — `[{Planet: 21}, {Star: 0}]` for a moon of
 * planet 21 orbiting star 0 — so the first `Star` entry is the host. This is exact where the
 * designation heuristic is a guess: a body named `<system> 5 a` carries no star letter, and the
 * heuristic falls back to "A", which silently attributes every such body to the system primary.
 * Measured across 26,120 samples that guess disagrees with the parent chain on 11.6% of bodies, and
 * on 47% of Stratum araneamus.
 *
 * Returns null when the chain is missing or the star is not in `summaries`, so the caller can fall
 * back to the designation heuristic rather than dropping the sample.
 */
export function resolveParentStarSummaryFromParents(
  parents: unknown,
  summaries: FeederStarSummary[] | undefined | null,
): FeederStarSummary | null {
  if (!Array.isArray(parents) || !summaries?.length) return null;
  for (const entry of parents) {
    if (!entry || typeof entry !== "object") continue;
    const starId = (entry as Record<string, unknown>).Star;
    if (typeof starId !== "number") continue;
    return summaries.find((s) => s.bodyId === starId) ?? null;
  }
  return null;
}

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

  const lettersRaw = (d.starLetters ?? "").trim();
  const anchorLetter = lettersRaw ? lettersRaw.charAt(0).toUpperCase() : "A";
  return byLet.get(anchorLetter) ?? null;
}

export function syntheticStarTypeFromFeederSummary(s: FeederStarSummary): string {
  const sc = (s.spectralClass ?? "").trim();
  if (sc) return sc;
  return (s.subType ?? "").trim();
}
