/**
 * Reading a profile's paths off a body: the journal scan and exploration record values the exomastery profiles and the ranking model compare against (valueForNumericPath / valueForCategoricalPath). Split out of exomasteryProfile.ts (code review D, 2026-09-27).
 */
import { NO_VOLCANISM } from "../feeder/parameterImportance.js";
import { journalStarPrimarySpectralLetter } from "../shared/genusStarColorSoft.js";
import { journalPressureToAtm, journalSurfaceGravityToG } from "../shared/journalPhysics.js";
import {
  isFeederHostStarLuminosityPath,
  isFeederHostStarSpectralPath,
  isFeederHostStarSubclassPath,
} from "../shared/stellarProximity.js";
import type { ExplorationScanRecord, JournalHostStarObservation, PlanetScan } from "../shared/types.js";

/** Astronomical unit in metres — journal `SemiMajorAxis` is in metres; exomastery numerics use AU. */
import { AU_METERS } from "../shared/journalPhysics.js";
export { AU_METERS };

/** Journal `OrbitalPeriod` / `RotationPeriod` are seconds; feeder / EDSM rollups use days. */
export const SECONDS_PER_DAY = 86_400;

/** Journal `Composition` Ice / Metal / Rock are 0–1 fractions; feeder rollups use 0–100%. */
const SOLID_FRACTION_ELEMENT_KEYS = new Set(["ice", "metal", "rock"]);

export function journalSolidPercentFromRaw(elementKey: string, raw: number): number {
  return SOLID_FRACTION_ELEMENT_KEYS.has(elementKey.toLowerCase()) ? raw * 100 : raw;
}

