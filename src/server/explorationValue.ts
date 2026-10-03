/**
 * Exploration (FSS / DSS) credit estimates from journal scan fields.
 *
 * Ported from EDMC Pioneer `src/pioneer/body_planet_calc.py` / body value helpers (GPL-2.0+),
 * which credit MattG’s exploration formulae thread:
 * https://forums.frontier.co.uk/threads/exploration-value-formulae.232000/
 *
 * Results are approximate — game version / Odyssey tweaks can shift payouts.
 */

import { DSS_PROBE_EFFICIENCY_MULT } from "./explorationPayoutHeuristic.js";

export function starClassK(starType: string | undefined): number {
  const s = (starType ?? "").trim();
  if (!s) return 1200;
  const first = s.charAt(0).toUpperCase();
  if (first === "N" || first === "H") return 22628;
  if (first === "D") return 14057;
  return 1200;
}

export function planetClassK(
  planetClass: string | undefined,
  terraformable: boolean,
): { k: number; kt: number; tm: number } {
  const pc = planetClass ?? "";
  /*
    Class III, IV and V gas giants take the plain 300 (owner's system map values, 2026-10-03: 13
    class III and one class IV, every one at k = 300 to 0.1 %). The 1,264 / 1,167 / 1,659 Pioneer
    carried are from before the 3.3 values and read them four times too high.
  */
  let base = 300;
  let terraform = 0;
  let mult = 1.0;

  if (pc === "Metal rich body") {
    base = 21790;
  } else if (pc === "Ammonia world") {
    base = 96932;
  } else if (pc === "Sudarsky class I gas giant") {
    base = 1656;
  } else if (pc === "Sudarsky class II gas giant" || pc === "High metal content body") {
    base = 9654;
    if (terraformable) {
      terraform = 100677;
      mult = 0.9;
    }
  } else if (pc === "Water world") {
    base = 64831;
    if (terraformable) {
      terraform = 116295;
      mult = 0.75;
    }
  } else if (pc === "Earthlike body") {
    base = 64831;
    terraform = 116295;
    mult = terraformable ? 0.0 : 1.0;
  } else {
    base = 300;
    if (terraformable) {
      terraform = 93328;
      mult = 0.9;
    }
  }

  return { k: base, kt: terraform, tm: mult };
}

export function starScanValueCredits(
  stellarMass: number,
  starType: string | undefined,
  firstDiscoverer: boolean,
): {
  value: number;
  honkThird: number;
} {
  const k = starClassK(starType);
  let value = k + (stellarMass * k) / 66.25;
  let honkThird = value / 3;
  if (firstDiscoverer) {
    value *= 2.6;
    honkThird *= 2.6;
  }
  return { value: Math.round(value), honkThird: Math.round(honkThird) };
}

export function bodyScanValueCredits(
  planetClass: string | undefined,
  terraformable: boolean,
  massEM: number,
  firstDiscoverer: boolean,
  firstMapper: boolean,
  /**
   * The Odyssey bonus on a mapped body: +30 %, at least 555. Measured on the owner's map values
   * (2026-10-03): 37 of 37 bodies he mapped first are exactly x1.3 over the 3.3 formula, and the small
   * ones carry the 555. On by default; only a test passes false.
   */
  odysseyBonus = true,
  /** Journal `SAAScanComplete`: ProbesUsed <= EfficiencyTarget (community ~1.25× on mapped tail). */
  dssProbeEfficient = false,
): {
  fss: number;
  dssMapped: number;
  honkThird: number;
  fssMinRange: number;
  dssMinRange: number;
} {
  const { k, kt, tm } = planetClassK(planetClass, terraformable);
  const q = 0.56591828;
  const kFinal = k + kt;
  const kFinalMin = k + kt * tm;

  let mappingMultiplier: number;
  if (firstDiscoverer && firstMapper) mappingMultiplier = 3.699622554;
  else if (firstMapper) mappingMultiplier = 8.0956;
  else mappingMultiplier = 10 / 3;

  let value = kFinal + kFinal * q * massEM ** 0.2;
  let minValue = kFinalMin + kFinalMin * q * massEM ** 0.2;
  let mappedValue = value * mappingMultiplier;
  let minMappedValue = minValue * mappingMultiplier;
  let honkValue = value / 3;

  if (odysseyBonus) {
    const bump = (v: number) => v + (v * 0.3 > 555 ? v * 0.3 : 555);
    mappedValue = bump(mappedValue);
    minMappedValue = bump(minMappedValue);
  }

  const floor500 = (v: number) => (v > 500 ? v : 500);
  value = floor500(value);
  minValue = floor500(minValue);
  mappedValue = floor500(mappedValue);
  minMappedValue = floor500(minMappedValue);
  honkValue = floor500(honkValue);

  if (firstDiscoverer) {
    value *= 2.6;
    minValue *= 2.6;
    mappedValue *= 2.6;
    minMappedValue *= 2.6;
    honkValue *= 2.6;
  }

  if (dssProbeEfficient) {
    mappedValue *= DSS_PROBE_EFFICIENCY_MULT;
    minMappedValue *= DSS_PROBE_EFFICIENCY_MULT;
  }

  return {
    fss: Math.round(value),
    dssMapped: Math.round(mappedValue),
    honkThird: Math.round(honkValue),
    fssMinRange: Math.round(minValue),
    dssMinRange: Math.round(minMappedValue),
  };
}

/** Reference FSS (not first discoverer) at 1 Earth mass for “above typical” marker. */
export function referenceFssAt1EarthMass(planetClass: string | undefined, terraformable: boolean): number {
  return bodyScanValueCredits(planetClass, terraformable, 1, false, false, true, false).fss;
}

/** One body of a system, as the honk reads it. */
export type HonkBody =
  | { kind: "star"; stellarMass: number; starType: string | undefined }
  | { kind: "planet"; planetClass: string | undefined; terraformable: boolean; massEM: number };

/**
 * The honk, which the game's system map shows on the arrival star and pays with the system (owner's
 * map values, 2026-10-03): a third of every other body's scan value — a planet's at least 500, a
 * star's not floored — times 2.6 when the **system** is a first discovery (its arrival star), whatever
 * each body's own flag says: in a known system with undiscovered icy moons every moon's share was the
 * bare 500. On his systems with every body's value known, arrival star = its own value + this, to the
 * credit. About a quarter of what a system sells for, and the app had left it out.
 */
export function systemHonkCredits(others: readonly HonkBody[], systemFirstDiscovered: boolean): number {
  let sum = 0;
  for (const b of others) {
    sum +=
      b.kind === "star"
        ? starScanValueCredits(b.stellarMass, b.starType, false).honkThird
        : bodyScanValueCredits(b.planetClass, b.terraformable, b.massEM, false, false).honkThird;
  }
  return Math.round(sum * (systemFirstDiscovered ? 2.6 : 1));
}
