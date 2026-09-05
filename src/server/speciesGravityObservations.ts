/**
 * Has the corpus watched this species grow at this gravity?
 *
 * The fifth field to get the §27 treatment, after the host star, the planet class (§40), the
 * temperature (§41) and the volcanism type (§42). The miss log's last numeric pointers are all one
 * shape — a reading a hair outside the codex edge, on a species the corpus has repeatedly recorded
 * right there:
 *
 *   **Osseus pumice** — codex ceiling 0.27 g, found at 0.2725 g. Of its 99 observed bodies, **22
 *   sit in the top histogram bin, which ends at 0.2728 g**. Tussock capillum, same body, same
 *   ceiling, 17 of 42 in its own top bin.
 *
 * Unlike the temperature wall (§41) this one was never fatal: a reading within
 * {@link NUMERIC_GATE_TOLERANCE} of the edge already demoted rather than deleted. So the win here is
 * smaller and the risk is smaller with it — the rescue moves a row from behind "show unlikely" onto
 * the screen, and only for a gravity the corpus can point at.
 *
 * As in §41 the test is the observed **histogram**, not the observed min–max. Tubus rosarium is the
 * control: found at 0.1502 g against a 0.15 g ceiling, but its eight observed bodies top out at
 * 0.1362 g, so the corpus has nothing to say and the demotion stands.
 */
import type { SpeciesEntry } from "../shared/types.js";
import { loadExomasteryProfile } from "./exomasteryProfile.js";
import { getProjectRoot } from "./paths.js";

const GRAVITY_PATH = "body.gravity";

/**
 * Bodies the corpus needs in the bin containing this reading before it overrules a codex band.
 *
 * Ten, between the twenty §40 and §41 use and the five §42 settled on. Gravity profiles are thinner
 * than temperature profiles — the species this fires for hold 99 and 42 observed bodies, not the
 * 945 behind Fungoida stabitis — and a sixteenth of a species' own gravity range is a narrow slice,
 * so ten bodies in one is already a cluster. Swept in `npm run probe`, with the two rescues at
 * 22 and 17 bodies:
 *
 * | floor | recall | ambiguity | precision |
 * |---|---|---|---|
 * | 5 | 96.9 % | 7.48 | 41.8 % |
 * | **10** | **96.9 %** | **7.47** | **42.0 %** |
 * | 20 | 96.7 % | 7.47 | 42.0 % (loses Tussock capillum) |
 * | 50 | 96.5 % | 7.46 | 42.0 % (rescues nothing) |
 *
 * Five buys nothing recall does not already have at ten, and costs a candidate somewhere; twenty
 * drops one of the two finds this exists for.
 */
export const MIN_GRAVITY_OBSERVATIONS = 10;

export interface GravityObservation {
  /** Bodies observed in the bin containing this reading. */
  observations: number;
  /** Bodies behind the whole histogram. */
  total: number;
  binLowG: number;
  binHighG: number;
}

let rootOverride: string | null = null;

/** Test seam — the matcher has no project root to pass down, so it asks {@link getProjectRoot}. */
export function setGravityObservationsRootForTests(root: string | null): void {
  rootOverride = root;
}

/**
 * How often this species has been recorded at roughly this gravity, or null when it has not been —
 * or when the profile has no histogram to ask.
 */
export function observedAtGravity(
  entry: SpeciesEntry,
  gravityG: number | null | undefined,
  rootArg?: string,
): GravityObservation | null {
  if (gravityG == null || !Number.isFinite(gravityG)) return null;
  const root = rootArg ?? rootOverride ?? getProjectRoot();
  const hist = loadExomasteryProfile(root, entry)?.displayHistograms?.[GRAVITY_PATH];
  if (!hist || hist.counts.length === 0 || !(hist.max > hist.min)) return null;
  if (gravityG < hist.min || gravityG > hist.max) return null;

  const bins = hist.counts.length;
  const step = (hist.max - hist.min) / bins;
  const i = Math.min(bins - 1, Math.floor((gravityG - hist.min) / step));
  const observations = hist.counts[i] ?? 0;
  if (observations < MIN_GRAVITY_OBSERVATIONS) return null;

  return {
    observations,
    total: hist.counts.reduce((a, b) => a + b, 0),
    binLowG: hist.min + step * i,
    binHighG: hist.min + step * (i + 1),
  };
}
