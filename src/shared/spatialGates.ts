/**
 * Spawn conditions that depend on where a system *is* — INCLUDE-BODY-IDS Phase 7.
 *
 * Three genera are gated on galactic position rather than on anything a body scan reports, and until
 * now the app could only say so and give up (`predictionUnsupported`). The catalogues exist, the
 * thresholds are measured, and this is the check.
 *
 * ## The thresholds are evidence, not choices
 *
 * From `EDSM-targz-to-db/docs/ABSTRACT-COND.md`, measured against edastro's `codex-data.csv`
 * (4.85 M rows, species-level) with controls:
 *
 * | gate | species | measured | control |
 * |---|---|---|---|
 * | nebula < 150 ly | Bark Mounds | 93 % of 23,651 systems | 4–7 % background |
 * | nebula < 150 ly | Electricae radialem | 79 % of 16,370 systems | *pluma 0 %* |
 * | Guardian site < 1,000 ly | Brain Trees | 99 % of 16,062 systems | 15–27 % |
 * | galactic core < 10,000 ly | Sinuous Tubers | 94 % of 5,139 systems | 0–20 % |
 *
 * Planetary nebulae are excluded from the catalogue on evidence: **not one** of 88 Bark Mound systems
 * had one as its nearest neighbour. That leaves 346 real + procgen points.
 *
 * ## Why this demotes rather than deletes
 *
 * The obvious move is a hard cut — outside the radius, remove the species. The measurements say not
 * to. Bark Mounds reach **100 % within 300 ly**, so a cut there loses nothing; but Electricae
 * radialem only reaches **82 % within 300 ly**, which means **roughly one radialem system in five is
 * further from a catalogued nebula than any threshold would allow**. Some of that is surely
 * catalogue incompleteness — procgen nebulae are not all listed — but a hard gate cannot tell the
 * difference between "no nebula here" and "no nebula *recorded* here", and it would silently delete
 * real sightings.
 *
 * So a failed gate marks the candidate **unlikely**, which is a tier the app already has and already
 * collapses behind "show unlikely (N)". It leaves the main list, it does not leave the app, and the
 * reader is told the distance and the rule. That is the no-walls rule kept while still answering the
 * question the commander actually asked.
 *
 * The other direction matters too: passing the gate is **not** evidence the species is present. It
 * removes an objection, nothing more.
 */

export interface SpatialPoint {
  n: string;
  x: number;
  y: number;
  z: number;
  t?: string;
}

export interface SpatialCatalogue {
  generatedAt: string;
  note: string;
  sources: Record<string, string>;
  nebulae: SpatialPoint[];
  guardian: SpatialPoint[];
  core: SpatialPoint;
}

export interface Coords {
  x: number;
  y: number;
  z: number;
}

/** Which spatial condition a species carries. */
export type SpatialGateKind = "nebula" | "guardian" | "core";

export interface SpatialGate {
  kind: SpatialGateKind;
  /** Light years. A system further than this fails the gate. */
  thresholdLy: number;
  /** What the measurement says, for the tooltip — the reader should see why the number is that. */
  evidence: string;
}

/**
 * The gates, keyed by the species-id fragment they apply to.
 *
 * Matched by prefix against the species id, so `electricae_electricae_radialem` is caught while
 * `electricae_electricae_pluma` is not — pluma is star-gated and measured at **0 %** within 150 ly of
 * a nebula, the cleanest possible control for the radialem rule.
 */
export const SPATIAL_GATES: { idIncludes: string; gate: SpatialGate }[] = [
  {
    idIncludes: "electricae_radialem",
    gate: {
      kind: "nebula",
      thresholdLy: 150,
      evidence: "79 % of 16,370 radialem systems are within 150 ly of a nebula; pluma, 0 %",
    },
  },
  {
    idIncludes: "cone",
    gate: {
      kind: "nebula",
      thresholdLy: 150,
      evidence: "93 % of 23,651 Bark Mound systems are within 150 ly of a nebula; background 4–7 %",
    },
  },
  {
    idIncludes: "bark_mound",
    gate: {
      kind: "nebula",
      thresholdLy: 150,
      evidence: "93 % of 23,651 Bark Mound systems are within 150 ly of a nebula; background 4–7 %",
    },
  },
  {
    idIncludes: "brain_tree",
    gate: {
      kind: "guardian",
      thresholdLy: 1000,
      evidence: "99 % of 16,062 Brain Tree systems are within 1,000 ly of a Guardian site; controls 15–27 %",
    },
  },
  {
    idIncludes: "sinuous_tuber",
    gate: {
      kind: "core",
      thresholdLy: 10000,
      evidence: "94 % of 5,139 Sinuous Tuber systems are within 10,000 ly of Sgr A*; controls 0–20 %",
    },
  },
];