/** Map EDSM-style profile paths to values from journal scan / exploration record (SI + AU as stored in profile). */
/** Exported for the ranking model, which reads the same paths out of the same scan. */
export function valueForNumericPath(
  path: string,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): number | null {
  const low = path.toLowerCase();
  /**
   * `body.solidComposition.Rock|Metal|Ice` — the crust split, read before anything else.
   *
   * The profiles have carried these two histograms since the feeder was built and the ranking model
   * never scored either, because this function had no branch for them and every caller reads the
   * value through here. For the pair it separates best that is not a small loss: Frutexa acus lives
   * on 85.31-97.28 % rock and metallicum on 64.25-72 %, ranges that do not touch, and the model was
   * ordering the two on temperature and gravity alone. {@link solidValue} already does the lookup
   * and the fraction-to-percent conversion for the habitat scorer; the same call keeps both scorers
   * on one set of units.
   */
  const solid = /^body\.solidComposition\.(.+)$/i.exec(path);
  if (solid) {
    const { v, known } = solidValue(scan, rec, solid[1]!);
    return known ? v : null;
  }
  /**
   * `body.atmosphereComposition.*` — which gases, and how much of each.
   *
   * Dead here for the same reason the crust was, and it costs more than either. Fonticulua splits on
   * this axis and on almost nothing else: campestris lives on 52-100 % argon, upupam on 50-100 %
   * nitrogen with 0.4-50 % argon beside it, and the two ranges do not touch across 761 and 56 rows.
   * The model could not see either number, so it separated them on the corpus prior — campestris has
   * thirteen times the rows — and upupam sat at 15-17 % on bodies that were unambiguously its own.
   *
   * The atmosphere *type* does not rescue it. The commander's upupam body is `ArgonRich` by name and
   * 64 % nitrogen by composition; matching on the label alone leaves both species plausible, which is
   * exactly what the panel showed.
   */
  const atmo = /^body\.atmosphereComposition\.(.+)$/i.exec(path);
  if (atmo) {
    const { v, known } = atmoGasValue(scan, rec, atmo[1]!);
    return known ? v : null;
  }
  /**
   * `body.materials.*` is deliberately **not** answered here, and the model is better for it.
   *
   * Fourteen of these paths carry histograms in every profile and none of them has ever been scored,
   * for the same reason the crust split was not: no branch, so null, so no term. That is also why
   * the note in `speciesLogScore` about "dropping any one of the seventeen material paths moves
   * nothing" held — dropping all fourteen at once moved nothing either.
   *
   * Wiring them through {@link crustMaterialValue} was measured rather than assumed, and it is a
   * loss on every axis: mean rank 3.260 -> 3.294, top-1 165 -> 164, top-3 310 -> 303, and the
   * reliability of "Chance here" within a genus more than doubled its error, 0.0050 -> 0.0107.
   * Averaging the terms instead of summing them (`--per-term`) does not rescue it, so it is not the
   * term count: fourteen percentages that sum to a hundred over the same crust are one fact counted
   * fourteen times, and each repeat makes the posterior more certain without making it more right.
   * Crust materials stay where they are useful — the habitat similarity, which weights them by
   * measured importance instead of multiplying them.
   */
  if (low.endsWith(".gravity") || low === "body.gravity" || low.includes("surfacegravity")) {
    const raw = scan.SurfaceGravity ?? rec?.surfaceGravity;
    if (raw != null && Number.isFinite(raw)) return journalSurfaceGravityToG(raw);
    return null;
  }
  if (
    low.includes("surfacetemperature") ||
    low.endsWith(".surfacetemperature") ||
    low.includes("surfacetemp")
  ) {
    const t = scan.SurfaceTemperature ?? rec?.surfaceTemperature;
    if (t != null && Number.isFinite(t)) return t;
    return null;
  }
  if (low.includes("surfacepressure") || low.endsWith(".surfacepressure")) {
    const p = scan.SurfacePressure ?? rec?.surfacePressure;
    if (p != null && Number.isFinite(p)) return journalPressureToAtm(p);
    return null;
  }
  if (low.includes("earthmass") || low.includes("earthmasses")) {
    const m = scan.MassEM ?? rec?.massEM;
    if (m != null && Number.isFinite(m)) return m;
    return null;
  }
  if (low.includes("radius") && !low.includes("semimajor")) {
    const rad = scan.radius ?? rec?.radius;
    if (rad != null && Number.isFinite(rad)) return rad / 1000;
    return null;
  }
  if (low.includes("semimajoraxis") || low.includes("semimajor")) {
    const meters = rec?.semiMajorAxis ?? scan.SemiMajorAxis;
    if (meters != null && Number.isFinite(meters)) return meters / AU_METERS;
    return null;
  }
  if (low.includes("orbitalperiod")) {
    const o = scan.OrbitalPeriod ?? rec?.orbitalPeriod;
    if (o != null && Number.isFinite(o)) return o / SECONDS_PER_DAY;
    return null;
  }
  if (low.includes("eccentricity") || low.includes("orbitaleccentricity")) {
    const e = scan.Eccentricity ?? rec?.eccentricity;
    if (e != null && Number.isFinite(e)) return e;
  }
  if (low.includes("orbitalinclination") || low.includes("orbitalincline")) {
    const i = scan.OrbitalInclination ?? rec?.orbitalInclination;
    if (i != null && Number.isFinite(i)) return i;
  }
  if (low.includes("periapsis") || low.includes("argofperiapsis")) {
    const p = scan.Periapsis ?? rec?.periapsis;
    if (p != null && Number.isFinite(p)) return p;
  }
  if (low.includes("ascendingnode") || low.includes("longitudeofascendingnode")) {
    const p = scan.AscendingNode ?? rec?.ascendingNode;
    if (p != null && Number.isFinite(p)) return p;
  }
  if (low.includes("meananomaly")) {
    const p = scan.MeanAnomaly ?? rec?.meanAnomaly;
    if (p != null && Number.isFinite(p)) return p;
  }
  if (low.includes("distancefromarrival") || low.includes("distancetoarrival")) {
    const d = rec?.distanceFromArrivalLs;
    if (d != null && Number.isFinite(d)) return d;
  }
  if (low.includes("rotationperiod") || low.includes("rotationalperiod")) {
    const rp = scan.RotationPeriod ?? rec?.rotationPeriod;
    if (rp != null && Number.isFinite(rp)) return rp / SECONDS_PER_DAY;
    return null;
  }
  if (low.includes("axialtilt") || low.includes("axial_tilt")) {
    const ax = scan.AxialTilt ?? rec?.axialTilt;
    if (ax != null && Number.isFinite(ax)) return ax;
  }
  if (low.includes("systemaddress")) {
    const a = scan.SystemAddress;
    if (typeof a === "number" && Number.isFinite(a)) return a;
  }
  if ((low.includes("bodyid") || low.endsWith(".bodyid")) && !low.includes("parent")) {
    const id = scan.BodyID;
    if (typeof id === "number" && Number.isFinite(id)) return id;
  }
  return null;
}

