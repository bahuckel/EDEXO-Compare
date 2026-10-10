import type { PlanetScan } from "./types.js";
import { isNoAtmosphereText, stripAtmosphereDensity } from "./atmosphereText.js";
import { foldSpelling } from "./spelling.js";

/**
 * Codex prose like “Any thin atmosphere” or genus notes “Thin atmosphere (required for all species)”.
 * When true for all entries in `atmosphereTypeAnyOf`, composition is unrestricted and the thin gate
 * comes only from `atmospherePressureCategory` on the species criterion + journal pressure / “Thin …” type.
 */
export function isCodexAnyThinAtmospherePhrase(s: string): boolean {
  const lo = s.trim().toLowerCase();
  if (!lo) return false;
  const hasThin = /\bthin\b/.test(lo);
  const hasAtmo = /\batmosphere\b/.test(lo);
  if (!hasThin || !hasAtmo) return false;
  if (/\bany\b/.test(lo)) return true;
  /** Genus-wide boilerplate in *_new.json meta */
  if (/\brequired\b/.test(lo) || /\ball\b/.test(lo) || /\bfor all\b/.test(lo)) return true;
  return false;
}

/** True when every allowed atmosphere token is an “any thin composition” phrase (incl. mangled `Anythinatmosphere`). */
export function atmosphereAllowlistMeansAnyThinCompositionOnly(allowed: string[] | undefined): boolean {
  if (!allowed?.length) return false;
  return allowed.every((a) => {
    const raw = (a ?? "").trim();
    if (!raw) return false;
    if (isCodexAnyThinAtmospherePhrase(raw)) return true;
    const compact = raw.replace(/\s+/g, "").toLowerCase();
    return compact === "anythinatmosphere";
  });
}

/**
 * Canonical atmosphere token for species matching: `""` means vacuum / no meaningful atmosphere
 * (journal often omits the field or uses “No atmosphere” / no_atmosphere-style tokens).
 * Strips a leading Thin/Thick prefix so composition matches codex gas tokens (e.g. SulphurDioxide).
 */
export function normalizeScanAtmosphereForMatch(scan: PlanetScan): string {
  const t = (scan.AtmosphereType ?? "").trim();
  if (!t || isNoAtmosphereText(t)) return "";
  // Spansh and EDSM write the density into the type — `Hot thin Sulphur dioxide` — where the journal
  // keeps it in `Atmosphere`. Every leading density word goes, `hot` included, in any order.
  return stripAtmosphereDensity(t);
}

/**
 * Normalizes journal / JSON atmosphere labels to a single comparison key
 * (e.g. NitrogenRich, nitrogen-rich, Neon → neon; Nitrogen → nitrogen).
 */
/**
 * The atmosphere's type as one key, whichever source spelled it: "CarbonDioxide" (journal) and "Thin Carbon
 * dioxide" (EDSM / Spansh) both give "carbondioxide"; "-rich" stays apart ("neonrich"), unlike
 * {@link atmosphereCompositionKey}, because the measured tables tell neon from neon-rich (code review
 * 2026-10-10, B4/B5: the letters-only key missed every looked-up or sibling-hydrated body).
 */
export function atmosphereTypeKeyOf(scan: PlanetScan): string {
  return normalizeScanAtmosphereForMatch(scan).toLowerCase().replace(/[^a-z]/g, "");
}

export function atmosphereCompositionKey(token: string): string {
  /*
    The game spells it both ways — `sulfur dioxide` in a scan's `Atmosphere` text, `SulphurDioxide`
    in its `AtmosphereType` — and anything built from the text inherits the American one. An EDDN
    export writing "Thin Sulfur dioxide" demoted Bacterium cerbrus on 464 bodies it grows on.
  */
  let t = foldSpelling(token)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (t.endsWith("rich")) t = t.slice(0, -4);
  return t;
}
