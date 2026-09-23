import type {
  EstimatedSurfaceTempBand,
  PlanetScan,
  SpeciesCriterion,
  SpeciesEntry,
  SpeciesMatchContext,
} from "./types.js";
import {
  journalPressureToAtm,
  journalSurfaceGravityToG,
  LIGHT_SECOND_METERS,
  THIN_ATMOSPHERE_MAX_ATM,
} from "./journalPhysics.js";
import { normalizeScanAtmosphereForMatch, atmosphereCompositionKey } from "./scanAtmosphereMatch.js";
import { spectralKeysFromJournalStarType } from "./starSpectralKeys.js";
import { isBacteriumSpeciesEntry } from "./speciesBacterium.js";
import { formatGenusStarColorSoftOneLine } from "./genusStarColorSoft.js";
import { volcanismJournalMatchesFragments, expandVolcanismCriterionFragments } from "./volcanismMatch.js";
import {
  describePresenceBranches,
  evaluatePresenceBranch,
  describeBodyForPresence,
} from "./presenceBranches.js";
import {
  REQUIRED_GAS_MIN_SHARE_PCT,
  describeGasBand,
  gasBandVerdict,
  requiredAtmosphereShare,
} from "./atmosphereGasShare.js";
import { keysForRequirement } from "./systemBodyGates.js";

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

