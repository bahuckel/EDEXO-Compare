/**
 * Body features: the "why this body is worth a look" checks the guild asked for (owner, 2026-09-30,
 * from the PDF: "planetary notable features, explanations why, customise"). Each one is an Options
 * toggle, off until chosen; a body that has one shows on the Notable card with the reason, and a new
 * scan of one goes to the mail icon.
 *
 * The list follows "Custom Criteria for Everyone" (CMDR Julian Ford, for Elite Observatory) — the
 * ideas and their thresholds, not its code, which carries no licence. Thresholds are the same as
 * its defaults, so a commander coming from Observatory sees the same finds.
 *
 * Journal units throughout: radius and semi-major axis in metres, orbital period in seconds, gravity
 * in m/s², pressure in pascals, ring mass in megatonnes, star age in millions of years.
 */
import type { ExplorationScanRecord, ScanRing } from "./dto/scan.js";

export type BodyFeatureGroup = "orbit" | "landable" | "gas" | "rings" | "travel";

export type BodyFeatureKey =
  | "smallBody"
  | "fastOrbit"
  | "hotJupiter"
  | "massivePlanet"
  | "ringedRare"
  | "ancientStar"
  | "ringedStar"
  | "highGravity"
  | "largeLandable"
  | "hotLandable"
  | "brightAtmosphere"
  | "moonOfRare"
  | "bigInSky"
  | "ringedLandable"
  | "inclinedNearRings"
  | "heliumRich"
  | "bigRing"
  | "narrowRing"
  | "ringGap"
  | "shepherdMoon"
  | "ringProximity"
  | "fastRing"
  | "voidCross";

export interface BodyFeatureDef {
  key: BodyFeatureKey;
  group: BodyFeatureGroup;
  label: string;
  /** What it means, for the Options tooltip. */
  hint: string;
}

export const BODY_FEATURE_GROUPS: readonly { key: BodyFeatureGroup; label: string }[] = [
  { key: "orbit", label: "Orbit and size" },
  { key: "landable", label: "Landable bodies" },
  { key: "gas", label: "Gas giants" },
  { key: "rings", label: "Rings" },
  { key: "travel", label: "Travel" },
];

export const BODY_FEATURES: readonly BodyFeatureDef[] = [
  { key: "smallBody", group: "orbit", label: "Small body", hint: "A planet or moon under 300 km radius." },
  { key: "fastOrbit", group: "orbit", label: "Fast orbit", hint: "Goes round its parent in under 8 hours (0.3 days)." },
  { key: "hotJupiter", group: "orbit", label: "Hot Jupiter", hint: "A gas giant orbiting its star in under 10 days." },
  { key: "massivePlanet", group: "orbit", label: "Massive planet", hint: "Over 3,300 Earth masses." },
  { key: "ringedRare", group: "orbit", label: "Ringed rare world", hint: "An Earth-like, water or ammonia world with a ring." },
  { key: "ancientStar", group: "orbit", label: "Ancient star", hint: "A star 13 billion years old or more." },
  { key: "ringedStar", group: "orbit", label: "Ringed star", hint: "An M-class star, neutron star or white dwarf with rings (belts do not count)." },
  { key: "highGravity", group: "landable", label: "High gravity", hint: "Landable, over 2 g." },
  { key: "largeLandable", group: "landable", label: "Large landable", hint: "Landable, over 18,000 km radius." },
  { key: "hotLandable", group: "landable", label: "Hot landable", hint: "Landable at 500 K or more; from 800 K a commander on foot burns." },
  { key: "brightAtmosphere", group: "landable", label: "Thick atmosphere", hint: "Landable with 0.09 atm or more, near the 0.1 limit — where the sky colours get rich." },
  { key: "moonOfRare", group: "landable", label: "Moon of a rare world", hint: "Landable, within 1.5 ls of an Earth-like, water or ammonia world." },
  { key: "bigInSky", group: "landable", label: "Parent fills the sky", hint: "Landable, its parent over 25° across (a star) or 45° (a planet)." },
  { key: "ringedLandable", group: "landable", label: "Ringed landable", hint: "A landable body with its own rings." },
  { key: "inclinedNearRings", group: "landable", label: "Ring view", hint: "Landable, orbit tilted over 10°, within 10 ls of a ringed parent — the rings from above." },
  { key: "heliumRich", group: "gas", label: "Helium-rich boxel", hint: "A gas giant with 30 % helium or more: its boxel grows helium-rich gas giants." },
  { key: "bigRing", group: "rings", label: "Massive or wide ring", hint: "A ring over 10 trillion megatonnes, or reaching past 5 million km." },
  { key: "narrowRing", group: "rings", label: "Narrow ring", hint: "One ring, narrower than a quarter of the body's diameter (Taylor's ring under an eighth)." },
  { key: "ringGap", group: "rings", label: "Ring gap", hint: "Two rings under 100 km apart, moving at least 5 km/s differently." },
  { key: "shepherdMoon", group: "rings", label: "Shepherd moon", hint: "Orbits within its parent's rings, between their inner and outer edge." },
  { key: "ringProximity", group: "rings", label: "Close to a ring", hint: "Orbits within 2,000 km of the edge of its parent's rings." },
  { key: "fastRing", group: "rings", label: "Fast ring", hint: "A ring that goes round in under 30 minutes, or at 100 km/s or more." },
  { key: "voidCross", group: "travel", label: "Void cross", hint: "Entering or leaving the void cross: within 1,500 ly of Sol's X or Z axis (and its plane), where some stars never generate." },
];

