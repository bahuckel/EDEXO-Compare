import type { EncyclopediaSpeciesRowDTO, SpeciesCriterion, SpeciesEntry } from "@shared/types";
import { atmosphereCompositionKey } from "@shared/scanAtmosphereMatch";
import { fuzzyRankAny } from "./fuzzyMatch";

export const ENC_FILTERS_ALL = "ALL" as const;
export const ENC_NO_PLANET_CLASS = "__NO_PLANET_CLASS__";
export const ENC_VACUUM_ATMO = "__VACUUM__";

export type EncyclopediaFiltersState = {
  genusKey: string;
  planetClass: string;
  atmosphere: string;
  volcanism: typeof ENC_FILTERS_ALL | "REQUIRED";
  starType: string;
  pressureCat: typeof ENC_FILTERS_ALL | "thin" | "thick";
  geoSignal: string;
  search: string;
};

export function defaultEncyclopediaFilters(genusKey: string = ENC_FILTERS_ALL): EncyclopediaFiltersState {
  return {
    genusKey,
    planetClass: ENC_FILTERS_ALL,
    atmosphere: ENC_FILTERS_ALL,
    volcanism: ENC_FILTERS_ALL,
    starType: ENC_FILTERS_ALL,
    pressureCat: ENC_FILTERS_ALL,
    geoSignal: ENC_FILTERS_ALL,
    search: "",
  };
}

function crit(e: SpeciesEntry): SpeciesCriterion {
  return e.criteria;
}

function atmosphereRowAllowsVacuum(c: SpeciesCriterion): boolean {
  const a = c.atmosphereTypeAnyOf;
  if (!a?.length) return false;
  return a.some((x) => !(x ?? "").trim());
}

function atmosphereRowAllowsToken(c: SpeciesCriterion, token: string): boolean {
  const a = c.atmosphereTypeAnyOf;
  if (!a?.length) return true;
  const wantVacuum = !token.trim();
  if (wantVacuum) return atmosphereRowAllowsVacuum(c);
  const wantKey = atmosphereCompositionKey(token);
  return a.some((allowed) => {
    if (!(allowed ?? "").trim()) return false;
    if (allowed === token) return true;
    if ((allowed ?? "").trim().toLowerCase() === token.trim().toLowerCase()) return true;
    return atmosphereCompositionKey(allowed) === wantKey;
  });
}

/** Mirror matcher: host string would include fragment; here we treat pick ↔ fragment symmetrically. */
function starFragmentMatchesSelection(fragRaw: string, selectedRaw: string): boolean {
  const frag = (fragRaw ?? "").trim().toLowerCase();
  const sel = (selectedRaw ?? "").trim().toLowerCase();
  if (!frag || !sel) return false;
  return frag === sel || frag.includes(sel) || sel.includes(frag);
}

function entryMatchesHostStarFilter(entry: SpeciesEntry, selected: string): boolean {
  const want = selected.trim();
  if (!want) return false;
  const c = crit(entry);
  const wantU = want.toUpperCase();

  if (c.parentStarTypeIncludesAnyOf?.length) {
    for (const f of c.parentStarTypeIncludesAnyOf) {
      if (starFragmentMatchesSelection(f ?? "", want)) return true;
    }
  }

  const pref = entry.genusStarColorPreferredSpectralClasses;
  if (pref?.length) {
    for (const k of pref) {
      const ku = (k ?? "").trim().toUpperCase();
      if (!ku) continue;
      if (ku === wantU || wantU.includes(ku) || ku.includes(wantU)) return true;
    }
  }

  return false;
}

/**
 * Every facet except the search box.
 *
 * Search is handled separately by {@link rankEncyclopediaRows}: as a boolean `includes()` it could
 * only ever say yes or no, so "bacacies" found nothing and an exact name sorted no better than a
 * partial one. Ranked, it decides the order of the list instead of just its contents.
 */
