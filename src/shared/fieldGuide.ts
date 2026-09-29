/**
 * The field guide the Encyclopedia draws (owner, 2026-09-29: "closer to the site's species page"):
 * every species' published conditions and what the corpus measured on the bodies it was confirmed on.
 *
 * Ported from the website's species guide (bahuckel.com/projects/edexo-compare/species, its
 * `lib/exobio.ts`), which builds the same thing from this repository's files at a release tag. Same
 * author, same rules, so the app and the site say the same about a species: the genus files give
 * the published conditions and colour tables, `<species>_exomastery.json` gives min, max, mode and a
 * 16-bin histogram per parameter plus the body / atmosphere / volcanism / host-star counts.
 *
 * Pure: the server feeds it the parsed JSON (`server/fieldGuide.ts`), the client uses the parameter
 * list to draw and to place the current body on each chart.
 */

/** A measured parameter: equal-width bins over min..max, and the profile's mode. */
export interface GuideHist {
  min: number;
  max: number;
  mode: number;
  mean: number;
  /** bodies the parameter was known on */
  n: number;
  counts: number[];
}

export interface GuideShare {
  label: string;
  n: number;
}

export interface GuideColours {
  /** what decides the colour: the parent star's class, a material on the body, or the body's geology */
  by: "star" | "material" | "geology";
  map: [key: string, colour: string][];
}

export interface GuideMeasured {
  bodies: number;
  /** keyed by parameter id, see {@link GUIDE_PARAMS} */
  hist: Record<string, GuideHist>;
  planet: GuideShare[];
  atmosphere: GuideShare[];
  volcanism: GuideShare[];
  star: GuideShare[];
  /** share of bodies tidally locked, 0..1, or null when unknown */
  locked: number | null;
  /** surface materials: the mode percentage, and on how many of the bodies it was present */
  materials: { name: string; mode: number; n: number }[];
}

export interface GuideRequirement {
  label: string;
  text: string;
}

export interface GuideSpecies {
  /** The app's species id (`SpeciesEntry.id`). */
  id: string;
  name: string;
  sampleDistanceM: number | null;
  requires: GuideRequirement[];
  colours: GuideColours | null;
  measured: GuideMeasured | null;
}

export interface GuideGenus {
  /** The genus folder (`SpeciesEntry.genusDataDir`). */
  id: string;
  name: string;
  description: string;
  sampleDistanceM: number | null;
  requires: GuideRequirement[];
  colours: GuideColours | null;
  species: GuideSpecies[];
}

export interface FieldGuideDTO {
  genera: GuideGenus[];
}

export interface GuideParam {
  id: string;
  label: string;
  unit: string;
  /** multiply the stored value by this for display (radians to degrees) */
  scale?: number;
  core?: boolean;
}

/** The parameters the guide draws, in order. Core ones are on every card; the rest open on demand. */
export const GUIDE_PARAMS: GuideParam[] = [
  { id: "body.surfaceTemperature", label: "Surface temperature", unit: "K", core: true },
  { id: "body.gravity", label: "Gravity", unit: "g", core: true },
  { id: "body.surfacePressure", label: "Surface pressure", unit: "atm", core: true },
  { id: "body.distanceToArrival", label: "Distance from arrival", unit: "ls", core: true },
  { id: "body.radius", label: "Radius", unit: "km" },
  { id: "body.earthMasses", label: "Mass", unit: "M⊕" },
  { id: "body.semiMajorAxis", label: "Orbit (semi-major axis)", unit: "AU" },
  { id: "body.orbitalPeriod", label: "Orbital period", unit: "d" },
  { id: "body.rotationalPeriod", label: "Rotation period", unit: "d" },
  { id: "body.orbitalEccentricity", label: "Eccentricity", unit: "" },
  { id: "body.axialTilt", label: "Axial tilt", unit: "°", scale: 180 / Math.PI },
  { id: "body.solidComposition.Rock", label: "Rock", unit: "%" },
  { id: "body.solidComposition.Metal", label: "Metal", unit: "%" },
  { id: "body.solidComposition.Ice", label: "Ice", unit: "%" },
];

