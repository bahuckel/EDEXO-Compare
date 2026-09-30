/**
 * The phenomena model's numbers (shared/nspOutlook.ts uses them). Fitted on 2026-09-30 from EDAstro's
 * codex file: 1.9 M systems with any codex entry, 98,200 of them with a notable stellar phenomenon.
 * Aggregates only — no system of EDAstro's is in here. 80/20 split; on the held-out fifth, region x
 * main star scored AUC 0.88, plus the nearby-phenomena factor 0.90, and the predictions matched the
 * actual shares (predicted 6 % -> 5 %, 12 % -> 12 %, 59 % -> 74 %). Lifts are shrunk toward 1 for
 * small groups. Regenerate from a new pull the same way (scratch scripts in the dev notes).
 */
/** Share of codex-logged systems with a phenomenon. */
export const NSP_BASE = 0.052;
/** Lift by region (key: regionJoinKey of the region's name). */
export const NSP_REGION_LIFT: Readonly<Record<string, number>> = {
  "abyss": 0.005,
  "acheron": 0.408,
  "achillesaltar": 0.005,
  "aquilahalo": 0.035,
  "arcadianstream": 0.003,
  "conduit": 0.01,
  "drymanpoint": 14.144,
  "elysianshore": 0.003,
  "empyreanstraits": 0.042,
  "errantmarches": 0.005,
  "formidinerift": 0.003,
  "formorianfrontier": 0.825,
  "galacticcentre": 0.011,
  "hawkinggap": 0.02,
  "hieronymusdelta": 0.011,
  "innerorionperseusconflux": 0.092,
  "innerorionspur": 1.407,
  "innerscutumcentaurusarm": 0.086,
  "izanami": 0.685,
  "keplercrest": 0.108,
  "lyrasong": 1.796,
  "maresomnia": 0.758,
  "newtonvault": 0.006,
  "normaarm": 0.663,
  "normaexpanse": 0.019,
  "odinhold": 0.438,
  "orioncygnusarm": 0.006,
  "outerarm": 0.007,
  "outerorionperseusconflux": 0.013,
  "outerorionspur": 1.941,
  "outerscutumcentaurusarm": 0.021,
  "perseusarm": 0.011,
  "rykerhope": 0.007,
  "sagittariuscarinaarm": 13.29,
  "sanguineousrim": 0.004,
  "temple": 0.023,
  "tenebrae": 7.623,
  "trojanbelt": 0.146,
  "veils": 0.014,
  "void": 0.013,
  "vulcangate": 0.108,
  "xibalba": 0.084,
};
/** Lift by main star type (EDAstro's names). */
export const NSP_STAR_LIFT: Readonly<Record<string, number>> = {
  "Black Hole": 2.266,
  "A": 1.412,
  "M": 1.311,
  "C Star": 1.196,
  "T": 1.097,
  "Wolf-Rayet O Star": 1.067,
  "F": 0.925,
  "Wolf-Rayet NC Star": 0.909,
  "CJ Star": 0.901,
  "Wolf-Rayet Star": 0.893,
  "Wolf-Rayet N Star": 0.877,
  "Wolf-Rayet C Star": 0.862,
  "K": 0.853,
  "?": 0.812,
  "L": 0.81,
  "G": 0.726,
  "S-type Star": 0.587,
  "MS-type Star": 0.533,
  "B": 0.524,
  "T Tauri Star": 0.5,
  "White Dwarf": 0.496,
  "Neutron Star": 0.429,
  "CN Star": 0.359,
  "Y": 0.236,
  "Herbig Ae/Be Star": 0.162,
  "O": 0.162,
};
/** Factor by known phenomena systems within 100 ly: 0, 1-4, 5-19, 20-99, 100+. */
export const NSP_NEARBY_FACTOR: readonly number[] = [0.658, 1.057, 1.203, 2.389, 10.574];