export function entryMatchesEncyclopediaFacets(
  entry: SpeciesEntry,
  f: EncyclopediaFiltersState,
): boolean {
  const c = crit(entry);

  if (f.genusKey !== ENC_FILTERS_ALL) {
    const g = entry.genus?.trim() || entry.genusDataDir;
    if (g !== f.genusKey) return false;
  }

  if (f.planetClass !== ENC_FILTERS_ALL) {
    if (f.planetClass === ENC_NO_PLANET_CLASS) {
      if (c.planetClassAnyOf && c.planetClassAnyOf.length > 0) return false;
    } else {
      const pc = c.planetClassAnyOf;
      if (!pc?.length) return false;
      if (!pc.includes(f.planetClass)) return false;
    }
  }

  if (f.atmosphere !== ENC_FILTERS_ALL) {
    if (!c.atmosphereTypeAnyOf?.length) {
      /* no atmosphere constraint — matches any atmosphere filter */
    } else if (f.atmosphere === ENC_VACUUM_ATMO) {
      if (!atmosphereRowAllowsVacuum(c)) return false;
    } else {
      if (!atmosphereRowAllowsToken(c, f.atmosphere)) return false;
    }
  }

  if (f.volcanism === "REQUIRED") {
    const needs =
      c.volcanismActiveRequired === true ||
      !!(c.volcanismIncludes && c.volcanismIncludes.length > 0) ||
      entry.genusDataDir === "brain-tree";
    if (!needs) return false;
  }

  if (f.starType !== ENC_FILTERS_ALL) {
    if (!entryMatchesHostStarFilter(entry, f.starType)) return false;
  }

  if (f.pressureCat !== ENC_FILTERS_ALL) {
    if (c.atmospherePressureCategory !== f.pressureCat) return false;
  }

  if (f.geoSignal !== ENC_FILTERS_ALL) {
    const geos = c.geologicalSignalIncludes;
    if (!geos?.length) return false;
    const want = f.geoSignal.trim().toLowerCase();
    if (!geos.some((g) => (g ?? "").trim().toLowerCase() === want)) return false;
  }

  return true;
}

/** Fields the search box looks at, best (lowest) rank wins. */
export function encyclopediaSearchRank(entry: SpeciesEntry, query: string): number | null {
  return fuzzyRankAny(
    [entry.displayName, entry.genus, entry.genusDataDir, entry.notes],
    query,
  );
}

export function entryMatchesEncyclopediaFilters(
  entry: SpeciesEntry,
  f: EncyclopediaFiltersState,
): boolean {
  if (!entryMatchesEncyclopediaFacets(entry, f)) return false;
  return encyclopediaSearchRank(entry, f.search) != null;
}

export type EncyclopediaFacetOptions = {
  planetClasses: string[];
  atmospheres: { value: string; label: string }[];
  hostStar: { value: string; label: string }[];
  geoSignals: string[];
  /** At least one species row has no `planetClassAnyOf` (atmosphere-only JSON gates). */
  hasNoPlanetClassRows: boolean;
};