/** Journal / DSS atmosphere summary; "No atmosphere" when explicitly airless (supports categorical + composition). */
export function normalizeAtmosphereType(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): string | null {
  const raw = (scan.AtmosphereType ?? rec?.atmosphereType ?? "").trim();
  const atm = (scan.Atmosphere ?? rec?.atmosphere ?? "").trim();
  const t = raw || atm;
  if (!t) return null;
  if (/^no atmosphere$/i.test(t) || /^none$/i.test(t)) return "No atmosphere";
  if (/^no atmosphere$/i.test(atm)) return "No atmosphere";
  return t;
}

function isNoAtmosphereScan(scan: PlanetScan, rec: ExplorationScanRecord | null | undefined): boolean {
  return normalizeAtmosphereType(scan, rec) === "No atmosphere";
}

/** Journal `Percent` is usually a float; coerce strings from some parsers / exports. */
export function journalPercentNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function journalMaterialsArray(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): unknown[] | null {
  const fromRec = rec?.materials;
  if (Array.isArray(fromRec) && fromRec.length > 0) return fromRec;
  const fromScan = scan.materials;
  if (Array.isArray(fromScan) && fromScan.length > 0) return fromScan as unknown[];
  return null;
}

/** Crust materials %: journal detailed `Materials` or exploration merge; known + absent element ⇒ 0%. */
export function crustMaterialValue(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  sym: string,
): { v: number | null; known: boolean } {
  const raw = journalMaterialsArray(scan, rec);
  if (raw == null) return { v: null, known: false };
  const want = sym.toLowerCase();
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const name = String(o.Name ?? o.name ?? "").toLowerCase();
    const pct = journalPercentNumber(o.Percent ?? o.percent);
    if (name === want && pct != null) return { v: pct, known: true };
  }
  return { v: 0, known: true };
}

export function journalAtmosphereCompositionArray(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): unknown[] | null {
  const fromRec = rec?.atmosphereComposition;
  if (Array.isArray(fromRec) && fromRec.length > 0) return fromRec as unknown[];
  const fromScan = scan.atmosphereComposition;
  if (Array.isArray(fromScan) && fromScan.length > 0) return fromScan as unknown[];
  return null;
}

/** Atmosphere constituent %: explicit airless ⇒ 0% for every gas; else journal or DSS composition array. */
export function atmoGasValue(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  sym: string,
): { v: number | null; known: boolean } {
  if (isNoAtmosphereScan(scan, rec)) return { v: 0, known: true };
  const raw = journalAtmosphereCompositionArray(scan, rec);
  if (raw == null) return { v: null, known: false };
  const want = sym.toLowerCase();
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const name = String(o.Name ?? o.name ?? "").toLowerCase();
    const pct = journalPercentNumber(o.Percent ?? o.percent);
    if (name === want && pct != null) return { v: pct, known: true };
  }
  return { v: 0, known: true };
}

export function journalCompositionObject(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): Record<string, unknown> | null {
  const c = (rec?.composition ?? scan.composition) as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") return null;
  if (Object.keys(c).length === 0) return null;
  return c;
}