function planetTemperatureBandFromSnapshot(
  est: EstimatedSurfaceTempBand | null,
): PlanetTemperatureBand | null {
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
  return !!c.atmosphereTypeAnyOf?.length;
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
        : ["Matcher rejects non-bacterium rows missing planetClassAnyOf — malformed JSON."];

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
    const lines = [
      `Allowed: ${c.atmosphereTypeAnyOf.map((a) => (!a?.trim() ? "(no atmosphere)" : a)).join(", ")}`,
    ];
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

  /*
    Presence branches — the species is here only if one of them holds.

    Placed straight after atmosphere because it is an exclusion, not a preference: when it fails the
    matcher does not demote the row, it removes the species from the body entirely. It is drawn for
    bacterium too, unlike the atmosphere and pressure cards above, because "clutter" is a judgement
    about a preference and this is the rule that decides the answer.
  */
  if (c.presenceAnyOf?.length) {
    const lines = [`Needs one of: ${describePresenceBranches(c.presenceAnyOf)}`];
    let tier: EncyclopediaSpawnTier = "yellow";
    let caption = "No body scan";
    if (scan) {
      let passed: string | null = null;
      for (const branch of c.presenceAnyOf) {
        passed = evaluatePresenceBranch(branch, scan, planetBand);
        if (passed) break;
      }
      tier = passed ? "blue" : "red";
      caption = passed ?? `Not satisfied — ${describeBodyForPresence(scan)}`;
    }
    out.push({ id: "presence", label: "Presence", lines, caption, tier });
  }

  /*
    How much of the air has to be one gas — the axis `AtmosphereType` cannot express.

    Without this card Fonticulua campestris and upupam render identically ("Allowed: Argon") while
    the model separates them on 51.97-100 % against 0.36-49.68 %. Drawn for bacterium as well, for
    the same reason: Bacterium acies keys on 85-100 % neon and its card was otherwise "Any".
  */
  if (c.atmosphereGasSharePct?.length) {
    const lines = c.atmosphereGasSharePct.map(
      (band) => `${describeGasBand(band)} of the atmosphere, by composition`,
    );
    let tier: EncyclopediaSpawnTier = "yellow";
    let caption = "No body scan";
    if (scan) {
      const verdicts = c.atmosphereGasSharePct.map((band) => ({ band, v: gasBandVerdict(scan, band) }));
      if (verdicts.every((x) => x.v.pct === null)) {
        tier = "yellow";
        caption = "No AtmosphereComposition on this scan";
      } else {
        const bad = verdicts.find((x) => !x.v.ok);
        tier = bad ? "red" : "blue";
        const shown = bad ?? verdicts[0]!;
        caption = `${shown.band.gas} ${(shown.v.pct ?? 0).toFixed(2)} %`;
      }
    }
    out.push({ id: "gas-share", label: "Gas share", lines, caption, tier });
  }

  /*
    A gas the genus cannot live without, measured against how much of it is actually there.

    `atmosphereTypeAnyOf` above lists what the codex mentions and is soft, because the corpus may
    know better. This one is the genus saying "no sulphur dioxide, no Recepta", and a trace is not a
    habitat — hence the floor.
  */
  if (c.atmosphereTypeRequiredAnyOf?.length) {
    const required = c.atmosphereTypeRequiredAnyOf;
    const lines = [
      `Needs ${required.join(" / ")} — at least ${REQUIRED_GAS_MIN_SHARE_PCT} % of the atmosphere.`,
    ];
    let tier: EncyclopediaSpawnTier = "yellow";
    let caption = "No body scan";
    if (scan) {
      const share = requiredAtmosphereShare(scan, normalizeScanAtmosphereForMatch(scan), required);
      if (share.kind === "ok") {
        tier = "blue";
        caption = share.pct === null ? `${share.gas} atmosphere` : `${share.gas} ${share.pct.toFixed(2)} %`;
      } else if (share.kind === "trace") {
        tier = "red";
        caption = `${share.gas} only ${(share.pct ?? 0).toFixed(2)} % — a trace`;
      } else {
        tier = "red";
        caption = "Not in the composition";
      }
    }
    out.push({ id: "required-gas", label: "Required gas", lines, caption, tier });
  }

  /*
    Bodies that must exist elsewhere in the system.

    Stated, never judged here: this builder is given one scan and the gate needs the whole system's
    bodies, so a verdict would be a guess. Amphora plant and the Brain Trees are the rows that carry
    it, and until now the encyclopedia said nothing about it at all.
  */
  if (c.systemBodyClassesAnyOf?.length) {
    const wanted = c.systemBodyClassesAnyOf;
    out.push({
      id: "system-bodies",
      label: "Elsewhere in the system",
      lines: [
        `The system must also hold: ${wanted.join(" / ")}`,
        keysForRequirement(wanted[0] ?? "").length > 1 ? "Matched loosely — related body classes count." : "",
      ].filter(Boolean),
      caption: "Checked against the whole system, not this body",
      tier: "neutral",
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
    if (explicitVolcano && !volcanoFragments)
      lines.push("volcanismActiveRequired — volcanism field must exist.");
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

  /* Measured volcanism facts — both demote only, so yellow is the worst they draw. */
  if (c.softNoVolcanism || c.offListAtmosphereNeedsVolcanism || c.volcanicOnlyAtmospheres?.length) {
    const volcanic = scan ? journalReportsAnyVolcanism(scan) : null;
    const lines = [
      ...(c.softNoVolcanism ? ["Usually on bodies with no volcanism"] : []),
      ...(c.offListAtmosphereNeedsVolcanism ? ["Off its listed atmospheres: volcanic bodies only"] : []),
      ...(c.volcanicOnlyAtmospheres?.length ? [`Also ${c.volcanicOnlyAtmospheres.join(" / ")}, volcanic bodies only`] : []),
    ];
    let tier: EncyclopediaSpawnTier = "neutral";
    let caption = "No scan";
    if (scan) {
      if (scan.Volcanism === undefined || scan.Volcanism === null) {
        tier = "yellow";
        caption = "Volcanism unknown";
      } else if (c.softNoVolcanism && volcanic) {
        tier = "yellow";
        caption = `${volcanoCaption(scan.Volcanism)} — rarely recorded here; listed as unlikely`;
      } else {
        tier = "blue";
        caption = volcanic ? volcanoCaption(scan.Volcanism) : "No volcanism";
      }
    }
    out.push({ id: "soft-volcanism", label: "Volcanism, as recorded", lines, caption, tier });
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
      if (surf != null && Number.isFinite(surf)) caption = `${caption} · journal ${surf.toFixed(1)} K`;
    }

    out.push({ id: "surface-temperature", label: "Surface temperature", lines, caption, tier });
  }

  /*
    Codex-linked temperature when the atmosphere subset matches — skipped for bacterium clutter.

    Both halves are drawn. Concha renibus reads 180-195 K *for carbon dioxide only*, and the card
    said "cap ≤ 195 K" — half a rule, which reads as "anything colder is fine" when the floor is the
    part that excludes. The verdict below still tests the cap, because the cap is what the matcher
    gates on; the floor is stated so the reader sees the band the data actually carries.
  */
  if (!bac && c.whenAtmosphereLinkedMaxTempK !== undefined) {
    const cap = c.whenAtmosphereLinkedMaxTempK;
    const floor = c.whenAtmosphereLinkedMinTempK;
    const lines = [
      floor !== undefined
        ? `Atmosphere-linked band ${floor}–${cap} K`
        : `Atmosphere-linked band cap ≤ ${cap} K`,
    ];
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

    out.push({
      id: "linked-temp-cap",
      label: floor !== undefined ? "Atmosphere-linked temperature band" : "Atmosphere-linked temperature cap",
      lines,
      caption,
      tier,
    });
  }

  /*
    The measured band inside the codex one (`soft_temperature_K`). Yellow, never red, outside it:
    the matcher demotes there rather than excluding, and the card must not claim more than it does.
  */
  if (c.softTemperatureK && (c.softTemperatureK.min !== undefined || c.softTemperatureK.max !== undefined)) {
    const { min, max } = c.softTemperatureK;
    const band = min !== undefined && max !== undefined ? `${min}–${max} K` : min !== undefined ? `≥ ${min} K` : `≤ ${max} K`;
    const t = scan?.SurfaceTemperature;
    let tier: EncyclopediaSpawnTier = "neutral";
    let caption = "No scan";
    if (scan && (t == null || Number.isNaN(t))) {
      tier = "yellow";
      caption = "SurfaceTemperature missing";
    } else if (scan && t != null) {
      const outside = (min !== undefined && t < min) || (max !== undefined && t > max);
      tier = outside ? "yellow" : "blue";
      caption = outside ? `${t.toFixed(1)} K — rarely recorded here; listed as unlikely` : `${t.toFixed(1)} K inside`;
    }
    out.push({ id: "soft-temp", label: "Where it is usually found", lines: [`Usually ${band}`], caption, tier });
  }

  /* The measured orbit ceiling (`soft_max_semi_major_axis_ls`). Yellow outside, like the band above. */
  if (c.softMaxSemiMajorAxisLs !== undefined) {
    const max = c.softMaxSemiMajorAxisLs;
    const sma = scan?.SemiMajorAxis;
    let tier: EncyclopediaSpawnTier = "neutral";
    let caption = "No scan";
    if (scan && (sma == null || !Number.isFinite(sma))) {
      tier = "yellow";
      caption = "SemiMajorAxis missing";
    } else if (scan && sma != null) {
      const ls = sma / LIGHT_SECOND_METERS;
      const shown = ls >= 100 ? Math.round(ls).toLocaleString() : ls.toFixed(1);
      tier = ls > max ? "yellow" : "blue";
      caption = ls > max ? `${shown} ls — rarely recorded this wide; listed as unlikely` : `${shown} ls inside`;
    }
    out.push({ id: "soft-orbit", label: "Orbit round its parent", lines: [`Usually ≤ ${max} ls (close moons)`], caption, tier });
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
  if (
    c.orbitDistanceFromParentStarLs?.min !== undefined ||
    c.orbitDistanceFromParentStarLs?.max !== undefined
  ) {
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

      const lines = [`Colour-table excludes: ${nulls.join(", ")}`, `Host string: ${host}`];
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
