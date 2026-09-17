/**
 * How often a landable, atmosphere-bearing body carries **any** biology, by surface gravity.
 *
 * This is the strongest single predictor found in the commander's journals, and it is not in the
 * species criteria anywhere — those answer "which plant, given something is here". This answers the
 * question before it: *is anything here at all*. That question is worth nothing once he is in the
 * system, because the FSS tells him for free. It is worth a great deal for a body nobody has
 * visited, which is exactly what the galaxy scan lists.
 *
 * ## The measurement
 *
 * 10,038 landable bodies from his own journals with a **decided** answer — a body is decided when it
 * carries an `FSSBodySignals`/`SAASignalsFound` line, or sits in a system that fired
 * `FSSAllBodiesFound` (the honk found every body and reported nothing on this one). Of those, 1,795
 * have an atmosphere; the rest are airless and carry biology at a rate of **0 in 8,239**.
 *
 * ```
 *              0-.20  .20-.25  .25-.30  .30-.35  .35-.40  .40-.45  .45-.50  .50-.55  .55-.60  .60-.65  .65+
 *   share      100%     100%      92%      73%      73%      59%      44%      38%      14%       3%     0%
 *   bodies      603      143       76      103      208      222      190      112       72       34     32
 * ```
 *
 * **746 of 746** atmosphere-bearing bodies below 0.25 g carry biology. **0 of 32** above 0.65 g.
 *
 * ## Why it is believed
 *
 * Two controls, because both alternatives were more likely than the finding:
 *
 * - **Not a planet-class artefact.** Icy bodies are light and High metal content ones heavy, so
 *   pooling classes could have measured the class. The curve holds *within* every class — Icy runs
 *   100/100/88/62/68/52/38/25/10/0, HMC 100/100/100/100/84/79/60/51/20/0.
 * - **Not pressure in disguise.** A heavier body holds thicker air and exobiology wants thin air, so
 *   gravity could have been a proxy for pressure. Holding each fixed in turn: pressure alone across
 *   100→10,000 Pa is flat (76/65/76/72 %), while gravity inside a fixed 300–3,000 Pa slice keeps the
 *   whole curve (100/79/51/45/7 %). Gravity spans 14× and survives; pressure spans 1.8× and does not.
 *
 * ## What it is not
 *
 * - **Signal presence, not species.** A body can clear this and grow something the commander does
 *   not want.
 * - **His flight history, not a galaxy sample.** Where he has flown decides what is in here.
 * - **Thin at the ends.** The 0 % band rests on 32 bodies. Zero observations out of 32 is not proof
 *   of impossibility, which is why {@link gravityBiologyOdds} reports a *smoothed* figure alongside
 *   the raw one and the filter uses the smoothed value. 0/32 becomes 1.5 %, not 0 %.
 *
 * It is therefore reported and offered as a filter, never used as a gate on its own. The scan's
 * standing rule is that its gates are a superset of the matcher's — a speed-up, never a second
 * opinion — and a curve from one commander's logs has no business quietly deleting rows.
 */

/** One measured band: `[minG, maxG)`, the share that carried biology, and how many bodies that was. */
type Band = { minG: number; maxG: number; sharePct: number; bodies: number };

/**
 * The curve, as measured. `maxG` on the last band is Infinity.
 *
 * Shares are recorded exactly as the measurement reported them — whole percentages — rather than as
 * hit counts, because whole percentages are what was computed and reconstructed integers would look
 * more precise than the thing they came from.
 */
const BANDS: readonly Band[] = [
  { minG: 0, maxG: 0.2, sharePct: 100, bodies: 603 },
  { minG: 0.2, maxG: 0.25, sharePct: 100, bodies: 143 },
  { minG: 0.25, maxG: 0.3, sharePct: 92, bodies: 76 },
  { minG: 0.3, maxG: 0.35, sharePct: 73, bodies: 103 },
  { minG: 0.35, maxG: 0.4, sharePct: 73, bodies: 208 },
  { minG: 0.4, maxG: 0.45, sharePct: 59, bodies: 222 },
  { minG: 0.45, maxG: 0.5, sharePct: 44, bodies: 190 },
  { minG: 0.5, maxG: 0.55, sharePct: 38, bodies: 112 },
  { minG: 0.55, maxG: 0.6, sharePct: 14, bodies: 72 },
  { minG: 0.6, maxG: 0.65, sharePct: 3, bodies: 34 },
  { minG: 0.65, maxG: Infinity, sharePct: 0, bodies: 32 },
];

export type GravityBiologyOdds = {
  /** The share as measured, whole percent. */
  observedPct: number;
  /**
   * The same figure with a Jeffreys prior, whole percent.
   *
   * `(hits + 0.5) / (bodies + 1)`. It is what the filter compares against, because the raw ends of
   * this curve are the parts with the fewest bodies behind them and they are the parts a threshold
   * lands on. Without it a 0.7 g body would be excluded by a measurement of zero out of thirty-two,
   * which is a real observation and not a law.
   */
  smoothedPct: number;
  /** How many bodies the band was measured from — the honest caveat, shown with the figure. */
  bodies: number;
  /** `0.45–0.50 g`, for a label. */
  bandLabel: string;
};

function label(b: Band): string {
  return b.maxG === Infinity ? `${b.minG.toFixed(2)} g and above` : `${b.minG.toFixed(2)}–${b.maxG.toFixed(2)} g`;
}

/**
 * The odds for one body, or `null` when the curve does not apply.
 *
 * Null for an airless body and for one whose gravity the dump never recorded. Airless is **not**
 * reported as 0 % despite measuring 0 of 8,239: every species the scan can offer needs an
 * atmosphere, so an airless body reaching this point means something else is unusual, and answering
 * a question the curve was not measured on would be worse than saying nothing.
 */
export function gravityBiologyOdds(gravityG: number, hasAtmosphere: boolean): GravityBiologyOdds | null {
  if (!hasAtmosphere) return null;
  if (!Number.isFinite(gravityG) || gravityG <= 0) return null;
  const band = BANDS.find((b) => gravityG >= b.minG && gravityG < b.maxG);
  if (!band) return null;
  const hits = (band.sharePct / 100) * band.bodies;
  return {
    observedPct: band.sharePct,
    smoothedPct: Math.round(((hits + 0.5) / (band.bodies + 1)) * 100),
    bodies: band.bodies,
    bandLabel: label(band),
  };
}

/** The whole curve, for a panel that wants to show what it is filtering by. */
export function gravityBiologyCurve(): readonly { bandLabel: string; sharePct: number; bodies: number }[] {
  return BANDS.map((b) => ({ bandLabel: label(b), sharePct: b.sharePct, bodies: b.bodies }));
}

/**
 * Does this body clear a minimum?
 *
 * A body the curve cannot speak for (airless, or no recorded gravity) **passes**. The filter is a
 * statement about gravity, and "unknown" is not "unlikely" — silently dropping the bodies the dump
 * recorded least well would quietly bias the shortlist toward well-documented systems.
 */
export function clearsGravityOdds(gravityG: number, hasAtmosphere: boolean, minPct: number): boolean {
  if (minPct <= 0) return true;
  const odds = gravityBiologyOdds(gravityG, hasAtmosphere);
  if (!odds) return true;
  return odds.smoothedPct >= minPct;
}
