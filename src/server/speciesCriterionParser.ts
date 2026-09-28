/**
 * A species row from the genus JSON, read into the matcher's criteria. Split out of speciesTreeLoader.ts (code review D, 2026-09-27).
 */
import { isCodexAnyThinAtmospherePhrase } from "../shared/scanAtmosphereMatch.js";
import { JOURNAL_PLANET_CLASS, planetClassId } from "../shared/normalise/planetClass.js";
import type { SpeciesCriterion } from "../shared/types.js";

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Hand-written JSON uses short labels; journal `Scan` uses these `PlanetClass` strings. */
export function expandPlanetTypesToJournalClasses(labels: string[]): string[] {
  const out = new Set<string>();
  for (const raw of labels) {
    const t = raw.trim();
    if (!t) continue;
    // One normaliser for every spelling (code review B7): this used to miss "Metal-Rich" (hyphen) and
    // wrote "Earth-like world" where the journal writes "Earthlike body".
    const id = planetClassId(t);
    if (id) out.add(JOURNAL_PLANET_CLASS[id]);
    else if (/ body$/i.test(t) && t.length > 5) out.add(t.replace(/\s+/g, " "));
    /** Unknown short label ("Airless") — skip rather than inventing a wrong PlanetClass. */
  }
  return [...out];
}

const ATMOSPHERE_PHRASE_TO_JOURNAL: Record<string, string> = {
  "carbon dioxide": "CarbonDioxide",
  co2: "CarbonDioxide",
  "sulphur dioxide": "SulphurDioxide",
  "sulfur dioxide": "SulphurDioxide",
  ammonia: "Ammonia",
  water: "Water",
  oxygen: "Oxygen",
  nitrogen: "Nitrogen",
  methane: "Methane",
  argon: "Argon",
  neon: "Neon",
  helium: "Helium",
  hydrogen: "Hydrogen",
};

function stripAtmosphereQualifier(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*/g, "").trim();
}

/** Map human-readable atmosphere phrases to journal `AtmosphereType` tokens. */
export function normalizeAtmosphereToJournal(labels: string[]): string[] {
  const out: string[] = [];
  for (const raw of labels) {
    const s = raw.trim();
    if (!s) continue;
    const lo = s.toLowerCase().replace(/_/g, " ");
    if (
      lo === "none" ||
      lo === "vacuum" ||
      lo === "airless" ||
      lo.includes("no atmosphere") ||
      lo === "no atmosphere"
    ) {
      out.push("");
      continue;
    }
    if (!/\s/.test(s) && /^[A-Z][a-zA-Z]+$/.test(s)) {
      out.push(s);
      continue;
    }
    const stripped = stripAtmosphereQualifier(s);
    const tryKeys = [s.toLowerCase().replace(/\s+/g, " "), stripped.toLowerCase().replace(/\s+/g, " ")];
    let mapped = false;
    for (const k of tryKeys) {
      if (ATMOSPHERE_PHRASE_TO_JOURNAL[k]) {
        out.push(ATMOSPHERE_PHRASE_TO_JOURNAL[k]!);
        mapped = true;
        break;
      }
      const beforeDash =
        k
          .split(/\s*-\s*/)[0]
          ?.trim()
          .toLowerCase() ?? "";
      if (beforeDash && beforeDash !== k && ATMOSPHERE_PHRASE_TO_JOURNAL[beforeDash]) {
        out.push(ATMOSPHERE_PHRASE_TO_JOURNAL[beforeDash]!);
        mapped = true;
        break;
      }
    }
    if (mapped) continue;
    const compact = stripped.replace(/[\s-]+/g, "");
    if (compact) out.push(compact.charAt(0).toUpperCase() + compact.slice(1));
  }
  return [...new Set(out)];
}

export function pickString(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function toStringArray(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) {
    const out = v.map((x) => String(x).trim()).filter(Boolean);
    return out.length ? out : undefined;
  }
  if (typeof v === "string" && v.trim()) {
    const parts = v
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : [v.trim()];
  }
  return undefined;
}

function toBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "yes") return true;
  if (v === "false" || v === "no") return false;
  return undefined;
}

function mergeRange(
  target: { min?: number; max?: number } | undefined,
  minV: number | undefined,
  maxV: number | undefined,
): { min?: number; max?: number } | undefined {
  const out: { min?: number; max?: number } = { ...(target ?? {}) };
  if (minV !== undefined) out.min = out.min !== undefined ? Math.max(out.min, minV) : minV;
  if (maxV !== undefined) out.max = out.max !== undefined ? Math.min(out.max, maxV) : maxV;
  if (out.min === undefined && out.max === undefined) return undefined;
  return out;
}

export function buildCriterionFromRecord(src: Record<string, unknown>): SpeciesCriterion {
  const c: SpeciesCriterion = {};

  const pcTypes = toStringArray(firstDefined(src, ["planet_types", "planetTypes", "worldTypes"]));
  const pcOther = toStringArray(
    firstDefined(src, [
      "planetClassAnyOf",
      "planetClasses",
      "planetClass",
      "PlanetClass",
      "WorldType",
      "worldType",
      "bodyClass",
      "BodyClass",
      "allowedPlanetClasses",
      "PlanetClasses",
      "planet",
      "Planet",
      "Body",
    ]),
  );
  const pc = pcTypes?.length ? expandPlanetTypesToJournalClasses(pcTypes) : pcOther;
  if (pc?.length) {
    const adjusted: string[] = [];
    for (const x of pc) {
      if (/\bbody\b/i.test(x)) adjusted.push(x);
      else adjusted.push(...expandPlanetTypesToJournalClasses([x]));
    }
    c.planetClassAnyOf = [...new Set(adjusted)];
  }

  const atRaw = toStringArray(
    firstDefined(src, [
      "atmosphereTypeAnyOf",
      "atmosphereTypes",
      "atmosphereType",
      "AtmosphereType",
      "atmospheres",
      "atmosphere",
      "Atmosphere",
    ]),
  );
  if (atRaw?.length) {
    const anyThinOnly = atRaw.every((x) => isCodexAnyThinAtmospherePhrase(String(x)));
    /**
     * "Any thin atmosphere" is a constraint, not the absence of one.
     *
     * It drops the *composition* restriction and keeps the requirement that there **be** an
     * atmosphere. Dropping the list entirely lost the second half, so Bacterium tela — whose row
     * reads exactly that phrase — carried no atmosphere gate at all and was offered on airless
     * bodies once its volcanism list was overruled by observation.
     *
     * The matcher has always been ready for it: `atmosphereAllowlistMeansAnyThinCompositionOnly`
     * plus a thin `atmospherePressureCategory` selects a branch that fails on vacuum with
     * "journal must report an atmosphere after detailed scan". That branch was unreachable while
     * this function was the only thing that could set the phrase and refused to.
     */
    c.atmosphereTypeAnyOf = anyThinOnly ? atRaw : normalizeAtmosphereToJournal(atRaw);
  }

  /**
   * The same "without this gas, nothing here grows" rule the genus can declare, said by one species.
   *
   * A genus can only require a gas when *every* species in it does. Recepta can; Bacterium, Tussock,
   * Frutexa and Fonticulua cannot — they live in every atmosphere the game has, and yet each holds a
   * species that has never once been recorded outside a single gas. Frutexa collum is 133 of 133
   * sightings on sulphur dioxide inside a genus whose other six species agree with it 0 times.
   *
   * Without a species-level key those rows are ungated, so a body carrying a trace of the gas offers
   * them exactly as if it were their habitat — the failure the genus rule was written to stop, in
   * the genera the genus rule cannot reach.
   */
  const reqAtmoRaw = toStringArray(
    firstDefined(src, ["required_atmosphere_type", "requiredAtmosphereType", "atmosphereTypeRequiredAnyOf"]),
  );
  if (reqAtmoRaw?.length) {
    c.atmosphereTypeRequiredAnyOf = normalizeAtmosphereToJournal(reqAtmoRaw);
  }

  /**
   * Composition bands, written in the species file as the gas name against its allowed share:
   *
   * ```json
   * "atmosphere_gas_share_pct": { "Argon": { "min": 50 } }
   * ```
   *
   * Gas names are left exactly as written and matched against `AtmosphereComposition` by
   * `atmosphereCompositionKey`, so `Carbon dioxide`, `CarbonDioxide` and `carbon_dioxide` all work.
   */
  const gasShareRaw = asRecord(
    firstDefined(src, ["atmosphere_gas_share_pct", "atmosphereGasSharePct", "gas_share_pct"]),
  );
  if (gasShareRaw) {
    const bands: { gas: string; min?: number; max?: number }[] = [];
    for (const [gas, spec] of Object.entries(gasShareRaw)) {
      const name = gas.trim();
      if (!name) continue;
      const r = asRecord(spec);
      const min = toNumber(r?.min ?? r?.minimum ?? r?.minPct);
      const max = toNumber(r?.max ?? r?.maximum ?? r?.maxPct);
      if (min === undefined && max === undefined) continue;
      bands.push({ gas: name, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
    }
    if (bands.length) c.atmosphereGasSharePct = bands;
  }

  const land = toBool(src.landable ?? src.Landable);
  if (land !== undefined) c.landable = land;
  const known = src.known_systems ?? src.knownSystems;
  if (Array.isArray(known)) {
    const ids = known.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length) c.systemAddressAnyOf = ids;
  }
  if (toBool(src.outside_signal_count ?? src.outsideSignalCount) === true) c.outsideSignalCount = true;

  const sg = asRecord(src.surfaceGravity ?? src.SurfaceGravity);
  if (sg) {
    c.surfaceGravity = {
      min: toNumber(sg.min ?? sg.minG ?? sg.minimum),
      max: toNumber(sg.max ?? sg.maxG ?? sg.maximum),
    };
  } else {
    const gMin = toNumber(firstDefined(src, ["gravityMin", "surfaceGravityMin", "minGravity", "gMin"]));
    const gMax = toNumber(firstDefined(src, ["gravityMax", "surfaceGravityMax", "maxGravity", "gMax"]));
    const maxG = toNumber(src.max_gravity ?? src.maxGravity);
    const fromRange = mergeRange(undefined, gMin, gMax);
    if (fromRange) {
      c.surfaceGravity = { ...fromRange };
      if (maxG !== undefined) {
        c.surfaceGravity.max =
          c.surfaceGravity.max !== undefined ? Math.min(c.surfaceGravity.max, maxG) : maxG;
      }
    } else if (maxG !== undefined) {
      c.surfaceGravity = { max: maxG };
    }
  }

  const tkAny = firstDefined(src, ["temperature_K", "temperatureK", "temp_K"]);
  const tkRec = asRecord(tkAny);
  if (tkRec && !Array.isArray(tkAny)) {
    c.surfaceTemperatureK = {
      min: toNumber(tkRec.min ?? tkRec.minK),
      max: toNumber(tkRec.max ?? tkRec.maxK),
    };
  } else if (Array.isArray(tkAny) && tkAny.length >= 2) {
    const lo = toNumber(tkAny[0]);
    const hi = toNumber(tkAny[1]);
    /**
     * `[min, max]`, where **`null` means no upper bound** and a number means that number.
     *
     * It used to mean "no upper bound" for `999` *or anything ≥ 500*, and that threshold was a
     * landmine rather than a convention: it fired on the six `999`s in `stratum_new.json` and on
     * nothing else, so the only thing it could ever do in future was silently unbound a species
     * whose codex row genuinely stops at 600 K. Checked before removing it — the distinct maxima in
     * the whole database are 155, 160, 170, 175, 180, 190, 195 and 999, with nothing in between, so
     * dropping the threshold changes no current row.
     *
     * `999` is still honoured for hand-edited or older files, and is deprecated. Write `null`.
     */
    const openEnded = hi === undefined || hi === 999;
    c.surfaceTemperatureK = { min: lo, max: openEnded ? undefined : hi };
  } else {
    const st = asRecord(src.surfaceTemperatureK ?? src.surfaceTemperature ?? src.temperatureK);
    if (st) {
      c.surfaceTemperatureK = {
        min: toNumber(st.min ?? st.minK),
        max: toNumber(st.max ?? st.maxK),
      };
    } else {
      const tMin = toNumber(
        firstDefined(src, [
          "minTemperature",
          "tempMin",
          "temperatureMin",
          "surfaceTemperatureMinK",
          "minTempK",
        ]),
      );
      const tMax = toNumber(
        firstDefined(src, [
          "maxTemperature",
          "tempMax",
          "temperatureMax",
          "surfaceTemperatureMaxK",
          "maxTempK",
        ]),
      );
      const t = mergeRange(undefined, tMin, tMax);
      if (t) c.surfaceTemperatureK = t;
    }
  }

  // A measured band inside the codex one, which demotes and never hides — see SpeciesCriterion.
  const softT = asRecord(firstDefined(src, ["soft_temperature_K", "softTemperatureK"]));
  if (softT) {
    const lo = toNumber(softT.min);
    const hi = toNumber(softT.max);
    if (lo !== undefined || hi !== undefined) c.softTemperatureK = { min: lo, max: hi };
  }

  // A measured ceiling on the body's own orbit, which demotes and never hides — see SpeciesCriterion.
  const softSma = toNumber(firstDefined(src, ["soft_max_semi_major_axis_ls", "softMaxSemiMajorAxisLs"]));
  if (softSma !== undefined) c.softMaxSemiMajorAxisLs = softSma;

  const sp = asRecord(src.surfacePressure ?? src.SurfacePressure);
  if (sp) {
    c.surfacePressure = {
      min: toNumber(sp.min),
      max: toNumber(sp.max),
    };
  } else {
    const pMin = toNumber(firstDefined(src, ["pressureMin", "minPressure", "surfacePressureMin"]));
    const pMax = toNumber(firstDefined(src, ["pressureMax", "maxPressure", "surfacePressureMax"]));
    const p = mergeRange(undefined, pMin, pMax);
    if (p) c.surfacePressure = p;
  }

  const vol = toStringArray(src.volcanismIncludes ?? src.volcanism ?? src.Volcanism);
  if (vol?.length) c.volcanismIncludes = vol;

  const pst = toStringArray(
    firstDefined(src, [
      "parentStarTypeIncludesAnyOf",
      "parentStarTypeIncludes",
      "parent_star_type_includes",
      "starTypeIncludes",
      "StarTypeIncludes",
    ]),
  );
  if (pst?.length) {
    const lo = pst.map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (lo.length) c.parentStarTypeIncludesAnyOf = lo;
  }

  const orbitRec = asRecord(
    firstDefined(src, [
      "orbitDistanceFromParentStarLs",
      "orbit_ls",
      "orbitFromStarLs",
      "orbit_from_star_ls",
      /**
       * The spelling the species files actually use, and the one this parser did not read.
       *
       * `clypeus_speculumi` carries `distance_from_star: { min_ls: 2500, approx_AU: 5 }` and it was
       * dropped in silence — the rule existed in the data, in `ABSTRACT-COND.md` §4, and nowhere in
       * the matcher. Measured on the corpus it is one of the sharpest conditions we have: 293 of 295
       * resolvable speculumi bodies are ≥ 2,500 ls (99.3 %), against 1.7 % of lacrimam and 2.5 % of
       * margaritus.
       */
      "distance_from_star",
      "distanceFromStar",
    ]),
  );
  const arrivalRec = asRecord(
    firstDefined(src, ["distanceFromArrivalLs", "distance_from_arrival", "distance_from_arrival_ls"]),
  );
  if (arrivalRec) {
    c.distanceFromArrivalLs = {
      min: toNumber(arrivalRec.min ?? arrivalRec.min_ls ?? arrivalRec.minLs),
      max: toNumber(arrivalRec.max ?? arrivalRec.max_ls ?? arrivalRec.maxLs),
    };
  }
  if (orbitRec) {
    c.orbitDistanceFromParentStarLs = {
      min: toNumber(orbitRec.min ?? orbitRec.min_ls ?? orbitRec.minLs),
      max: toNumber(orbitRec.max ?? orbitRec.max_ls ?? orbitRec.maxLs),
    };
  }

  const apc = pickString(
    src,
    "atmospherePressureCategory",
    "pressureCategory",
    "atmosphere_pressure",
    "atmospherePressure",
  );
  if (apc) {
    const lo = apc.trim().toLowerCase();
    if (lo === "thin" || lo === "thick") c.atmospherePressureCategory = lo;
  }

  const gsi = toStringArray(
    firstDefined(src, [
      "geologicalSignalIncludes",
      "geological_signals",
      "fssGeologicalIncludes",
      "scannerGeologicalIncludes",
    ]),
  );
  if (gsi?.length) {
    const lo = gsi.map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (lo.length) c.geologicalSignalIncludes = lo;
  }

  const watm = toNumber(
    firstDefined(src, [
      "whenAtmosphereLinkedMaxTempK",
      "when_atmosphere_max_temp_k",
      "atmosphereLinkedMaxTempK",
      "co2MaxTempK",
    ]),
  );
  if (watm !== undefined) c.whenAtmosphereLinkedMaxTempK = watm;

  const watmMin = toNumber(
    firstDefined(src, [
      "whenAtmosphereLinkedMinTempK",
      "when_atmosphere_min_temp_k",
      "atmosphereLinkedMinTempK",
    ]),
  );
  if (watmMin !== undefined) c.whenAtmosphereLinkedMinTempK = watmMin;

  const watmAt = toStringArray(
    firstDefined(src, [
      "whenAtmosphereLinkedAtmosphereAnyOf",
      "when_atmosphere_linked_atmosphere_any_of",
      "atmosphereLinkedAtmosphereAnyOf",
    ]),
  );
  if (watmAt?.length) c.whenAtmosphereLinkedAtmosphereAnyOf = normalizeAtmosphereToJournal(watmAt);

  if (toBool(src.volcanismActiveRequired ?? src.requires_active_volcanism) === true) {
    c.volcanismActiveRequired = true;
  }
  // Measured volcanism facts that demote and never hide — see SpeciesCriterion.
  if (toBool(src.off_list_atmosphere_needs_volcanism ?? src.offListAtmosphereNeedsVolcanism) === true) {
    c.offListAtmosphereNeedsVolcanism = true;
  }
  if (toBool(src.soft_no_volcanism ?? src.softNoVolcanism) === true) c.softNoVolcanism = true;
  const volcAtm = toStringArray(firstDefined(src, ["volcanic_only_atmospheres", "volcanicOnlyAtmospheres"]));
  if (volcAtm?.length) c.volcanicOnlyAtmospheres = normalizeAtmosphereToJournal(volcAtm);

  /*
    Presence branches — the one "or" the condition format has. Each is a criterion object in its own
    right and goes through this same function, so a branch can say anything a top-level row can and
    the spellings stay identical. Empty branches are dropped rather than kept as "a branch with no
    requirements", which would pass on every body and silently disable the rule it was added for.
  */
  const branchesRaw = firstDefined(src, ["presence_any_of", "presenceAnyOf"]);
  if (Array.isArray(branchesRaw)) {
    const branches = branchesRaw
      .map((b) => asRecord(b))
      .filter((b): b is Record<string, unknown> => b != null)
      .map((b) => buildCriterionFromRecord(b))
      .filter((b) => Object.keys(b).length > 0);
    if (branches.length > 0) c.presenceAnyOf = branches;
  }

  const mnotes = toStringArray(
    firstDefined(src, ["matchContextNotes", "habitatConditionNotes", "conditionNotes", "codexNotes"]),
  );
  if (mnotes?.length) c.matchContextNotes = mnotes.map((s) => s.trim()).filter(Boolean);

  return c;
}

export function firstDefined(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}
