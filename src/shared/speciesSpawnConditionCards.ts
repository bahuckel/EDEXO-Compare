import type {
  EstimatedSurfaceTempBand,
  PlanetScan,
  SpeciesCriterion,
  SpeciesEntry,
  SpeciesMatchContext,
} from "./types.js";
import { journalPressureToAtm, journalSurfaceGravityToG, THIN_ATMOSPHERE_MAX_ATM } from "./journalPhysics.js";
import { normalizeScanAtmosphereForMatch, atmosphereCompositionKey } from "./scanAtmosphereMatch.js";
import { spectralKeysFromJournalStarType } from "./starSpectralKeys.js";
import { isBacteriumSpeciesEntry } from "./speciesBacterium.js";
import { formatGenusStarColorSoftOneLine } from "./genusStarColorSoft.js";
import { volcanismJournalMatchesFragments, expandVolcanismCriterionFragments } from "./volcanismMatch.js";

const OPEN_LO = -1e15;
const OPEN_HI = 1e15;

const GENUS_DATA_DIR_REQUIRING_VOLCANISM = new Set<string>(["brain-tree"]);
const GENUS_DATA_DIR_REQUIRING_NO_ATMOSPHERE = new Set<string>(["brain-tree"]);

export type EncyclopediaSpawnTier = "blue" | "red" | "yellow" | "neutral";

export interface EncyclopediaSpawnConditionCard {
  id: string;
  label: string;
  lines: string[];
  caption: string;
  tier: EncyclopediaSpawnTier;
}

function speciesTempBand(c: SpeciesCriterion): { lo: number; hi: number } | null {
  const st = c.surfaceTemperatureK;
  if (!st) return null;
  if (st.min === undefined && st.max === undefined) return null;
  return { lo: st.min ?? OPEN_LO, hi: st.max ?? OPEN_HI };
}

function speciesPressureBand(c: SpeciesCriterion): { lo: number; hi: number } | null {
  const sp = c.surfacePressure;
  if (!sp) return null;
  if (sp.min === undefined && sp.max === undefined) return null;
  return { lo: sp.min ?? OPEN_LO, hi: sp.max ?? OPEN_HI };
}

function speciesNeedsTemperatureGate(c: SpeciesCriterion): boolean {
  return speciesTempBand(c) !== null;
}

interface PlanetTemperatureBand {
  minK: number;
  maxK: number;
}

function tempBandsOverlap(planet: PlanetTemperatureBand, speciesBand: { lo: number; hi: number }): boolean {
  return planet.minK <= speciesBand.hi && speciesBand.lo <= planet.maxK;
}

function journalReportsAnyVolcanism(scan: PlanetScan): boolean {
  const raw = scan.Volcanism;
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (!v) return false;
  const lo = v.toLowerCase();
  if (lo.includes("no volcanism")) return false;
  return true;
}

function volcanoCaption(raw: unknown): string {
  const v = raw != null ? String(raw).trim() : "";
  return v ? v.slice(0, 72) + (v.length > 72 ? "…" : "") : "Active volcanism";
}

function inRange(v: number, min?: number, max?: number): boolean {
  if (min !== undefined && v < min) return false;
  if (max !== undefined && v > max) return false;
  return true;
}

function planetTemperatureBandFromSnapshot(est: EstimatedSurfaceTempBand | null): PlanetTemperatureBand | null {
  if (!est) return null;
  return { minK: est.minK, maxK: est.maxK };
}

function formatSpeciesTempRequirement(band: { lo: number; hi: number }): string {
  const openLo = band.lo <= OPEN_LO / 2;
  const openHi = band.hi >= OPEN_HI / 2;
  if (openLo && !openHi) return `≤ ${band.hi} K`;
  if (!openLo && openHi) return `≥ ${band.lo} K`;
  if (openLo && openHi) return "Any temperature (open-ended)";
  return `${band.lo}–${band.hi} K`;
}

function atmospheresMatchSpeciesList(scan: PlanetScan, allowed: string[]): boolean {
  const atmoNorm = normalizeScanAtmosphereForMatch(scan);
  const vacuumAllowed = allowed.some((a) => !(a ?? "").trim());
  if (!atmoNorm && !vacuumAllowed) return false;
  return (
    (atmoNorm === "" && vacuumAllowed) ||
    (atmoNorm !== "" &&
      allowed.some((a) => {
        if (!a?.trim()) return false;
        if (a === atmoNorm) return true;
        if (a.toLowerCase() === atmoNorm.toLowerCase()) return true;
        return atmosphereCompositionKey(a) === atmosphereCompositionKey(atmoNorm);
      }))
  );
}