/** Atmosphere gases get a chart each when present on at least this share of the bodies. */
const GAS_MIN_SHARE = 0.25;
export const GUIDE_ATMO_PREFIX = "body.atmosphereComposition.";

/** The label a dynamic parameter id is shown under. */
export function guideParam(id: string): GuideParam | null {
  const fixed = GUIDE_PARAMS.find((p) => p.id === id);
  if (fixed) return fixed;
  if (id.startsWith(GUIDE_ATMO_PREFIX)) return { id, label: `${id.slice(GUIDE_ATMO_PREFIX.length)} in the atmosphere`, unit: "%" };
  return null;
}

/** What `<species>_exomastery.json` is called: the species name, lower case, words joined by `_`. */
export function guideProfileFileName(speciesName: string): string {
  return `${speciesName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")}_exomastery.json`;
}

const STAR_KEYS = new Set(["O", "B", "A", "F", "G", "K", "M", "L", "T", "Y", "TTS", "W", "D", "N", "AeBe", "C", "S", "MS"]);
const MATERIALS = new Set(
  "Antimony Arsenic Boron Cadmium Carbon Chromium Germanium Iron Lead Manganese Mercury Molybdenum Nickel Niobium Phosphorus Polonium Ruthenium Selenium Sulphur Technetium Tellurium Tin Tungsten Vanadium Yttrium Zinc Zirconium".split(
    " ",
  ),
);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? [v] : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);

/** Four significant figures: plenty for a chart label, and a quarter of the bytes. */
function sig(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return 0;
  return Number(v.toPrecision(4));
}

const fmtN = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(sig(v)));

function tempText(t: unknown): string {
  let lo: number | null = null;
  let hi: number | null = null;
  if (Array.isArray(t)) {
    lo = num(t[0]);
    hi = num(t[1]);
  } else if (isObj(t)) {
    lo = num(t.min);
    hi = num(t.max);
  }
  if (hi != null && hi >= 999) hi = null; // the files' old "no upper bound"
  if (lo != null && hi != null) return `${fmtN(lo)}–${fmtN(hi)} K`;
  if (lo != null) return `at least ${fmtN(lo)} K`;
  if (hi != null) return `up to ${fmtN(hi)} K`;
  return "";
}

function colourTable(raw: unknown): GuideColours | null {
  const mapping = isObj(raw) ? (isObj(raw.mapping) ? raw.mapping : null) : null;
  if (!mapping) return null;
  const map = Object.entries(mapping)
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "")
    .map(([k, c]) => [k, c.trim()] as [string, string]);
  if (map.length === 0) return null;
  const keys = map.map(([k]) => k);
  const by = keys.every((k) => STAR_KEYS.has(k)) ? "star" : keys.every((k) => MATERIALS.has(k)) ? "material" : "geology";
  return { by, map };
}

