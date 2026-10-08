/**
 * The ship's full jump range as flown (owner, 2026-10-08): "sometimes me and other commanders do
 * economical routes … if the commander makes 66-67-68 ly jumps, that's the full potential, and it
 * should also exclude neutron jumps".
 *
 * The journal's `MaxJumpRange` is the range with an empty tank (71.6 ly on his Mandalay against 68 ly
 * flown), and a plain average drops whenever an economical route is plotted. So:
 * - a boosted jump (neutron or white dwarf supercharge, synthesis injection: `BoostUsed` on the
 *   `FSDJump` line) is left out;
 * - a jump shorter than `LONG_SHARE` of the full range is an economical-route hop: it is left out of
 *   the full range, however many of them come in a row;
 * - the full range is the 90th percentile of the last `JUMP_RANGE_SAMPLES` long jumps;
 * - another ship, or a refit that changes the loadout's own range, starts over.
 */

export const JUMP_RANGE_SAMPLES = 40;
/** A jump this share of the full range or more is a full-range jump. */
export const LONG_SHARE = 0.6;
/** Full-range jumps needed before the estimate stands in for the loadout's range. */
export const MIN_LONG_JUMPS = 3;
/** Short jumps kept, to tell an economical route. */
const RECENT = 5;

export interface JumpRangeState {
  /** The ship and its loadout range the samples are from (`Loadout.ShipID`, `MaxJumpRange`). */
  shipId: number | null;
  loadoutLy: number | null;
  /** Full-range jumps (ly), oldest first. */
  long: number[];
  /** The last few unboosted jumps, long or short. */
  recent: number[];
}

export function emptyJumpRange(): JumpRangeState {
  return { shipId: null, loadoutLy: null, long: [], recent: [] };
}

/** A `Loadout`: another ship, or a refit that moved its own range by more than 2 %, starts over. */
export function jumpRangeLoadout(
  st: JumpRangeState,
  shipId: number | null,
  maxJumpRangeLy: number | null,
): void {
  const refit =
    st.loadoutLy != null &&
    maxJumpRangeLy != null &&
    Math.abs(maxJumpRangeLy - st.loadoutLy) > 0.02 * st.loadoutLy;
  if ((shipId != null && shipId !== st.shipId) || refit) {
    st.long = [];
    st.recent = [];
  }
  if (shipId != null) st.shipId = shipId;
  if (maxJumpRangeLy != null) st.loadoutLy = maxJumpRangeLy;
}

/** An `FSDJump`'s distance. */
export function jumpRangeJump(st: JumpRangeState, distLy: number, boostUsed: unknown): void {
  if (!(distLy > 0) || !Number.isFinite(distLy)) return;
  if (typeof boostUsed === "number" && boostUsed > 0) return;
  st.recent.push(distLy);
  if (st.recent.length > RECENT) st.recent.shift();
  const full = fullJumpRange(st);
  // Until there is a full range, every jump counts; the short ones fall out once the long ones are in.
  if (full != null && distLy < LONG_SHARE * full) return;
  st.long.push(distLy);
  const top = Math.max(...st.long);
  st.long = st.long.filter((d) => d >= LONG_SHARE * top).slice(-JUMP_RANGE_SAMPLES);
}

/** The full jump range as flown, or null until `MIN_LONG_JUMPS` full-range jumps are in. */
export function fullJumpRange(st: JumpRangeState): number | null {
  if (st.long.length < MIN_LONG_JUMPS) return null;
  const s = [...st.long].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)]!;
}

/** The last few jumps were all short: an economical route is being flown. */
export function onEconomicalRoute(st: JumpRangeState): boolean {
  const full = fullJumpRange(st);
  return full != null && st.recent.length >= 3 && st.recent.slice(-3).every((d) => d < LONG_SHARE * full);
}
