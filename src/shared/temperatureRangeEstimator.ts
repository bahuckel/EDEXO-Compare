// Elite Dangerous planet surface temperature band (heuristic; journal snapshot + body context).
// Adapted from user-provided estimator; matching uses tMin / tMax vs species bands.

export type BodyClass =
  | "icy"
  | "rocky_cold"
  | "rocky_standard"
  | "rocky_thin_atmo"
  | "high_metal_hot";

export interface PlanetInput {
  surfaceTemperature?: number; // journal snapshot (K)
  semiMajorAxisAU?: number;
  tidalLock: boolean;
  volcanism: boolean;
  atmosphere: "none" | "thin" | "thick";
  bodyClass: BodyClass;
  irradiationFactor?: number; // optional override (0–2)
}

export interface TemperatureRange {
  tMin: number;
  tMid: number;
  tMax: number;
}

function getBodyBias(bodyClass: BodyClass): number {
  switch (bodyClass) {
    case "icy":
      return 150;
    case "rocky_cold":
      return 200;
    case "rocky_standard":
      return 240;
    case "rocky_thin_atmo":
      return 280;
    case "high_metal_hot":
      return 750;
  }
}

function irradiationFactorFromDistance(au?: number): number {
  if (!au || au <= 0) return 1;
  return Math.min(2.5, 1 / Math.sqrt(au));
}

export function estimateTemperatureRange(input: PlanetInput): TemperatureRange {
  const I = input.irradiationFactor ?? irradiationFactorFromDistance(input.semiMajorAxisAU);

  const V = input.volcanism ? 1 : 0;
  const L = input.tidalLock ? 1 : 0;

  const baseBias = getBodyBias(input.bodyClass);

  let tMid = baseBias;

  if (input.surfaceTemperature !== undefined && input.surfaceTemperature !== null) {
    tMid = 0.65 * input.surfaceTemperature + 0.35 * baseBias;
  }

  const spreadFactor = 0.25 + 0.15 * I + 0.05 * V + 0.2 * L;
  const deltaT = tMid * spreadFactor;

  let tMin = tMid - 0.55 * deltaT;
  let tMax = tMid + 0.45 * deltaT;

  if (tMid > 500) {
    tMax = tMid + 0.35 * deltaT;
    tMin = tMid - 0.45 * deltaT;
  }

  if (input.atmosphere === "none") {
    tMin *= 0.98;
    tMax *= 1.02;
  }

  return {
    tMin: Math.round(tMin),
    tMid: Math.round(tMid),
    tMax: Math.round(tMax),
  };
}