export function buildEncyclopediaFacetOptions(rows: EncyclopediaSpeciesRowDTO[]): EncyclopediaFacetOptions {
  const planetSet = new Set<string>();
  const atmoMap = new Map<string, string>();
  let hasVacuumOption = false;
  const starOptMap = new Map<string, string>();
  const geoSet = new Set<string>();
  let hasNoPlanetClassRows = false;

  for (const { entry } of rows) {
    const c = entry.criteria;
    if (!c.planetClassAnyOf?.length) hasNoPlanetClassRows = true;
    for (const p of c.planetClassAnyOf ?? []) {
      if (p?.trim()) planetSet.add(p);
    }
    for (const raw of c.atmosphereTypeAnyOf ?? []) {
      const t = (raw ?? "").trim();
      if (!t) {
        hasVacuumOption = true;
        continue;
      }
      const k = atmosphereCompositionKey(t);
      if (!atmoMap.has(k)) atmoMap.set(k, t);
    }
    if (atmosphereRowAllowsVacuum(c)) hasVacuumOption = true;

    for (const s of c.parentStarTypeIncludesAnyOf ?? []) {
      const t = (s ?? "").trim();
      if (!t) continue;
      if (!starOptMap.has(t)) starOptMap.set(t, t);
    }
    for (const k of entry.genusStarColorPreferredSpectralClasses ?? []) {
      const letter = (k ?? "").trim().toUpperCase();
      if (!letter) continue;
      const label =
        letter === "TTS" ? "T Tauri (TTS) — colour map" : `Spectral ${letter} — colour map`;
      if (!starOptMap.has(letter)) starOptMap.set(letter, label);
    }
    for (const g of c.geologicalSignalIncludes ?? []) {
      if (g?.trim()) geoSet.add(g.trim());
    }
  }

  const atmospheres: { value: string; label: string }[] = [];
  if (hasVacuumOption) {
    atmospheres.push({ value: ENC_VACUUM_ATMO, label: "Vacuum / no atmosphere" });
  }
  const atmoLabels = [...atmoMap.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }))
    .map(([, label]) => ({ value: label, label }));
  atmospheres.push(...atmoLabels);

  const hostStar = [...starOptMap.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

  return {
    planetClasses: [...planetSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    atmospheres,
    hostStar,
    geoSignals: [...geoSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    hasNoPlanetClassRows,
  };
}

export function filterEncyclopediaRows(
  rows: EncyclopediaSpeciesRowDTO[],
  f: EncyclopediaFiltersState,
): EncyclopediaSpeciesRowDTO[] {
  return rows.filter((r) => entryMatchesEncyclopediaFilters(r.entry, f));
}

/**
 * Facet-filtered rows, ordered by search rank when there is a query.
 *
 * `searching` tells the caller which of the two list shapes to draw: grouped by genus while
 * browsing, best-match-first while searching. Mixing the two would put the best hit halfway down
 * the page under whichever genus header it happens to belong to.
 */
export function rankEncyclopediaRows(
  rows: EncyclopediaSpeciesRowDTO[],
  f: EncyclopediaFiltersState,
): { rows: EncyclopediaSpeciesRowDTO[]; searching: boolean } {
  const byFacets = rows.filter((r) => entryMatchesEncyclopediaFacets(r.entry, f));
  const q = f.search.trim();
  if (!q) return { rows: byFacets, searching: false };
  const scored: { row: EncyclopediaSpeciesRowDTO; rank: number }[] = [];
  for (const row of byFacets) {
    const rank = encyclopediaSearchRank(row.entry, q);
    if (rank != null) scored.push({ row, rank });
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.row.entry.displayName.localeCompare(b.row.entry.displayName, undefined, {
        sensitivity: "base",
      }),
  );
  return { rows: scored.map((x) => x.row), searching: true };
}

export type EncyclopediaFilterChip = {
  key: keyof EncyclopediaFiltersState;
  /** What the filter is called, e.g. "Planet class". */
  label: string;
  /** What it is set to, e.g. "Rocky body". */
  value: string;
};

/**
 * One chip per active filter, so the list can say *which* filters are on rather than how many.
 * "3 filters active" tells you that you are being filtered, not what to undo.
 */
export function activeEncyclopediaFilterChips(
  f: EncyclopediaFiltersState,
): EncyclopediaFilterChip[] {
  const out: EncyclopediaFilterChip[] = [];
  if (f.genusKey !== ENC_FILTERS_ALL) out.push({ key: "genusKey", label: "Genus", value: f.genusKey });
  if (f.planetClass !== ENC_FILTERS_ALL) {
    out.push({
      key: "planetClass",
      label: "Planet class",
      value: f.planetClass === ENC_NO_PLANET_CLASS ? "No planet-class list" : f.planetClass,
    });
  }
  if (f.atmosphere !== ENC_FILTERS_ALL) {
    out.push({
      key: "atmosphere",
      label: "Atmosphere",
      value: f.atmosphere === ENC_VACUUM_ATMO ? "Vacuum / none" : f.atmosphere,
    });
  }
  if (f.volcanism !== ENC_FILTERS_ALL) out.push({ key: "volcanism", label: "Volcanism", value: "Required" });
  if (f.starType !== ENC_FILTERS_ALL) out.push({ key: "starType", label: "Host star", value: f.starType });
  if (f.pressureCat !== ENC_FILTERS_ALL) {
    out.push({ key: "pressureCat", label: "Pressure", value: f.pressureCat === "thin" ? "Thin" : "Thick" });
  }
  if (f.geoSignal !== ENC_FILTERS_ALL) out.push({ key: "geoSignal", label: "Geological signal", value: f.geoSignal });
  if (f.search.trim()) out.push({ key: "search", label: "Search", value: f.search.trim() });
  return out;
}

/** Reset one filter to its default without disturbing the others. */
export function clearEncyclopediaFilter(
  f: EncyclopediaFiltersState,
  key: keyof EncyclopediaFiltersState,
): EncyclopediaFiltersState {
  const base = defaultEncyclopediaFilters(ENC_FILTERS_ALL);
  return { ...f, [key]: base[key] };
}

export function countActiveEncyclopediaFilters(f: EncyclopediaFiltersState): number {
  let n = 0;
  if (f.genusKey !== ENC_FILTERS_ALL) n++;
  if (f.planetClass !== ENC_FILTERS_ALL) n++;
  if (f.atmosphere !== ENC_FILTERS_ALL) n++;
  if (f.volcanism !== ENC_FILTERS_ALL) n++;
  if (f.starType !== ENC_FILTERS_ALL) n++;
  if (f.pressureCat !== ENC_FILTERS_ALL) n++;
  if (f.geoSignal !== ENC_FILTERS_ALL) n++;
  if (f.search.trim()) n++;
  return n;
}