/** Distinct material element names present in merged journal with a numeric percent. */
export function collectJournalMaterialElementNames(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): string[] {
  const raw = journalMaterialsArray(scan, rec);
  if (!raw) return [];
  const names: string[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const name = String(o.Name ?? o.name ?? "").trim();
    const pct = journalPercentNumber(o.Percent ?? o.percent);
    if (!name || pct == null) continue;
    names.push(name);
  }
  return names;
}

/** Atmosphere constituent names present in merged journal with a numeric percent. */
export function collectJournalAtmosphereGasNames(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): string[] {
  const raw = journalAtmosphereCompositionArray(scan, rec);
  if (!raw) return [];
  const names: string[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const name = String(o.Name ?? o.name ?? "").trim();
    const pct = journalPercentNumber(o.Percent ?? o.percent);
    if (!name || pct == null) continue;
    names.push(name);
  }
  return names;
}

/** Solid composition keys present in merged journal with a numeric value. */
export function collectJournalSolidKeys(scan: PlanetScan, rec: ExplorationScanRecord | null | undefined): string[] {
  const comp = journalCompositionObject(scan, rec);
  if (!comp) return [];
  return Object.keys(comp).filter((k) => {
    const v = comp[k];
    return typeof v === "number" && Number.isFinite(v);
  });
}

export function solidValue(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  el: string,
): { v: number | null; known: boolean } {
  const comp = journalCompositionObject(scan, rec);
  if (!comp) return { v: null, known: false };
  const key = Object.keys(comp).find((k) => k.toLowerCase() === el.toLowerCase());
  if (key == null) return { v: 0, known: true };
  const v = comp[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return { v: null, known: false };
  return { v: journalSolidPercentFromRaw(el, v), known: true };
}

/** String fields from scan/rec for profile categorical paths (EDSM/journal wording). */
/** Exported for the ranking model, which reads the same paths out of the same scan. */
export function valueForCategoricalPath(
  path: string,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): string | null {
  const low = path.toLowerCase();

  if (isFeederHostStarSubclassPath(path)) {
    const sc = journalHost?.subclass;
    return sc != null && Number.isFinite(sc) ? String(Math.round(sc)) : null;
  }
  if (isFeederHostStarLuminosityPath(path)) {
    const lum = journalHost?.luminosity?.trim();
    return lum?.length ? lum : null;
  }
  if (
    /(\bhost\b.*\bstar\b.*(class|letter|spectral))|(\bexo\.host\b)|(\bfeeder\b.*host.*star)|(primary[_.\s]*stellar)/i.test(
      low,
    ) ||
    isFeederHostStarSpectralPath(path)
  ) {
    const letter = journalHost?.spectralLetter?.trim();
    if (letter) return letter;
    const h = journalHost?.starTypeRaw?.trim();
    if (!h) return null;
    const x = journalStarPrimarySpectralLetter(h);
    return x === "—" ? null : x;
  }
  if (low.includes("atmosphere") && !low.includes("composition")) {
    return normalizeAtmosphereType(scan, rec);
  }
  if (low.includes("planetclass") || low.includes("bodytype") || low.includes("subtype")) {
    const s = (scan.PlanetClass ?? rec?.planetClass ?? rec?.bodyType ?? "").trim();
    return s || null;
  }
  if (low.includes("volcanism")) {
    /*
      A quiet body is an observation, not a missing one.

      The journal writes `"Volcanism": ""` on a body with none, and returning null for that made the
      likelihood skip the term on the 94 % of bodies where it has the most to say. The corpus is
      emphatic about it — Bacterium aurasus is 6,889 of 6,889 on quiet bodies and Bacterium verrata
      26 of 26 on volcanic ones — and none of that could reach the posterior.

      The distinction that matters is *absent* against *empty*: a scan that never carried the field
      still knows nothing, and `??` keeps the two apart because an empty string is not nullish.
    */
    const raw = scan.Volcanism ?? rec?.volcanism;
    if (raw == null) return null;
    const s = String(raw).trim();
    return s || NO_VOLCANISM;
  }
  if (low.includes("terraform")) {
    const s = (scan.TerraformState ?? rec?.terraformState ?? "").trim();
    return s || null;
  }
  return null;
}
