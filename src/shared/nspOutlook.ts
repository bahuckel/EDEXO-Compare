/**
 * Notable stellar phenomena for one system (owner, 2026-09-30: "a small card that says this system,
 * in this region, might have an NSP").
 *
 * What is known comes first: the commander's own journals (the FSS reports a phenomenon on arrival,
 * the codex names it once he drops in), then EDAstro's codex file (someone logged one there). Only
 * when neither knows does it guess, and the guess is local density: phenomena cluster, so a system
 * whose neighbourhood has many is more likely to have one than a system in an empty stretch.
 *
 * Measured on 2026-09-30 against EDAstro's 96,780 NSP systems and the 5.3 M-system galaxy index, with
 * each system's own entry left out: within 100 ly, 75 % of NSP systems have another NSP system, against
 * 24 % of systems in general (AUC 0.81). Of random indexed systems, the share that had one by local
 * rate: under 0.5 % → 0.1 %; 0.5–4 % → 0.5–0.8 %; 4–8 % → 2 %; 8–16 % → 6 %; over 16 % → 15 %.
 * The levels below follow those buckets. Honest scale: even "high" is roughly one system in seven.
 */

/** The codex families that are phenomena, by codex id (same as the EDAstro NSP list). Not L-type stars. */
const NSP_CODEX = /^codex_ent_(gas_clds|small_org|l_(?!type)|s_|spoi)/i;

/** A `CodexEntry` Name (`$Codex_Ent_Gas_Clds_Light_Name;`) or a codex id that is a phenomenon. */
export function isNspCodexName(name: string | null | undefined): boolean {
  const id = (name ?? "").trim().replace(/^\$/, "").replace(/_name;?$/i, "").toLowerCase();
  return NSP_CODEX.test(id);
}

export type NspChance = "low" | "medium" | "high";

/** Fewer known systems than this within the radius, and the neighbourhood says nothing. */
export const NSP_THIN_KNOWN = 25;

/** Within this radius the neighbourhood is counted. */
export const NSP_OUTLOOK_RADIUS_LY = 100;

/** Local rate (NSP systems / known systems within the radius) → chance level. */
export function nspChanceFor(rate: number): NspChance {
  if (rate >= 0.08) return "high";
  if (rate >= 0.04) return "medium";
  return "low";
}

/** What "low / medium / high" meant in the 2026-09-30 test, for the card's tooltip. */
export const NSP_CHANCE_WORDS: Record<NspChance, string> = {
  low: "about 1 in 100 or less",
  medium: "about 1 in 50",
  high: "about 1 in 7 to 1 in 15",
};

export interface NspOutlookDTO {
  systemAddress: number;
  /** Phenomena the commander met here (journal): names, "" for an FSS signal not yet named. */
  seen: string[];
  /** Phenomena EDAstro's codex file has for this system: their families ("Lagrange cloud")... */
  logged: string[];
  /** ...and the entries themselves ("Viride Lagrange Cloud"), for the tooltip. */
  loggedDetail: string[];
  /** The guess, when neither knows: null if there is nothing to guess from (no galaxy index). */
  guess: {
    chance: NspChance;
    /** Systems with a phenomenon within the radius, and indexed systems within it. */
    nspSystems: number;
    knownSystems: number;
    radiusLy: number;
    /** Too few known systems around to say anything (under {@link NSP_THIN_KNOWN}). */
    thin: boolean;
  } | null;
  /** Nearest phenomena of different kinds, nearest first (up to 4). */
  nearest: { name: string; system: string; distanceLy: number }[];
  region: string | null;
}