/** The published conditions of a species (or the genus-wide ones), as readable lines. */
function requirements(c: Obj): GuideRequirement[] {
  const out: GuideRequirement[] = [];
  const atmo = list(c.atmosphere ?? c.atmospheres ?? c.required_atmosphere_type);
  if (atmo.length) out.push({ label: "Atmosphere", text: atmo.join(", ") });
  const gas = isObj(c.atmosphere_gas_share_pct) ? c.atmosphere_gas_share_pct : null;
  if (gas) {
    for (const [g, r] of Object.entries(gas)) {
      if (!isObj(r)) continue;
      const lo = num(r.min);
      const hi = num(r.max);
      out.push({
        label: "Air mix",
        text: `${g} ${lo != null && hi != null ? `${lo}–${hi}` : lo != null ? `≥ ${lo}` : `≤ ${hi}`} %`,
      });
    }
  }
  const planets = list(c.planet_types);
  if (planets.length) out.push({ label: "Body", text: planets.join(", ") });
  const t = tempText(c.temperature_K);
  if (t) out.push({ label: "Temperature", text: t });
  const g = num(c.max_gravity);
  if (g != null) out.push({ label: "Gravity", text: `up to ${g} g` });
  const p = num(c.minPressure);
  if (p != null) out.push({ label: "Pressure", text: `at least ${p} atm` });
  if (c.volcanismActiveRequired === true) out.push({ label: "Volcanism", text: "required" });
  else {
    const v = list(c.volcanism);
    if (v.length) out.push({ label: "Volcanism", text: v.join(", ") });
    else if (c.soft_no_volcanism === true) out.push({ label: "Volcanism", text: "usually none" });
  }
  const vo = list(c.volcanic_only_atmospheres);
  if (vo.length) out.push({ label: "Volcanism", text: `needed in ${vo.join(" or ")} air` });
  if (Array.isArray(c.presence_any_of)) {
    const alts = c.presence_any_of
      .map((a) => (isObj(a) ? (a.volcanismActiveRequired === true ? "active volcanism" : tempText(a.temperature_K)) : ""))
      .filter(Boolean);
    if (alts.length) out.push({ label: "Needs", text: alts.join(", or ") });
  }
  const star = isObj(c.parent_star) ? list(c.parent_star.required_types) : list(c.parent_star ?? c.parent_star_types);
  if (star.length) out.push({ label: "Star", text: star.join(", ") });
  const arr = isObj(c.distance_from_arrival) ? num(c.distance_from_arrival.min_ls) : null;
  if (arr != null) out.push({ label: "Distance", text: `at least ${fmtN(arr)} ls from arrival` });
  const fromStar = isObj(c.distance_from_star) ? num(c.distance_from_star.min_ls) : null;
  if (fromStar != null) out.push({ label: "Distance", text: `at least ${fmtN(fromStar)} ls from the star` });
  const sys = list(c.system_requirements);
  if (sys.length) out.push({ label: "System", text: `has ${sys.join(", or ")}` });
  const loc = str(c.location_requirement);
  if (loc) out.push({ label: "Location", text: loc.split(/(?<=\.)\s/)[0]! });
  return out;
}

function shares(counts: unknown, rename: (k: string) => string | null = (k) => k): GuideShare[] {
  if (!isObj(counts)) return [];
  const acc = new Map<string, number>();
  for (const [k, v] of Object.entries(counts)) {
    const n = num(v);
    const label = rename(k);
    if (n == null || n <= 0 || !label) continue;
    acc.set(label, (acc.get(label) ?? 0) + n);
  }
  return [...acc].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
}

const BODY_NAMES: Record<string, string> = {
  "Rocky body": "Rocky",
  "High metal content world": "High metal content",
  "High metal content body": "High metal content",
  "Metal rich body": "Metal rich",
  "Metal-rich body": "Metal rich",
  "Rocky ice world": "Rocky ice",
  "Rocky Ice world": "Rocky ice",
  "Icy body": "Icy",
};

/** A journal or Spansh body class, in the guide's short form ("Rocky body" → "Rocky"). */
export function guideBodyName(k: string): string {
  return BODY_NAMES[k] ?? k;
}

/** "F3" -> "F", "Neutron Star" -> "Neutron star": the host star by class, which is what colours follow. */
export function guideStarClass(s: string): string | null {
  if (/neutron/i.test(s) || /^N\d*$/.test(s)) return "Neutron star";
  if (/black hole/i.test(s)) return "Black hole";
  if (/white dwarf/i.test(s) || /^D[A-Z]*\d*$/.test(s)) return "White dwarf";
  if (/^TTS/.test(s)) return "T Tauri";
  if (/^AeBe/.test(s)) return "Herbig Ae/Be";
  if (/^W/.test(s)) return "Wolf-Rayet";
  if (/^(C|CN|CJ|MS|S)\d*$/.test(s)) return "Carbon / S";
  const m = s.match(/^([OBAFGKMLTY])\d*/);
  return m ? m[1]! : null;
}

