import type { PlanetScan } from "./types.js";

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
  let t = (scan.AtmosphereType ?? "").trim();
  if (!t) return "";
  const lo = t.toLowerCase().replace(/_/g, " ");
  if (lo === "none" || lo.includes("no atmosphere")) return "";
  // Spansh and EDSM write the density into the type — `Hot thin Sulphur dioxide` — where the journal
  // keeps it in `Atmosphere`. Every leading density word goes, `hot` included, in any order.
  t = t.replace(/^(?:(?:hot|thin|thick)\s+)+/i, "").trim();
  return t;
}

/**
 * Normalizes journal / JSON atmosphere labels to a single comparison key
 * (e.g. NitrogenRich, nitrogen-rich, Neon → neon; Nitrogen → nitrogen).
 */
export function atmosphereCompositionKey(token: string): string {
  let t = token
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    /*
      The game spells it both ways — `sulfur dioxide` in a scan's `Atmosphere` text, `SulphurDioxide`
      in its `AtmosphereType` — and anything built from the text inherits the American one. An EDDN
      export writing "Thin Sulfur dioxide" demoted Bacterium cerbrus on 464 bodies it grows on.
    */
    .replace(/sulfur/g, "sulphur");
  if (t.endsWith("rich")) t = t.slice(0, -4);
  return t;
}