/** The gate a species carries, or null when its spawn does not depend on position. */
export function gateForSpeciesId(speciesId: string): SpatialGate | null {
  const id = speciesId.toLowerCase();
  for (const { idIncludes, gate } of SPATIAL_GATES) if (id.includes(idIncludes)) return gate;
  return null;
}

export function distanceLy(a: Coords, b: Coords): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export interface NearestPoint {
  point: SpatialPoint;
  distanceLy: number;
}

/**
 * Nearest catalogue point to a position.
 *
 * A linear scan: the largest catalogue is 346 points, so an index would cost more to build than the
 * scan costs to run, and it is called once per system rather than once per body.
 */
export function nearestPoint(from: Coords, points: readonly SpatialPoint[]): NearestPoint | null {
  let best: NearestPoint | null = null;
  for (const p of points) {
    const d = distanceLy(from, p);
    if (!best || d < best.distanceLy) best = { point: p, distanceLy: d };
  }
  return best;
}

export interface SpatialVerdict {
  kind: SpatialGateKind;
  /** True when the system is inside the measured radius. */
  passes: boolean;
  distanceLy: number;
  thresholdLy: number;
  /** The nebula / Guardian site / Sgr A* the distance is measured to. */
  nearestName: string;
  evidence: string;
}

/**
 * Evaluate a species' spatial gate for a system, or null when there is nothing to evaluate —
 * either the species has no spatial condition, or we have no coordinates for the system.
 *
 * **A missing coordinate returns null, never a failure.** Not knowing where a system is must not
 * look like "the species cannot be here"; that is the absence-of-evidence trap the tri-state flags
 * and `predictionUnsupported` both exist to avoid.
 */
export function evaluateSpatialGate(
  speciesId: string,
  system: Coords | null | undefined,
  catalogue: SpatialCatalogue | null | undefined,
): SpatialVerdict | null {
  const gate = gateForSpeciesId(speciesId);
  if (!gate || !system || !catalogue) return null;

  if (gate.kind === "core") {
    const d = distanceLy(system, catalogue.core);
    return {
      kind: gate.kind,
      passes: d <= gate.thresholdLy,
      distanceLy: d,
      thresholdLy: gate.thresholdLy,
      nearestName: catalogue.core.n,
      evidence: gate.evidence,
    };
  }

  const points = gate.kind === "nebula" ? catalogue.nebulae : catalogue.guardian;
  const near = nearestPoint(system, points);
  if (!near) return null;
  return {
    kind: gate.kind,
    passes: near.distanceLy <= gate.thresholdLy,
    distanceLy: near.distanceLy,
    thresholdLy: gate.thresholdLy,
    nearestName: near.point.n,
    evidence: gate.evidence,
  };
}

/** One line for the reader: the distance, the rule, and the object it was measured to. */
export function describeVerdict(v: SpatialVerdict): string {
  const d = v.distanceLy >= 1000 ? `${Math.round(v.distanceLy / 100) / 10} kly` : `${Math.round(v.distanceLy)} ly`;
  const rule = v.thresholdLy >= 1000 ? `${v.thresholdLy / 1000} kly` : `${v.thresholdLy} ly`;
  // The core is one named place; the other two are "the nearest of many", and the sentence has to
  // read correctly for both rather than gluing an article onto a noun that does not want one.
  const subject =
    v.kind === "core"
      ? v.nearestName
      : `nearest ${v.kind === "nebula" ? "nebula" : "Guardian site"} ${v.nearestName}`;
  return v.passes
    ? `${subject} is ${d} away — inside the ${rule} rule.`
    : `${subject} is ${d} away; the rule is under ${rule}.`;
}
