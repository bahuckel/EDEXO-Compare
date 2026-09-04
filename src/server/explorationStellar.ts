import type { ExplorationScanRecord } from "../shared/types.js";

/**
 * Asteroid / belt clusters — not suns, planets, or moons; exclude from D-scan body counts and UC-style totals.
 * Matches journal `Scan.BodyType` `AsteroidCluster` and belt wording in `PlanetClass` / name.
 */
export function explorationRecordIsBeltClusterLike(r: ExplorationScanRecord): boolean {
  const bt = (r.bodyType ?? "").replace(/\s+/g, "").toLowerCase();
  if (bt === "asteroidcluster") return true;
  const pc = (r.planetClass ?? "").toLowerCase();
  if (pc.includes("belt cluster") || pc.includes("asteroid cluster")) return true;
  const bn = (r.bodyName ?? "").toLowerCase();
  if (bn.includes("belt cluster") || bn.includes("asteroid cluster")) return true;
  return false;
}

/**
 * Strong signals that a merged `Scan` row is a **world** (planet / moon), not a star.
 * Used before spectral-type heuristics so journal oddities (`StarType` on planets, empty `BodyType`)
 * never hide bodies from the system map.
 */
export function explorationRecordIsClearlyWorld(r: ExplorationScanRecord): boolean {
  if (planetClassIndicatesNonStellarWorld(r.planetClass)) return true;
  const pc = (r.planetClass ?? "").trim();
  if (pc && !planetClassIndicatesStellar(r.planetClass)) return true;
  if (typeof r.massEM === "number" && Number.isFinite(r.massEM) && r.massEM > 0) return true;
  if (r.landable === true) return true;
  if ((r.terraformState ?? "").trim().length > 0) return true;
  if ((r.atmosphereType ?? "").trim().length > 0) return true;
  if ((r.atmosphere ?? "").trim().length > 0) return true;
  if ((r.volcanism ?? "").trim().length > 0) return true;
  if (r.materials != null && typeof r.materials === "object") return true;
  if (r.atmosphereComposition != null && typeof r.atmosphereComposition === "object") return true;
  return false;
}

/** Planet / asteroid `PlanetClass` values — if present, the body is not a star even when `BodyType` is wrong. */
export function planetClassIndicatesNonStellarWorld(planetClass: string | undefined): boolean {
  const n = (planetClass ?? "").trim().toLowerCase();
  if (!n) return false;

  if (
    /gas giant|water world|earthlike|ammonia|high metal content|metal rich|rocky body|icy body|asteroid|belt cluster|planetary nebula|dwarf planet|hellscape|crater|ice world|rocky ice|metal body|silicate|molten/i.test(
      n,
    )
  ) {
    return true;
  }

  if (/sudarsky class [ivx]+/i.test(planetClass ?? "")) return true;

  return false;
}

/**
 * Some companion stars / young stellar objects are journaled with `BodyType: "Planet"` and
 * **`PlanetClass` filled** (e.g. `"T Tauri Star"`) instead of or in addition to `StarType`.
 * Match known stellar `PlanetClass` fragments — keep conservative to avoid gas-giant false positives.
 */