/** A parsed `<species>_exomastery.json`, reduced to what the guide draws. */
export function guideMeasured(p: unknown): GuideMeasured | null {
  if (!isObj(p)) return null;
  const numerics = isObj(p.numerics) ? p.numerics : {};
  const display = isObj(p.displayHistograms) ? p.displayHistograms : {};
  const prov = isObj(p.provenance) ? p.provenance : {};
  const bodies = num(prov.bodies) ?? num(p.sampleCount) ?? 0;
  if (bodies <= 0) return null;
  const hist: Record<string, GuideHist> = {};
  const ids = [
    ...GUIDE_PARAMS.map((d) => d.id),
    ...Object.keys(numerics).filter(
      (k) => k.startsWith(GUIDE_ATMO_PREFIX) && (num((numerics[k] as Obj)?.count) ?? 0) >= bodies * GAS_MIN_SHARE,
    ),
  ];
  for (const id of ids) {
    const s = numerics[id];
    const d = display[id];
    if (!isObj(s) || !isObj(d) || !Array.isArray(d.counts)) continue;
    const min = num(d.min) ?? num(s.min);
    const max = num(d.max) ?? num(s.max);
    const mode = num(s.mode) ?? num(s.mean);
    const n = num(s.count) ?? 0;
    if (min == null || max == null || mode == null || n <= 0) continue;
    const k = guideParam(id)?.scale ?? 1;
    const lo = Math.min(min * k, max * k);
    const hi = Math.max(min * k, max * k);
    hist[id] = {
      min: sig(lo),
      max: sig(hi),
      mode: sig(mode * k),
      mean: sig((num(s.mean) ?? mode) * k),
      n,
      counts: d.counts.map((c) => num(c) ?? 0),
    };
  }
  const cat = isObj(p.categorical) ? p.categorical : {};
  const lockedC = isObj(cat["body.rotationalPeriodTidallyLocked"]) ? cat["body.rotationalPeriodTidallyLocked"] : null;
  const yes = lockedC ? (num(lockedC.true) ?? 0) : 0;
  const no = lockedC ? (num(lockedC.false) ?? 0) : 0;
  const materials = Object.entries(numerics)
    .filter(([k]) => k.startsWith("body.materials."))
    .map(([k, v]) => ({
      name: k.slice("body.materials.".length),
      mode: sig(num((v as Obj).mode) ?? 0),
      n: num((v as Obj).count) ?? 0,
    }))
    .filter((m) => m.n > 0)
    .sort((a, b) => b.n - a.n || b.mode - a.mode);
  return {
    bodies,
    hist,
    planet: shares(cat["body.subType"], guideBodyName),
    atmosphere: shares(cat["body.atmosphereType"]),
    volcanism: shares(cat["body.volcanismType"]),
    star: shares(cat["exo.host_star_spectral_primary"], guideStarClass),
    locked: yes + no > 0 ? yes / (yes + no) : null,
    materials,
  };
}

/**
 * One genus file (`<genus>_new.json`, parsed) and a profile per species, slimmed. `profileFor` gets
 * the species id and display name and returns the parsed profile or null.
 */
export function buildGuideGenus(dir: string, genusJson: unknown, profileFor: (id: string, name: string) => unknown): GuideGenus {
  const j = isObj(genusJson) ? genusJson : {};
  const meta = isObj(j.meta) ? j.meta : {};
  const general = isObj(meta.general) ? meta.general : {};
  const genusName = str(j.genus) || dir;
  const genusDist = num(meta.minSampleDistanceM) ?? num(general.min_sample_distance_m);
  const wide = isObj(meta.genusWideRequirements)
    ? meta.genusWideRequirements
    : isObj(general.planet_requirements)
      ? general.planet_requirements
      : {};
  const rows = (Array.isArray(j.species) ? j.species : []).filter(isObj);
  const species: GuideSpecies[] = rows.map((s) => {
    const name = str(s.displayName);
    const id = str(s.id) || guideProfileFileName(name).replace(/_exomastery\.json$/, "");
    const c = isObj(s.conditions) ? s.conditions : {};
    const own = num(c.min_sample_distance_m);
    return {
      id,
      name,
      sampleDistanceM: own != null && own >= 10 && own !== genusDist ? own : null,
      requires: requirements(c),
      colours: colourTable(s.color_rules),
      measured: guideMeasured(profileFor(id, name)),
    };
  });
  species.sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: dir,
    name: genusName,
    description: str(meta.summary) || str(general.description),
    sampleDistanceM: genusDist != null && genusDist >= 10 ? genusDist : null,
    requires: requirements(wide),
    colours: colourTable(meta.color_variants),
    species,
  };
}