export const BODY_FEATURE_KEYS: readonly BodyFeatureKey[] = BODY_FEATURES.map((f) => f.key);

export function bodyFeatureLabel(key: BodyFeatureKey): string {
  return BODY_FEATURES.find((f) => f.key === key)?.label ?? key;
}

export interface BodyFeatureHit {
  key: BodyFeatureKey;
  label: string;
  /** The figures behind it: "Radius 214 km". */
  why: string;
}

const G = 6.674e-11;
const EARTH_KG = 5.972e24;
const SUN_KG = 1.989e30;
const G0 = 9.80665;
const ATM_PA = 101_325;
const LS_M = 299_792_458;

const RARE: Record<string, string> = {
  "Earthlike body": "Earth-like world",
  "Water world": "water world",
  "Ammonia world": "ammonia world",
};

/** The rings of `Scan.Rings`, belts left out (a ring's name ends in "Ring"); undefined when there is no list. */
export function scanRings(rings: unknown): ScanRing[] | undefined {
  if (!Array.isArray(rings)) return undefined;
  const out: ScanRing[] = [];
  for (const r of rings) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const name = typeof o.Name === "string" ? o.Name.trim() : "";
    if (!/\bRing$/i.test(name)) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    out.push({
      name,
      ringClass: typeof o.RingClass === "string" ? o.RingClass : "",
      massMt: num(o.MassMT),
      innerRadM: num(o.InnerRad),
      outerRadM: num(o.OuterRad),
    });
  }
  return out;
}

/** The fields the features read, from a raw journal `Scan` (before the store has it). */
export function featureRecordFromScan(line: Record<string, unknown>): Partial<ExplorationScanRecord> {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  return {
    bodyName: s(line.BodyName) ?? "",
    planetClass: s(line.PlanetClass),
    starType: s(line.StarType),
    radius: n(line.Radius),
    massEM: n(line.MassEM),
    stellarMass: n(line.StellarMass),
    orbitalPeriod: n(line.OrbitalPeriod),
    semiMajorAxis: n(line.SemiMajorAxis),
    orbitalInclination: n(line.OrbitalInclination),
    landable: typeof line.Landable === "boolean" ? line.Landable : undefined,
    surfaceGravity: n(line.SurfaceGravity),
    surfaceTemperature: n(line.SurfaceTemperature),
    surfacePressure: n(line.SurfacePressure),
    atmosphere: typeof line.Atmosphere === "string" ? line.Atmosphere : undefined,
    atmosphereComposition: line.AtmosphereComposition,
    parents: line.Parents,
    rings: scanRings(line.Rings),
    ageMy: n(line.Age_MY),
  };
}

/** The direct parent of `Scan.Parents`: `{ kind, id }`, or null. */
export function directParent(parents: unknown): { kind: "Star" | "Planet" | "Null"; id: number } | null {
  if (!Array.isArray(parents) || !parents.length) return null;
  const p = parents[0] as Record<string, unknown>;
  for (const kind of ["Star", "Planet", "Null"] as const) {
    if (typeof p?.[kind] === "number" && Number.isFinite(p[kind])) return { kind, id: p[kind] as number };
  }
  return null;
}

function heliumPercent(comp: unknown): number | null {
  if (!Array.isArray(comp)) return null;
  for (const c of comp) {
    const o = c as Record<string, unknown>;
    if (o && String(o.Name).toLowerCase() === "helium" && typeof o.Percent === "number") return o.Percent;
  }
  return null;
}

function bodyMassKg(r: Partial<ExplorationScanRecord>): number {
  if (r.starType) return (r.stellarMass ?? 0) * SUN_KG;
  return (r.massEM ?? 0) * EARTH_KG;
}

