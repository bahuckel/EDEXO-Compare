import type { CSSProperties } from "react";
import type {
  BodyComputed,
  EstimatedSurfaceTempBand,
  ExomasteryDetailDTO,
  FootCatalogConfirmation,
  MatchReason,
  OrganicGenusLock,
  PlanetScan,
  SpeciesMatch,
  StarRoleDTO,
} from "@shared/types";
import {
  atmospherePillStyle,
  formatPressurePill,
  formatTemperaturePillLine,
  gravityFromScan,
  gravHeatStyle,
  planetClassPillStyle,
  pressHeatStyle,
  tempHeatStyle,
  type TempUnit,
} from "./planetDisplayUtils";
import { journalPressureToAtm } from "@shared/journalPhysics";

export function primaryStarRoleTag(role: StarRoleDTO): string {
  if (role === "fuel") return "Fuel";
  if (role === "neutron_boost") return "Neutron";
  if (role === "wd_boost") return "Boost";
  return "Useless";
}

export function primaryStarRoleTooltip(role: StarRoleDTO): string {
  if (role === "fuel") return "Main-sequence scoopable star — refuel with a fuel scoop.";
  if (role === "neutron_boost") return "Neutron star — strong FSD supercharge through the jet cone.";
  if (role === "wd_boost") return "White dwarf — smaller FSD supercharge; very tight jet cone.";
  return "Not practical for fuel scooping or common FSD supercharge routes.";
}

export function primaryStarChipClass(role: StarRoleDTO): string {
  if (role === "fuel") return "brand-star-chip--fuel";
  if (role === "neutron_boost") return "brand-star-chip--neutron";
  if (role === "wd_boost") return "brand-star-chip--boost";
  return "brand-star-chip--useless";
}

export function formatOrganicLockDisplay(l: OrganicGenusLock): string {
  const g = (l.genusLocalised || l.genusSymbol || "").trim();
  const spRaw = (l.speciesLocalised || "").trim();
  const v = (l.variantLocalised || "").trim();
  const gl = g.toLowerCase();
  const spl = spRaw.toLowerCase();
  const speciesSameAsGenus = g.length > 0 && spl === gl;
  let speciesBody: string;
  if (g && spRaw && !speciesSameAsGenus) {
    if (!spl.startsWith(`${gl} `) && !spl.startsWith(`${gl}-`)) {
      speciesBody = `${g} ${spRaw}`;
    } else {
      speciesBody = spRaw;
    }
  } else if (g && (!spRaw || speciesSameAsGenus)) {
    speciesBody = g;
  } else {
    speciesBody = spRaw || g;
  }
  if (v) {
    let vTrim = v.trim();
    const sbNorm = speciesBody.trim();
    const vl = vTrim.toLowerCase();
    const sbLower = sbNorm.toLowerCase();
    /** Journal sometimes repeats `{species} - {species} - Colour` — strip redundancy before formatting. */
    if (vl === sbLower || vl === `${sbLower} - ${sbLower}`) {
      return speciesBody;
    }
    const withSep = `${sbLower} - `;
    if (vl.startsWith(withSep)) {
      vTrim = vTrim.slice(sbNorm.length + 3).trim();
    } else if (vl.startsWith(`${sbLower} `) && vTrim.length > sbNorm.length) {
      const rest = vTrim.slice(sbNorm.length).trim();
      if (rest.length > 0 && rest.toLowerCase() !== sbLower) vTrim = rest;
    }
    if (!vTrim.length || vTrim.toLowerCase() === sbLower) return speciesBody;
    const low = speciesBody.toLowerCase();
    const vs = vTrim.toLowerCase();
    if (low.endsWith(` - ${vs}`) || low.endsWith(`-${vs}`)) return speciesBody;
    if (speciesBody.includes(" - ")) return speciesBody;
    return `${speciesBody} - ${vTrim}`;
  }
  return speciesBody;
}

export function uniqueOnFootScanLines(locks: OrganicGenusLock[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const l of locks) {
    const key = [
      l.genusSymbol,
      l.genusLocalised,
      l.speciesSymbol,
      l.speciesLocalised,
      l.variantLocalised,
    ].join("\0");
    if (seen.has(key)) continue;
    seen.add(key);
    const line = formatOrganicLockDisplay(l);
    if (line) lines.push(line);
  }
  return lines;
}

export function safeGenusHeadId(groupKey: string): string {
  return (
    groupKey
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "genus"
  );
}