export function planetClassIndicatesStellar(planetClass: string | undefined): boolean {
  const n = (planetClass ?? "").trim().toLowerCase();
  if (!n) return false;

  const markers = [
    "t tauri",
    "ttauri",
    "t-tauri",
    "tauri star",
    "herbig",
    "ae/be star",
    "protostar",
    "proto-star",
    "pre-main",
    "pre main sequence",
    "young stellar object",
    "yso",
    "wolf-rayet",
    "wolf–rayet",
    "carbon star",
    "neutron star",
    "black hole",
    // Giants / supergiants (stellar, not Sudarsky gas giants)
    "supergiant",
    "subgiant",
    "bright giant",
    "red giant",
    "blue giant",
    "giant (m-type", // rare journal phrasing
    "white dwarf",
    "brown dwarf",
    // Generic "… star" where it's clearly a stellar class, not a world
    "hypergiant",
    "luminous blue variable",
    "cepheid",
    "rr lyrae",
  ];

  for (const m of markers) {
    if (n.includes(m)) return true;
  }

  // "Something star" but not planetary wording
  if (/\bstar\b/.test(n)) {
    if (/gas giant|asteroid|icy body|rocky body|metal rich|water world|earthlike|ammonia|belt/i.test(n)) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * `Scan.StarType` for YSO / compact objects / obvious non-main-sequence phrasing.
 * Do not treat plain spectral letters (e.g. `M`) as sufficient — use with body-type / planet-class context.
 */
export function starTypeIndicatesSpecialStellar(starType: string | undefined): boolean {
  const n = (starType ?? "").trim().toLowerCase();
  if (!n) return false;

  const markers = [
    "t tauri",
    "ttauri",
    "t-tauri",
    "herbig",
    "wolf-rayet",
    "wolf–rayet",
    "wolf rayet",
    "carbon star",
    "neutron",
    "black hole",
    "white dwarf",
    "brown dwarf",
    "supergiant",
    "hypergiant",
    "protostar",
    "proto-star",
    "cepheid",
    "luminous blue variable",
    "exploding",
    "ttauri",
  ];

  for (const m of markers) {
    if (n.includes(m)) return true;
  }

  if (/\b(n|d|ms)\s*-?\s*(star|white dwarf)\b/i.test(n)) return true;

  return false;
}

/**
 * Harvard-style spectral prefix often present on companion stars journaled as `BodyType: Planet` with no
 * `PlanetClass` until the full scan merges. Conservative: single letter + optional subtype / luminosity.
 */
function spectralTypeLooksLikeOrdinaryStar(starType: string | undefined): boolean {
  const s = (starType ?? "").trim();
  if (!s) return false;
  const u = s.toUpperCase();
  if (/^(DA|DB|DC|DO|DQ|DX|DZ)\b/.test(u)) return true;
  return /^[OBAFGKMLTY](\d|[IV]+|\s|\/|\(|-|$)/i.test(s);
}

/**
 * Whether an FSS/Scan row describes a **star** (primary or companion).
 *
 * - Normal stars: `StarType` set, no planet `PlanetClass`.
 * - Mis-tagged companions: `BodyType` may be `"Planet"`; use {@link planetClassIndicatesStellar} or
 *   `StellarMass` with no planetary class.
 */
export function explorationRecordIsStellar(r: ExplorationScanRecord): boolean {
  if (r.isBarycentreJournal === true) return false;
  if (explorationRecordIsClearlyWorld(r)) return false;

  const bt = (r.bodyType ?? "").replace(/\s+/g, "").toLowerCase();
  if (bt === "star") return true;

  const pc = (r.planetClass ?? "").trim();
  if (planetClassIndicatesStellar(pc)) return true;

  const st = (r.starType ?? "").trim();

  /**
   * Journal `BodyType: "Planet"` must not become a “star” just because `StarType` is set while
   * `PlanetClass` is still empty (partial / FSS-priority merges). Those are worlds; mis-tagged
   * **stellar** companions use explicit stellar `PlanetClass` (T Tauri, etc.) or special `StarType`.
   */
  if (bt === "planet") {
    if (planetClassIndicatesStellar(pc)) return true;
    if (planetClassIndicatesNonStellarWorld(pc)) return false;
    if (!pc) {
      if (typeof r.stellarMass === "number" && Number.isFinite(r.stellarMass) && r.stellarMass > 0)
        return true;
      if (starTypeIndicatesSpecialStellar(st)) return true;
      if (spectralTypeLooksLikeOrdinaryStar(st)) return true;
      return false;
    }
    if (starTypeIndicatesSpecialStellar(st) && !planetClassIndicatesNonStellarWorld(pc)) return true;
    return false;
  }

  if (starTypeIndicatesSpecialStellar(st) && !planetClassIndicatesNonStellarWorld(pc)) {
    return true;
  }

  /**
   * Plain spectral type (F, G, M, …) with no `PlanetClass` is **not** enough: planet rows sometimes
   * carry `StarType` while `BodyType` is empty or non-`Planet`, and `explorationRecordIsClearlyWorld`
   * already returned false only because the row is still a minimal stub. Prefer `StellarMass` (stars)
   * vs `MassEM` (worlds); otherwise assume **world** so scanned planets never vanish from the map.
   */
  if (st && !pc) {
    if (typeof r.stellarMass === "number" && Number.isFinite(r.stellarMass) && r.stellarMass > 0) return true;
    if (typeof r.massEM === "number" && Number.isFinite(r.massEM) && r.massEM > 0) return false;
    if (bt === "star") return true;
    return false;
  }

  return false;
}