const km = (m: number) => Math.round(m / 1000).toLocaleString("en-US");
const ls = (m: number) => (m / LS_M).toFixed(2);
function duration(sec: number): string {
  const h = sec / 3600;
  if (h < 1) return `${Math.round(sec / 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

/**
 * Every feature a body has, in list order. `parent` is the scan of its direct parent, when known
 * (the ring and moon features need it). Not filtered by the commander's toggles — the caller does that.
 */
export function bodyFeatures(
  r: Partial<ExplorationScanRecord>,
  parent?: Partial<ExplorationScanRecord> | null,
): BodyFeatureHit[] {
  const out: BodyFeatureHit[] = [];
  const hit = (key: BodyFeatureKey, why: string, label = bodyFeatureLabel(key)) => out.push({ key, label, why });
  const pc = (r.planetClass ?? "").trim();
  const isPlanet = !!pc && !r.starType;
  const isStar = !!r.starType;
  const rings = r.rings ?? [];
  const radius = r.radius ?? 0;
  const period = Math.abs(r.orbitalPeriod ?? 0);
  const sma = r.semiMajorAxis ?? 0;
  const dp = directParent(r.parents);
  const parentRings = parent?.rings ?? [];

  // Orbit and size.
  if (isPlanet && radius > 0 && radius <= 300_000) hit("smallBody", `Radius ${km(radius)} km`);
  if (isPlanet && period > 0 && period <= 28_800) hit("fastOrbit", `Orbits in ${duration(period)}`);
  if (isPlanet && /gas giant/i.test(pc) && dp?.kind === "Star" && period > 0 && period <= 10 * 86_400) {
    hit("hotJupiter", `Orbits its star in ${duration(period)}, ${ls(sma)} ls out`);
  }
  if (isPlanet && (r.massEM ?? 0) > 3300) hit("massivePlanet", `${Math.round(r.massEM!).toLocaleString("en-US")} Earth masses`);
  if (isPlanet && RARE[pc] && rings.length) hit("ringedRare", `A ${RARE[pc]} with ${rings.length === 1 ? "a ring" : `${rings.length} rings`}`);
  if (isStar && (r.ageMy ?? 0) >= 13_000) hit("ancientStar", `${((r.ageMy ?? 0) / 1000).toFixed(2)} billion years old`);
  if (isStar && rings.length) {
    const st = r.starType!;
    const kind = st === "M" ? "M-class star" : st === "N" ? "Neutron star" : /^D/.test(st) ? `White dwarf (${st})` : null;
    if (kind) hit("ringedStar", `${kind} with ${rings.length === 1 ? "a ring" : `${rings.length} rings`}`);
  }

  // Landable bodies.
  if (isPlanet && r.landable) {
    const g = (r.surfaceGravity ?? 0) / G0;
    if (g > 2) hit("highGravity", `${g.toFixed(2)} g`);
    if (radius > 18_000_000) hit("largeLandable", `Radius ${km(radius)} km`);
    const t = r.surfaceTemperature ?? 0;
    if (t >= 800) hit("hotLandable", `${Math.round(t)} K — lethal on foot`, "Lethal heat");
    else if (t >= 500) hit("hotLandable", `${Math.round(t)} K`);
    const atm = (r.surfacePressure ?? 0) / ATM_PA;
    if (r.atmosphere && atm >= 0.09) hit("brightAtmosphere", `${atm.toFixed(3)} atm ${r.atmosphere}`);
    if (dp?.kind === "Planet" && parent?.planetClass && RARE[parent.planetClass] && sma > 0 && sma <= 1.5 * LS_M) {
      hit("moonOfRare", `${ls(sma)} ls from a ${parentRings.length ? "ringed " : ""}${RARE[parent.planetClass]}`);
    }
    if (parent && (parent.radius ?? 0) > 0 && sma > 0 && (dp?.kind === "Star" || dp?.kind === "Planet")) {
      const deg = (2 * Math.atan(parent.radius! / sma) * 180) / Math.PI;
      if (deg > (parent.starType ? 25 : 45)) hit("bigInSky", `Its ${parent.starType ? "star" : "planet"} is ${deg.toFixed(0)}° across`);
    }
    if (rings.length) hit("ringedLandable", `${rings.length === 1 ? "A ring" : `${rings.length} rings`}${r.atmosphere ? `, ${r.atmosphere}` : ""}`);
    const inc = Math.abs(r.orbitalInclination ?? 0);
    if (parentRings.length && inc > 10 && sma > 0 && sma < 10 * LS_M) {
      hit("inclinedNearRings", `Inclined ${inc.toFixed(0)}°, ${ls(sma)} ls from its ringed parent`);
    }
  }

  // Gas giants.
  if (isPlanet && /giant/i.test(pc)) {
    const he = heliumPercent(r.atmosphereComposition);
    if (he != null && he >= 30) hit("heliumRich", `Helium ${he.toFixed(2)} %`);
  }

  // Rings of this body.
  if (rings.length) {
    const big = rings.find((x) => x.massMt >= 1e13 || x.outerRadM >= 5e9);
    if (big) {
      const massive = big.massMt >= 1e13;
      const wide = big.outerRadM >= 5e9;
      hit(
        "bigRing",
        `${big.name.replace(/^.*\s(\S+\s+Ring)$/, "$1")}: ${(big.massMt / 1e12).toFixed(1)} trillion Mt, ${ls(big.outerRadM)} ls out`,
        massive && wide ? "Massive and wide ring" : massive ? "Massive ring" : "Wide ring",
      );
    }
    if (rings.length === 1 && radius > 0) {
      const pct = ((rings[0]!.outerRadM - rings[0]!.innerRadM) / (2 * radius)) * 100;
      if (pct <= 12.5) hit("narrowRing", `Ring ${pct.toFixed(1)} % of the body's diameter`, "Taylor's ring");
      else if (pct <= 25) hit("narrowRing", `Ring ${pct.toFixed(1)} % of the body's diameter`);
    }
    const mass = bodyMassKg(r);
    if (mass > 0) {
      const sorted = [...rings].sort((a, b) => a.innerRadM - b.innerRadM);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1]!;
        const b = sorted[i]!;
        const gapKm = (b.innerRadM - a.outerRadM) / 1000;
        const va = Math.sqrt((G * mass) / ((a.innerRadM + a.outerRadM) / 2)) / 1000;
        const vb = Math.sqrt((G * mass) / ((b.innerRadM + b.outerRadM) / 2)) / 1000;
        if (gapKm >= 0 && gapKm <= 99 && Math.abs(va - vb) >= 5) {
          hit("ringGap", `${Math.round(gapKm)} km gap, ${Math.abs(va - vb).toFixed(1)} km/s apart`);
          break;
        }
      }
      // The game measures a ring's motion at 1/e of its outer radius.
      for (const x of rings) {
        const rr = x.outerRadM / Math.E;
        if (rr <= 0) continue;
        const v = Math.sqrt((G * mass) / rr);
        const per = (2 * Math.PI * rr) / v;
        if (per <= 1800 || v / 1000 >= 100) {
          hit("fastRing", `Once round in ${duration(per)}, ${(v / 1000).toFixed(0)} km/s`);
          break;
        }
      }
    }
  }

  /*
    A body among its parent's rings. Tighter than Observatory's rule ("orbit below the outer edge"),
    which also caught every moon circling *inside* the inner edge — 5 million km from the nearest ring
    in the owner's Syralaei BP-I c25-0 (2026-09-30). A shepherd is within the ring span; otherwise
    close means within 2,000 km of any ring's edge.
  */
  if ((isPlanet || isStar) && parentRings.length && sma > 0) {
    const inner = Math.min(...parentRings.map((x) => x.innerRadM));
    const outer = Math.max(...parentRings.map((x) => x.outerRadM));
    const land = r.landable ? " — landable" : "";
    if (sma >= inner && sma <= outer) {
      const edge = Math.min(...parentRings.flatMap((x) => [Math.abs(sma - x.innerRadM), Math.abs(sma - x.outerRadM)]));
      hit("shepherdMoon", `Orbits within the rings, ${km(edge)} km from the nearest edge${land}`);
    } else {
      const edge = Math.min(...parentRings.flatMap((x) => [Math.abs(sma - x.innerRadM), Math.abs(sma - x.outerRadM)]));
      if (edge < 2_000_000) hit("ringProximity", `${km(edge)} km from the ${sma > outer ? "outer" : "inner"} ring edge${land}`);
    }
  }
  return out;
}

/** In the void cross: past 900 ly of Sol, within 1,500 ly of the galactic plane and of Sol's X or Z axis. */
export function inVoidCross(p: { x: number; y: number; z: number }): boolean {
  const T = 1500;
  if (Math.hypot(p.x, p.y, p.z) <= 900) return false;
  return Math.abs(p.y) <= T && (Math.abs(p.x) <= T || Math.abs(p.z) <= T);
}

export function defaultFeaturePrefs(): Record<BodyFeatureKey, boolean> {
  return Object.fromEntries(BODY_FEATURE_KEYS.map((k) => [k, false])) as Record<BodyFeatureKey, boolean>;
}
