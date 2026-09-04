/**
 * Candidate game thresholds, proposed for review — never applied automatically.
 *
 * Some band edges are not statistical, they are the game's own step values. Stratum tectonicas' 1,280
 * observed bodies bottom out at *exactly* 165 K across three independent atmosphere cells, and every
 * "Thin …" body ever sampled sits between 9.88 × 10⁻⁴ and 9.87 × 10⁻² atm — which are 10⁻³ and 10⁻¹
 * to within a fraction of a percent. Rounding those edges to the value the engine almost certainly
 * uses makes a band sharper than the sample can justify on its own.
 *
 * It is also the most dangerous change in the project. A wrong hard edge converts a ranking error
 * into a recall loss, and a recall loss is invisible to the commander: they simply never fly there.
 * So this module only ever *proposes*. Four conditions, all required:
 *
 *   1. the cell holds at least {@link SNAP_MIN_SAMPLES} bodies;
 *   2. the observed edge sits within {@link SNAP_TOLERANCE} of the round value;
 *   3. the proposal is written to a review table with its sample count — this file;
 *   4. it survives the probe on both scenario rows before anything uses it.
 *
 * Nothing here is wired into matching. `npm run feeder -- edges` prints the table.
 */
import type { AtmosphereBands, PercentileBand } from "./atmosphereBands.js";

/** A round value proposed from fewer bodies than this is a coincidence, not a threshold. */
export const SNAP_MIN_SAMPLES = 100;

/** The owner's 2 % rule, reused: an edge this close to a round number is that number. */
export const SNAP_TOLERANCE = 0.02;

/**
 * ...and a second condition the 2 % rule needs on a fixed grid.
 *
 * Temperatures are proposed against multiples of 5 K, so no reading is ever more than 2.5 K from
 * some multiple — which at 165 K is 1.5 %, inside tolerance. The percentage alone would therefore
 * "confirm" a threshold at every large cell, which is how the first version of this table produced
 * dozens of one-off values. An edge has to be much nearer its grid point than to the neighbouring
 * ones: within a fifth of the step.
 */
export const SNAP_MAX_GRID_FRACTION = 0.2;

export interface EdgeProposal {
  speciesLabel: string;
  atmosphere: string;
  parameter: "surfaceTemperatureK" | "surfacePressureAtm";
  edge: "min" | "max";
  /** What the bodies actually show. */
  observed: number;
  /** The round value it is within tolerance of. */
  proposed: number;
  /** Relative distance from the round value, as a fraction. */
  deviation: number;
  /** Bodies in the cell. */
  n: number;
}

const TEMPERATURE_STEP_K = 5;

/** Round temperatures the game plausibly steps on: multiples of 5 K. */
function nearestRoundTemperature(v: number): { value: number; step: number } | null {
  if (!Number.isFinite(v) || v <= 0) return null;
  return { value: Math.round(v / TEMPERATURE_STEP_K) * TEMPERATURE_STEP_K, step: TEMPERATURE_STEP_K };
}

/**
 * Round pressures: 1, 2 or 5 times a power of ten. Pressure spans four orders of magnitude, so a
 * fixed step would be meaningless — the thresholds that show up in the data are 10⁻³ and 10⁻¹.
 */
function nearestRoundPressure(v: number): { value: number; step: number } | null {
  if (!Number.isFinite(v) || v <= 0) return null;
  const decade = Math.pow(10, Math.floor(Math.log10(v)));
  const candidates = [1, 2, 5, 10].map((m) => m * decade);
  let best = candidates[0]!;
  for (const cand of candidates) {
    if (Math.abs(v - cand) < Math.abs(v - best)) best = cand;
  }
  // The grid here is multiplicative and its gaps are enormous next to 2 %, so the step condition
  // never binds; it is carried anyway so both parameters go through one rule.
  const others = candidates.filter((c) => c !== best).map((c) => Math.abs(c - best));
  return { value: best, step: others.length ? Math.min(...others) : best };
}

function proposeEdge(
  speciesLabel: string,
  atmosphere: string,
  parameter: EdgeProposal["parameter"],
  edge: EdgeProposal["edge"],
  band: PercentileBand,
): EdgeProposal | null {
  if (band.n < SNAP_MIN_SAMPLES) return null;
  // The observed extreme, not the percentile: a game threshold is a hard floor no body crosses, so
  // it shows up in min/max. p1 and p99 would already have trimmed it away.
  const observed = edge === "min" ? band.min : band.max;
  const round =
    parameter === "surfaceTemperatureK" ? nearestRoundTemperature(observed) : nearestRoundPressure(observed);
  if (round == null || round.value === 0) return null;
  const gap = Math.abs(observed - round.value);
  const deviation = gap / Math.abs(round.value);
  if (deviation > SNAP_TOLERANCE) return null;
  if (gap > round.step * SNAP_MAX_GRID_FRACTION) return null;
  return {
    speciesLabel,
    atmosphere,
    parameter,
    edge,
    observed,
    proposed: round.value,
    deviation,
    n: band.n,
  };
}

export function proposeEdgesForProfile(
  speciesLabel: string,
  bands: AtmosphereBands | undefined,
): EdgeProposal[] {
  if (!bands) return [];
  const out: EdgeProposal[] = [];
  for (const [atmosphere, cell] of Object.entries(bands)) {
    for (const parameter of ["surfaceTemperatureK", "surfacePressureAtm"] as const) {
      const band = cell[parameter];
      if (!band) continue;
      for (const edge of ["min", "max"] as const) {
        const p = proposeEdge(speciesLabel, atmosphere, parameter, edge, band);
        if (p) out.push(p);
      }
    }
  }
  return out;
}

/**
 * Group proposals by the value they agree on.
 *
 * One species hitting 165 K is a fact about that species. Three atmosphere cells and several species
 * bottoming out at the same 165 K is a fact about the game, and that is the difference that decides
 * whether an edge is worth snapping.
 */
export function summariseProposals(all: EdgeProposal[]): {
  key: string;
  proposed: number;
  parameter: EdgeProposal["parameter"];
  edge: EdgeProposal["edge"];
  cells: number;
  species: number;
  bodies: number;
  exact: number;
}[] {
  const groups = new Map<string, EdgeProposal[]>();
  for (const p of all) {
    const key = `${p.parameter}:${p.edge}:${p.proposed}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()]
    .map(([key, ps]) => ({
      key,
      proposed: ps[0]!.proposed,
      parameter: ps[0]!.parameter,
      edge: ps[0]!.edge,
      cells: ps.length,
      species: new Set(ps.map((p) => p.speciesLabel)).size,
      bodies: ps.reduce((s, p) => s + p.n, 0),
      // Cells whose observed extreme *is* the round value, with no rounding at all.
      exact: ps.filter((p) => p.deviation === 0).length,
    }))
    .sort((a, b) => b.cells - a.cells || b.bodies - a.bodies);
}