function linkedTempCapApplies(scan: PlanetScan | null, c: SpeciesCriterion): boolean {
  if (!scan) return false;
  const linkedAtmo = c.whenAtmosphereLinkedAtmosphereAnyOf;
  const linkedAny = !!(linkedAtmo?.length ?? false);
  if (linkedAny) {
    const allowed = linkedAtmo!;
    return atmospheresMatchSpeciesList(scan, allowed);
  }
  return !!(c.atmosphereTypeAnyOf?.length);
}

/** Mirrors matcher: UI cards vs selected BODY planet. */
export function buildEncyclopediaSpawnConditionCards(args: {
  entry: SpeciesEntry;
  scan: PlanetScan | null;
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  speciesMatchContext: SpeciesMatchContext | null | undefined;
}): EncyclopediaSpawnConditionCard[] {
  const { entry } = args;
  const scan = args.scan ?? null;
  const ctx = args.speciesMatchContext;
  const c = entry.criteria;
  const planetBand = planetTemperatureBandFromSnapshot(args.estimatedSurfaceTempK);
  const midK = args.estimatedSurfaceTempK?.midK;
  const out: EncyclopediaSpawnConditionCard[] = [];

  const bac = isBacteriumSpeciesEntry(entry);

  /* Planet class */
  {
    const hasList = !!(c.planetClassAnyOf?.length ?? false);
    const lines = hasList
      ? [`Types: ${c.planetClassAnyOf!.join(", ")}`]
      : bac
        ? ["Any"]
        : ['Matcher rejects non-bacterium rows missing planetClassAnyOf — malformed JSON.'];

    let tier: EncyclopediaSpawnTier = "neutral";
    let caption = "Codex criterion";
    if (hasList) {
      if (!scan?.PlanetClass) {
        tier = "yellow";
        caption = "Need planet class in scan";
      } else if (!c.planetClassAnyOf!.includes(scan.PlanetClass)) {
        tier = "red";
        caption = `Journal · ${scan.PlanetClass}`;
      } else {
        tier = "blue";
        caption = `Match · ${scan.PlanetClass}`;
      }
    } else if (bac) {
      caption = "Matcher ignores planet type for bacterium (atmosphere gates only)";
    }
    out.push({ id: "planet-class", label: "Planet class", lines, caption, tier });
  }

  /* Atmosphere types (+ brain-tree genus airless) — encyclopedia skips for bacterium (still matched server-side). */
  if (!bac && c.atmosphereTypeAnyOf?.length) {
    const lines = [`Allowed: ${c.atmosphereTypeAnyOf.map((a) => (!a?.trim() ? "(no atmosphere)" : a)).join(", ")}`];
    let tier: EncyclopediaSpawnTier;
    let caption: string;
    if (!scan) {
      tier = "yellow";
      caption = "No body scan";
    } else {
      const atmoNorm = normalizeScanAtmosphereForMatch(scan);
      if (GENUS_DATA_DIR_REQUIRING_NO_ATMOSPHERE.has(entry.genusDataDir) && atmoNorm !== "") {
        tier = "red";
        caption = "Brain-tree: airless only";
      } else if (!atmoNorm && !(c.atmosphereTypeAnyOf ?? []).some((a) => !a?.trim())) {
        tier = "red";
        caption = "Need AtmosphereType scan";
      } else if (atmospheresMatchSpeciesList(scan, c.atmosphereTypeAnyOf!)) {
        tier = "blue";
        caption = atmoNorm === "" ? "(vacuum OK)" : atmoNorm;
      } else {
        tier = "red";
        caption = atmoNorm === "" ? "Vacuum" : atmoNorm;
      }
    }
    out.push({ id: "atmosphere-type", label: "Atmosphere types", lines, caption, tier });
  } else if (GENUS_DATA_DIR_REQUIRING_NO_ATMOSPHERE.has(entry.genusDataDir) && scan) {
    const atmoNorm = normalizeScanAtmosphereForMatch(scan);
    out.push({
      id: "genus-airless",
      label: "Brain-tree airless gate",
      lines: ["Brain trees only appear on airless worlds."],
      caption: atmoNorm === "" ? "Vacuum OK" : `Journal: ${atmoNorm || "(atmosphere)"}`,
      tier: atmoNorm === "" ? "blue" : "red",
    });
  }

  /* Landable */
  if (c.landable === true) {
    const lines = ["Landable bodies only."];
    let tier: EncyclopediaSpawnTier = "yellow";
    let caption = "Landable absent in journal";
    if (scan?.Landable === false) {
      tier = "red";
      caption = "Not landable";
    } else if (scan?.Landable === true) {
      tier = "blue";
      caption = "Landable OK";
    } else if (!scan) tier = "yellow";
    out.push({ id: "landable-yes", label: "Landable", lines, caption, tier });
  } else if (c.landable === false) {
    out.push({
      id: "landable-flag-false",
      label: "Landable",
      lines: ["JSON landable:false — informational (matcher ignores)."],
      caption: "Not a gate",
      tier: "neutral",
    });
  }

  /* Volcanism */
  const genusNeedsVolcano = GENUS_DATA_DIR_REQUIRING_VOLCANISM.has(entry.genusDataDir);
  const volcanoFragments = !!(c.volcanismIncludes?.length ?? false);
  const explicitVolcano = c.volcanismActiveRequired === true;
  if (genusNeedsVolcano || volcanoFragments || explicitVolcano) {
    const lines: string[] = [];
    if (genusNeedsVolcano) lines.push("Genus Brain Tree: active volcanism required.");
    if (volcanoFragments) {
      const expanded = expandVolcanismCriterionFragments(c.volcanismIncludes!);
      lines.push(`Journal volcanism must include one of: ${expanded.join(" / ")}`);
    }
    if (explicitVolcano && !volcanoFragments) lines.push("volcanismActiveRequired — volcanism field must exist.");
    let tier: EncyclopediaSpawnTier = "yellow";
    let caption = "No body scan";

    if (scan) {
      if (!journalReportsAnyVolcanism(scan)) {
        tier = "red";
        caption = scan.Volcanism ? `"${String(scan.Volcanism).slice(0, 48)}"` : "No volcanism line";
      } else if (volcanoFragments) {
        const okV = volcanismJournalMatchesFragments(scan.Volcanism, c.volcanismIncludes!);
        tier = okV ? "blue" : "red";
        caption = okV ? "Fragment OK" : "Fragment mismatch";
      } else {
        tier = "blue";
        caption = volcanoCaption(scan.Volcanism);
      }
    }
    out.push({ id: "volcanism", label: "Volcanism", lines, caption, tier });
  }

  /* Gravity (criteria in Earth g after journal conversion) */
  if (c.surfaceGravity && (c.surfaceGravity.min !== undefined || c.surfaceGravity.max !== undefined)) {
    const sg = c.surfaceGravity;
    const lines = [`${sg.min ?? "—"} … ${sg.max ?? "—"} g`];
    let tier: EncyclopediaSpawnTier = "yellow";
    let caption = "No SurfaceGravity";

    const gRaw = scan?.SurfaceGravity;
    if (scan && gRaw != null && gRaw !== undefined && Number.isFinite(gRaw)) {
      const g = journalSurfaceGravityToG(gRaw);
      if (inRange(g, sg.min, sg.max)) {
        tier = "blue";
        caption = `${g.toFixed(3)} g satisfies gate`;
      } else {
        tier = "red";
        caption = `${g.toFixed(3)} g out of species band`;
      }
    } else if (!scan) {
      caption = "No body scan";
    }
    out.push({ id: "surface-gravity", label: "Surface gravity", lines, caption, tier });
  }

  /* Species surface temperature overlap */
  if (speciesNeedsTemperatureGate(c)) {
    const band = speciesTempBand(c)!;
    const lines = [`Species: ${formatSpeciesTempRequirement(band)}`];
    let tier: EncyclopediaSpawnTier;
    let caption: string;

    if (!planetBand) {
      tier = "yellow";
      caption = "Cannot build surface band — need Temperature + mappable PlanetClass heuristic";
    } else if (!tempBandsOverlap(planetBand, band)) {
      tier = "red";
      caption = `Body band ${planetBand.minK}–${planetBand.maxK} K has no overlap`;
    } else {
      tier = "blue";
      const surf = scan?.SurfaceTemperature;
      caption =
        midK != null
          ? `Band ${planetBand.minK}–${planetBand.maxK} K overlaps (mid ~${Math.round(midK)} K)`
          : `Band ${planetBand.minK}–${planetBand.maxK} K overlaps species gate`;
      if (surf != null && Number.isFinite(surf))
        caption = `${caption} · journal ${surf.toFixed(1)} K`;
    }

    out.push({ id: "surface-temperature", label: "Surface temperature", lines, caption, tier });
  }

  /* Codex-linked max temperature when atmosphere subset matches — skip bacterium encyclopedia clutter. */
  if (!bac && c.whenAtmosphereLinkedMaxTempK !== undefined) {
    const cap = c.whenAtmosphereLinkedMaxTempK;
    const lines = [`Atmosphere-linked band cap ≤ ${cap} K`];
    let tier: EncyclopediaSpawnTier = "neutral";
    let caption = "";

    const applies = scan ? linkedTempCapApplies(scan, c) : false;
    if (!scan) {
      tier = "yellow";
      caption = "No scan";
    } else if (!applies) {
      tier = "neutral";
      caption = "Caps not enforced for this body's atmosphere subset";
    } else if (!planetBand) {
      tier = "yellow";
      caption = "Need SurfaceTemperature / heuristic band";
    } else if (planetBand.maxK > cap) {
      tier = "red";
      caption = `Band max ${planetBand.maxK} K exceeds cap`;
    } else {
      tier = "blue";
      caption = `Band max ${planetBand.maxK} K ≤ ${cap} K`;
    }

    out.push({ id: "linked-temp-cap", label: "Atmosphere-linked temperature cap", lines, caption, tier });
  }

  /* Journal numeric pressure gate — hidden for bacterium (spawn cards stay minimal). */
  if (!bac) {
    const pb = speciesPressureBand(c);
    if (pb && scan) {
      const lines = [
        pb.lo <= OPEN_LO / 2
          ? `≤ ${pb.hi} atm`
          : pb.hi >= OPEN_HI / 2
            ? `≥ ${pb.lo} atm`
            : `${pb.lo}–${pb.hi} atm`,
      ];
      const rawP = scan.SurfacePressure;
      let tier: EncyclopediaSpawnTier = "yellow";
      let caption = "SurfacePressure missing";
      const pAtm =
        rawP != null && rawP !== undefined && !Number.isNaN(rawP as number)
          ? journalPressureToAtm(rawP as number)
          : null;
      if (pAtm != null && Number.isFinite(pAtm)) {
        if (inRange(pAtm, c.surfacePressure!.min, c.surfacePressure!.max)) {
          tier = "blue";
          caption = `${pAtm.toFixed(3)} atm OK`;
        } else {
          tier = "red";
          caption = `${pAtm.toFixed(3)} atm out of gate`;
        }
      }
      out.push({ id: "surface-pressure", label: "Surface pressure", lines, caption, tier });
    } else if (pb && !scan) {
      out.push({
        id: "surface-pressure",
        label: "Surface pressure",
        lines: [
          pb.lo <= OPEN_LO / 2
            ? `≤ ${pb.hi} atm`
            : pb.hi >= OPEN_HI / 2
              ? `≥ ${pb.lo} atm`
              : `${pb.lo}–${pb.hi} atm`,
        ],
        caption: "No body scan",
        tier: "yellow",
      });
    }
  }

  /* Thin/thick pressure category gate */
  if (!bac && c.atmospherePressureCategory) {
    const cat = c.atmospherePressureCategory;
    const lines = [`Atmosphere pressure class · ${cat} (threshold ${THIN_ATMOSPHERE_MAX_ATM} atm)`];
    const pAtm = ctx?.surfacePressureAtm ?? null;

    let tier: EncyclopediaSpawnTier;
    let caption: string;

    if (pAtm == null || !Number.isFinite(pAtm)) {
      tier = "yellow";
      caption = "Converted SurfacePressure unavailable";
    } else if (cat === "thin") {
      if (pAtm <= THIN_ATMOSPHERE_MAX_ATM) {
        tier = "blue";
        caption = `${pAtm.toFixed(3)} atm is thin`;
      } else {
        tier = "red";
        caption = `${pAtm.toFixed(3)} atm exceeds thin cutoff`;
      }
    } else {
      if (pAtm > THIN_ATMOSPHERE_MAX_ATM) {
        tier = "blue";
        caption = `${pAtm.toFixed(3)} atm is thick`;
      } else {
        tier = "red";
        caption = `${pAtm.toFixed(3)} atm not thick`;
      }
    }
    out.push({ id: "pressure-category", label: "Pressure category", lines, caption, tier });
  }

  /* Parent star substring gate */
  if (c.parentStarTypeIncludesAnyOf?.length) {
    const lines = [`Host star must contain: ${c.parentStarTypeIncludesAnyOf.join(" / ")}`];
    const host = ctx?.parentStarType?.trim() ?? "";

    let tier: EncyclopediaSpawnTier;
    let caption: string;
    if (!host) {
      tier = "yellow";
      caption = "Host StarType unresolved (needs exploration lineage)";
    } else {
      const ok = c.parentStarTypeIncludesAnyOf!.some((f) =>
        host.toLowerCase().includes((f ?? "").trim().toLowerCase()),
      );
      tier = ok ? "blue" : "red";
      caption = ok ? `"${host}" matched` : `"${host}" missing fragment`;
    }
    out.push({ id: "parent-star-type", label: "Host star type", lines, caption, tier });
  }

  /* Orbit distance gate */
  if (c.orbitDistanceFromParentStarLs?.min !== undefined || c.orbitDistanceFromParentStarLs?.max !== undefined) {
    const orb = c.orbitDistanceFromParentStarLs!;
    const lines = [`Orbit (${orb.min ?? "—"} … ${orb.max ?? "—"} LS from host)`];
    const v = ctx?.orbitDistanceFromParentStarLs ?? null;

    let tier: EncyclopediaSpawnTier = "yellow";
    let caption = "Semi-major axis / lineage missing";

    if (v != null && Number.isFinite(v)) {
      if (inRange(v, orb.min, orb.max)) {
        tier = "blue";
        caption = `${Math.round(v)} LS satisfies gate`;
      } else {
        tier = "red";
        caption = `${Math.round(v)} LS out of codex orbit band`;
      }
    }
    out.push({ id: "orbit-distance", label: "Orbit distance", lines, caption, tier });
  }

  /* DSS / FSS geological signal hints */
  if (c.geologicalSignalIncludes?.length) {
    const lines = [`Signals must contain: ${c.geologicalSignalIncludes.join(" / ")}`];
    const hints = ctx?.signalHints ?? [];

    let tier: EncyclopediaSpawnTier;
    let caption: string;

    if (!hints.length) {
      tier = "neutral";
      caption = "Matcher skips gate without merged signal hints";
    } else {
      const okGeo = c.geologicalSignalIncludes!.some((frag) =>
        hints.some((h) => h.includes((frag ?? "").trim().toLowerCase())),
      );
      tier = okGeo ? "blue" : "red";
      caption = okGeo ? "Signals matched gate" : "No matching signal token";
    }
    out.push({ id: "geological-signals", label: "Geological signals", lines, caption, tier });
  }

  /* Supported star types + host spectral fit (merged colour-table + morph) */
  {
    const pack = formatGenusStarColorSoftOneLine(entry, ctx?.parentStarType);
    const nulls = entry.genusStarColorNullSpectralClasses ?? [];
    if (pack.show) {
      const tier: EncyclopediaSpawnTier =
        pack.tone === "green" ? "blue" : pack.tone === "red" ? "red" : "yellow";
      const caption =
        pack.tone === "green"
          ? "Host spectral class matches a genus colour-variant row"
          : pack.tone === "red"
            ? "No colour row for parsed class, or genus null-mapping hit"
            : "Resolve host StarType from exploration lineage";
      const hostLabel =
        pack.tone === "green" ? "Supported" : pack.tone === "red" ? "Not supported" : "Unknown";
      out.push({
        id: "supported-star-types",
        label: "Supported star types",
        lines: [
          `Supported Star Types: ${pack.supportedSpectralList}`,
          `Host Star: Type ${pack.hostSpectralSummary} — ${hostLabel}`,
        ],
        caption,
        tier,
      });
    } else if (nulls.length && ctx?.parentStarType?.trim()) {
      const host = ctx.parentStarType!;
      const specKeys = spectralKeysFromJournalStarType(host);
      let tier: EncyclopediaSpawnTier = "neutral";
      let caption = "Spectral class resolvable";

      if (specKeys.length) {
        const excluded = specKeys.some((k) => nulls.some((n) => n.toUpperCase() === k.toUpperCase()));
        if (excluded) {
          tier = "red";
          caption = `Host class ${specKeys.join("/")} has no genus colour`;
        } else {
          tier = "blue";
          caption = `${specKeys.join("/")} not in null mapping`;
        }
      } else {
        tier = "yellow";
        caption = "Could not parse spectral key from journal star type";
      }

      const lines = [
        `Colour-table excludes: ${nulls.join(", ")}`,
        `Host string: ${host}`,
      ];
      out.push({ id: "supported-star-types", label: "Supported star types", lines, caption, tier });
    }
  }

  /* Terrain / wording notes appended on success (matcher reasons) — informational only */
  if (c.matchContextNotes?.filter((n) => n?.trim()).length) {
    const trimmed = (c.matchContextNotes ?? []).map((n) => n.trim()).filter(Boolean);
    out.push({
      id: "codex-notes",
      label: "Codex terrain notes",
      lines: trimmed,
      caption: "Informational · not gated",
      tier: "neutral",
    });
  }

  return out;
}