export function titleCaseFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Title-case each word for candidate species label (e.g. `tectonicas` → `Tectonicas`). */
export function titleCaseSpeciesWords(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function speciesCaptionParts(
  genus: string,
  displayName: string,
): { genusShow: string; epithet: string } {
  const g = genus.trim();
  const d = displayName.trim();
  if (!g) return { genusShow: "", epithet: d };
  const m = d.match(new RegExp(`^${escapeRegExp(g)}\\s+(.+)$`, "i"));
  if (m?.[1]?.trim()) return { genusShow: g, epithet: m[1].trim() };
  return { genusShow: g, epithet: d };
}

export function groupedSortedMatches(matches: BodyComputed["matches"]) {
  const map = new Map<string, { title: string; items: BodyComputed["matches"] }>();
  for (const m of matches) {
    const rawGenus = m.entry.genus?.trim();
    const key = (rawGenus || m.entry.genusDataDir).toLowerCase();
    const title = rawGenus || titleCaseFromSlug(m.entry.genusDataDir);
    let g = map.get(key);
    if (!g) {
      g = { title, items: [] };
      map.set(key, g);
    }
    g.items.push(m);
  }
  for (const g of map.values()) {
    g.items.sort((a, b) => {
      // Candidates the feeder profile says look nothing like this body sink to the bottom of their
      // genus. They are still shown — see markExomasteryZeroHabitatMatches.
      const ua = a.exomasteryHabitatUnlikely === true;
      const ub = b.exomasteryHabitatUnlikely === true;
      if (ua !== ub) return ua ? 1 : -1;
      const pa = a.priceCredits;
      const pb = b.priceCredits;
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pb - pa;
    });
  }
  return [...map.entries()]
    .map(([groupKey, g]) => ({ groupKey, title: g.title, items: g.items }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

const REASON_FIELD_LABELS: Record<string, string> = {
  PlanetClass: "Planet Class",
  AtmosphereType: "Atmosphere Type",
  SurfaceGravity: "Surface Gravity",
  SurfaceTemperature: "Temperature",
  SurfacePressure: "Pressure",
  Landable: "Landable",
  Volcanism: "Volcanism",
  Source: "Source",
  "Match mode": "Match mode",
  "Foot scan match": "Foot scan match",
  "DB disagreement": "DB vs foot scan",
};

export function labelForReasonField(field: string): string {
  return REASON_FIELD_LABELS[field] ?? field.replace(/([a-z])([A-Z])/g, "$1 $2");
}

const REASON_FIELD_ORDER: string[] = [
  "PlanetClass",
  "AtmosphereType",
  "SurfaceGravity",
  "SurfaceTemperature",
  "SurfacePressure",
  "Landable",
  "Volcanism",
  "Match mode",
  "Foot scan match",
  "DB disagreement",
  "Source",
];

function sortMatchReasons<T extends { field: string }>(reasons: T[]): T[] {
  const rank = (f: string) => {
    const i = REASON_FIELD_ORDER.indexOf(f);
    return i === -1 ? 1_000 : i;
  };
  return [...reasons].sort((a, b) => rank(a.field) - rank(b.field) || a.field.localeCompare(b.field));
}

const PRIMARY_QUAD_FIELDS = new Set([
  "PlanetClass",
  "AtmosphereType",
  "SurfaceGravity",
  "SurfaceTemperature",
  "SurfacePressure",
]);

const TRIVIAL_SOURCE_JSON_RE = /^data\/species\/[^/]+\/[^/]+\.json$/i;

export function speciesMatchExtraReasons(m: SpeciesMatch): MatchReason[] {
  const base = m.reasons.filter((r) => !PRIMARY_QUAD_FIELDS.has(r.field) && r.field !== "Foot scan match");
  const sorted = sortMatchReasons(base);
  const nonSrc = sorted.filter((r) => r.field !== "Source");
  if (nonSrc.length > 0) return nonSrc;
  const src = sorted.find((r) => r.field === "Source");
  if (src?.detail?.trim() && TRIVIAL_SOURCE_JSON_RE.test(src.detail.trim())) return [];
  return sorted;
}

export type MatchQuadCell = {
  key: string;
  label: string;
  value: string;
  pillStyle: CSSProperties;
  onPillClick?: () => void;
  pillTitle?: string;
  openExomasteryModal?: boolean;
};

export function primaryMatchQuad(
  m: SpeciesMatch,
  scan: PlanetScan | null,
  est: EstimatedSurfaceTempBand | null,
  tempUnit: TempUnit,
): MatchQuadCell[] {
  const d = (field: string) => m.reasons.find((r) => r.field === field)?.detail?.trim();

  const planet = d("PlanetClass") || scan?.PlanetClass?.trim() || "—";
  const atmoRaw = d("AtmosphereType") || scan?.AtmosphereType?.trim() || scan?.Atmosphere?.trim() || "";
  const atmo = !atmoRaw || atmoRaw.toLowerCase() === "none" ? "No Atmosphere" : atmoRaw;

  let grav = d("SurfaceGravity");
  if (!grav && scan) {
    const { label } = gravityFromScan(scan);
    if (label !== "—") grav = label;
  }
  if (!grav) grav = "—";

  const j = scan?.SurfaceTemperature;
  const journalK = j != null && !Number.isNaN(j) ? j : null;
  const tempLine = formatTemperaturePillLine(journalK, est, tempUnit);
  const tempStyleK = journalK ?? est?.midK ?? NaN;

  const { gEarth } = gravityFromScan(scan);
  const gravStyle = Number.isFinite(gEarth)
    ? gravHeatStyle(gEarth)
    : { borderColor: "#6b7280", color: "#d1d5db", background: "rgba(107,114,128,0.15)" };
  const tempStyle = Number.isFinite(tempStyleK)
    ? tempHeatStyle(tempStyleK)
    : { borderColor: "#6b7280", color: "#d1d5db", background: "rgba(107,114,128,0.15)" };

  const rawP = scan?.SurfacePressure;
  const pressAtm = rawP != null && Number.isFinite(rawP) ? journalPressureToAtm(rawP) : null;
  const pressDisp =
    pressAtm != null && Number.isFinite(pressAtm)
      ? `${pressAtm.toFixed(3)} atm`
      : d("SurfacePressure") || "—";
  const pressStyle =
    pressAtm != null && Number.isFinite(pressAtm)
      ? pressHeatStyle(pressAtm)
      : { borderColor: "#6b7280", color: "#d1d5db", background: "rgba(107,114,128,0.15)" };

  return [
    {
      key: "PlanetClass",
      label: "Planet type",
      value: planet,
      pillStyle: planetClassPillStyle(planet === "—" ? "" : planet),
    },
    {
      key: "AtmosphereType",
      label: "Atmosphere type",
      value: atmo,
      pillStyle: atmospherePillStyle(atmoRaw || atmo),
    },
    { key: "SurfaceGravity", label: "Gravity", value: grav, pillStyle: gravStyle },
    {
      key: "SurfaceTemperature",
      label: "Temperature",
      value: tempLine,
      pillStyle: tempStyle,
      pillTitle: "Cycles Kelvin → Celsius → Fahrenheit (display only)",
    },
    {
      key: "SurfacePressure",
      label: "Pressure",
      value: rawP != null && Number.isFinite(rawP) ? formatPressurePill(rawP, "atm") : pressDisp,
      pillStyle: pressStyle,
      pillTitle: "Journal SurfacePressure normalized to atmospheres when value is Pa scale",
    },
  ];
}

export function footCatalogBadgeText(confirmations: FootCatalogConfirmation[] | undefined): string {
  if (!confirmations?.length) return "FOOT CATALOG";
  const hasA = confirmations.includes("analyse");
  const hasS = confirmations.includes("sample");
  if (hasA && hasS) return "FOOT CATALOG — Analyse + Sample";
  if (hasA) return "FOOT CATALOG — Analyse";
  return "FOOT CATALOG — Sample";
}

export const EXO_SIMILARITY_INDEX_HELP =
  "Deck match %: linear from weighted “Other matching details” chips (tier × colour; host lines boosted). Requires exomastery profile in species folder (same as habitat fit). ~100% ≈ strong deck; cross-genus. Tunable: server `DECK_SCORE_FULL_SCALE`.";

export const EXO_HABITAT_FIT_HELP =
  "Habitat fit %: importance-weighted blend vs exomastery profile (feeder `*_exomastery.json`), not genus `*_new.json`. Add that JSON under `data/species/<genus>/` for bars to appear. Journal Scan / ScanOrganic merge with Spansh/EDSM for the scan used in scoring.";

export const EXO_GENUS_RANK_HELP =
  "Same genus on this body: each species' % of the group's combined deck-chip score (feeder alignment). All such rows sum to ~100% — relative feeder fit among siblings, not “confidence” the planet is that species and not codex/spawn truth. Hidden when only one exomastery candidate in the genus.";

export const EXO_CODEX_VS_EXO_PROFILE_HELP =
  "Shown as candidate = `*_new.json` codex gates only. Habitat % & deck % need `*_exomastery.json` (feeder) in the same genus folder.";

export function exomasteryDetailHasContent(d: ExomasteryDetailDTO | null | undefined): boolean {
  if (!d) return false;
  if ((d.stats?.length ?? 0) > 0) return true;
  if ((d.atmosphereClimateStats?.length ?? 0) > 0) return true;
  return (d.compositionGroups ?? []).some((g) => g.rows.length > 0);
}
