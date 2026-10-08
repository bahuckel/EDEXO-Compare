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
 * | Guardian site < 1,250 ly | Brain Trees | 99 % of 16,062 systems within 1,000 ly; all 4,142 confirmed bodies within 1,223 | 15–27 % |
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
  /** Where a species has been recorded (scripts/add-codex-records.ts), for a gate's `records` check. */
  records?: Record<string, SpatialPoint[]>;
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
  /**
   * A second, wider radius (owner, 2026-09-26, for Bark Mounds): between `thresholdLy` and this the
   * species stays in the main list with its chance multiplied by {@link softFactor}; only beyond it
   * is it demoted. Bark Mounds: 93 % within 150 ly, 100 % within 300 — his FM-C b0 grew them at 169.
   */
  softBandLy?: number;
  softFactor?: number;
  /**
   * Where the species grows in clusters (owner, 2026-10-08): a system within `withinLy` of one of
   * `catalogue.records[key]` passes too, wherever the catalogue's nearest point is.
   */
  records?: { key: string; withinLy: number; label: string; evidence: string };
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
      /*
        Owner, 2026-10-08 (Braisoo JD-H b43-6 3 a, no nebula anywhere near, radialem offered on one
        codex find 1,130 ly away): within 150 ly of a catalogued nebula, or 50 ly of a radialem cluster;
        anywhere else demoted to unlikely. No band past 150 ly — only 0.7 % of radialem systems are in
        150–300. Until then a band with no outer edge kept 0.22 of its chance as far as 2,000 ly from a
        single record.
      */
      records: {
        /*
          The catalogue misses nebulae — 660 radialem systems lie past 5,000 ly of one — but radialem
          marks them by growing in clusters: the systems with 2+ other radialem systems within 100 ly
          (one count per system). A lone find is a planetary nebula, in-system, which no scan of an
          undiscovered system can show, so it does not count. Leave one out over 16,634 radialem
          systems (EDAstro codex + EDGalaxyData's EDDN year): 79.0 % within 150 ly of a catalogued
          nebula, 90.2 % with the 50 ly cluster bubbles (75 ly would give 91.8 %, 150 ly 92.7 %).
        */
        key: "radialem",
        withinLy: 50,
        label: "Electricae radialem cluster",
        evidence:
          "90 % of 16,634 radialem systems are within 150 ly of a nebula or 50 ly of a radialem cluster (79 % from nebulae alone)",
      },
    },
  },
  {
    idIncludes: "cone",
    gate: {
      kind: "nebula",
      thresholdLy: 150,
      evidence:
        "93 % of 23,651 Bark Mound systems are within 150 ly of a nebula, 100 % within 300 ly; background 4–7 %",
      softBandLy: 300,
      softFactor: 0.5,
    },
  },
  {
    idIncludes: "bark_mound",
    gate: {
      kind: "nebula",
      thresholdLy: 150,
      evidence:
        "93 % of 23,651 Bark Mound systems are within 150 ly of a nebula, 100 % within 300 ly; background 4–7 %",
      softBandLy: 300,
      softFactor: 0.5,
    },
  },
  {
    idIncludes: "brain_tree",
    gate: {
      kind: "guardian",
      /*
        1,250 since 2026-10-04 (owner: no misses): every one of 4,142 confirmed single-species Brain
        Tree bodies lies within 1,223 ly of a catalogued Guardian site; the 83 past 1,000 ly are all in
        Norma Expanse (Puniceum 37, Roseum 43, Viride 3), and each lost its species to this gate.
      */
      thresholdLy: 1250,
      evidence:
        "99 % of 16,062 Brain Tree systems are within 1,000 ly of a Guardian site, and every confirmed Brain Tree body within 1,223 ly; controls 15–27 %",
    },
  },
  /*
   * Sinuous Tubers, one gate for the genus (owner, 2026-10-02, Phase A.6). Until then each species
   * had its own: Roseum, Prasinum, Albidum and Caeruleum within 10 kly of the core (half the chance to
   * 20 kly), the ring family within 21 kly. Which species a body carries is not a question of distance
   * — on 2,960 confirmed bodies the per-species gates hid the right one on 7 of 28 (Prasinum in Norma
   * Expanse at 12 kly, Albidum in the Trojan Belt) — and `genusBodySplit.ts` now answers it from the
   * body and the region. What distance does answer is whether the genus is there at all: every
   * species' codex systems lie within 21 kly of Sgr A* (2026-09-28: the ring family 100 %, the core
   * family 99 % within 19.5 kly).
   */
  {
    idIncludes: "sinuous_tuber",
    gate: {
      kind: "core",
      thresholdLy: 21000,
      evidence:
        "Sinuous Tubers: every species' codex systems within 21,000 ly of Sgr A* (ring family 100 %, core family 99 % within 19,500 ly)",
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
  /** Outside the radius but inside the gate's soft band: kept, at `softFactor` of its chance. */
  softBand?: { factor: number; bandLy: number };
  distanceLy: number;
  thresholdLy: number;
  /** The nebula / Guardian site / Sgr A* the distance is measured to. */
  nearestName: string;
  evidence: string;
  /** The gate's `records` check, when it ran: the nearest record and how far. */
  record?: { label: string; name: string; distanceLy: number; withinLy: number } | null;
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
  let passes = near.distanceLy <= gate.thresholdLy;
  // Outside the radius: a cluster of the species' own records marks a nebula the catalogue lacks.
  let record: SpatialVerdict["record"];
  const recs = gate.records ? catalogue.records?.[gate.records.key] : undefined;
  if (!passes && gate.records && recs) {
    const r = nearestPoint(system, recs);
    record = r
      ? { label: gate.records.label, name: r.point.n, distanceLy: r.distanceLy, withinLy: gate.records.withinLy }
      : null;
    if (r && r.distanceLy <= gate.records.withinLy) passes = true;
  }
  const inBand =
    !passes && gate.softBandLy != null && near.distanceLy > gate.thresholdLy && near.distanceLy <= gate.softBandLy;
  return {
    kind: gate.kind,
    passes,
    ...(inBand ? { softBand: { factor: gate.softFactor ?? 0.5, bandLy: gate.softBandLy! } } : {}),
    distanceLy: near.distanceLy,
    thresholdLy: gate.thresholdLy,
    nearestName: near.point.n,
    evidence: gate.records ? gate.records.evidence : gate.evidence,
    ...(record !== undefined ? { record } : {}),
  };
}

/** One line for the reader: the distance, the rule, and the object it was measured to. */
export function describeVerdict(v: SpatialVerdict): string {
  const d =
    v.distanceLy >= 1000 ? `${Math.round(v.distanceLy / 100) / 10} kly` : `${Math.round(v.distanceLy)} ly`;
  const rule = v.thresholdLy >= 1000 ? `${v.thresholdLy / 1000} kly` : `${v.thresholdLy} ly`;
  // The core is one named place; the other two are "the nearest of many", and the sentence has to
  // read correctly for both rather than gluing an article onto a noun that does not want one.
  const subject =
    v.kind === "core"
      ? v.nearestName
      : `nearest ${v.kind === "nebula" ? "nebula" : "Guardian site"} ${v.nearestName}`;
  const ly = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10} kly` : `${Math.round(n)} ly`);
  if (v.record && v.record.distanceLy <= v.record.withinLy) {
    return `${subject} is ${d} away, but a ${v.record.label} (${v.record.name}) is ${ly(v.record.distanceLy)} — inside its ${ly(v.record.withinLy)} rule.`;
  }
  if (v.passes) return `${subject} is ${d} away — inside the ${rule} rule.`;
  if (v.record) {
    return `${subject} is ${d} away (rule ${rule}), and the nearest ${v.record.label} (${v.record.name}) is ${ly(v.record.distanceLy)} (rule ${ly(v.record.withinLy)}).`;
  }
  if (v.softBand) {
    const pct = Math.round(v.softBand.factor * 100);
    if (!Number.isFinite(v.softBand.bandLy)) return `${subject} is ${d} away — past the ${rule} rule, so it stays listed at ${pct} % of its chance.`;
    return `${subject} is ${d} away — past the ${rule} rule but inside ${v.softBand.bandLy} ly, so it stays listed at ${pct} % of its chance.`;
  }
  return `${subject} is ${d} away; the rule is under ${rule}.`;
}
