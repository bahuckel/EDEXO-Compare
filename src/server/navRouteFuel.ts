/**
 * Elite Dangerous `NavRoute.json` (next to journal): plotted route waypoints with `StarPos` in ly.
 * Fuel along the route is estimated from the last `FSDJump` sample — game FSD use scales ~∝ jump distance².
 */

import { roleForStarType, type StarRolesConfig } from "./systemMap.js";

export interface NavRouteWaypointDTO {
  systemAddress: number;
  starSystem: string;
  starPos: [number, number, number];
  /** NavRoute `StarClass` (spectral letter, e.g. G, M) — used for scoopable detection. */
  starClass?: string;
}

export function distanceLy3d(a: [number, number, number], b: [number, number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.hypot(dx, dy, dz);
}

function normalizedSystemName(name: string | null | undefined): string | null {
  const t = name?.trim();
  return t ? t.toLowerCase() : null;
}

export function parseNavRouteJson(raw: string): NavRouteWaypointDTO[] | null {
  const t = raw.trim();
  if (!t) return null;
  let o: unknown;
  try {
    o = JSON.parse(t) as unknown;
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const route = (o as Record<string, unknown>).Route;
  if (!Array.isArray(route) || route.length < 2) return null;
  const out: NavRouteWaypointDTO[] = [];
  for (const row of route) {
    if (!row || typeof row !== "object") return null;
    const rec = row as Record<string, unknown>;
    const addr = rec.SystemAddress;
    const nameRaw = rec.StarSystem;
    const pos = rec.StarPos;
    if (typeof addr !== "number" || !Number.isFinite(addr)) return null;
    if (typeof nameRaw !== "string" || !nameRaw.trim()) return null;
    if (!Array.isArray(pos) || pos.length < 3) return null;
    const x = pos[0];
    const y = pos[1];
    const z = pos[2];
    if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
    if (![x, y, z].every((n) => Number.isFinite(n))) return null;
    const starClassRaw = rec.StarClass;
    const starClass =
      typeof starClassRaw === "string" && starClassRaw.trim() ? starClassRaw.trim() : undefined;
    const wp: NavRouteWaypointDTO = {
      systemAddress: addr,
      starSystem: nameRaw.trim(),
      starPos: [x, y, z],
    };
    if (starClass) wp.starClass = starClass;
    out.push(wp);
  }
  return out.length >= 2 ? out : null;
}

export type RouteRefuelAlertDTO = "none" | "yellow" | "red";

export interface NavRouteFuelAnalysis {
  onPlot: boolean;
  routeTotalLy: number;
  routeRemainingLy: number | null;
  routeJumpsRemaining: number | null;
  fuelCanFinishPlottedRoute: boolean | null;
  fuelJumpsReachableOnPlottedRoute: number | null;
  maxRemainingLegLy: number | null;
  anyRemainingLegOverMaxRange: boolean;
  /**
   * Fuel / scoop heuristic: red = refuel now or critical; yellow = refuel next hop or ~2 jumps of fuel left.
   * Only set when `fuelCanFinishPlottedRoute === false` (needs scoop or station somewhere).
   */
  routeRefuelAlert: RouteRefuelAlertDTO;
  /**
   * Jumps until the furthest main-sequence scoopable you can **reach on the current tank** along
   * NavRoute.json (per-leg ly from StarPos, fuel ∝ leg² from last FSDJump, each leg ≤ Loadout max
   * jump when known). Same star-class rules as refuel alerts. When tank or FSD sample is missing,
   * falls back to hop count to the **last** scoop on the remaining plot (still max-jump filtered
   * when range is known). `null` when no scoop ahead or none reachable.
   */
  jumpsToLastScoopableOnRoute: number | null;
}

const FUEL_MARGIN_T = 0.06;
/** Avoid blow-ups when the last jump was a trivial in-system hop. */
const MIN_SAMPLE_DIST_LY = 0.08;
const RANGE_EPS_LY = 1e-3;
const FUEL_SUM_EPS = 1e-6;

/**
 * Highest scoop index k in [idx, lastScoopIdx] reachable from idx without refuelling: each leg
 * must be within max jump range (when known) and cumulative fuel ≤ budget (when estimator given).
 */
function furthestReachableScoopIndex(params: {
  idx: number;
  lastScoopIdx: number;
  scoop: boolean[];
  legLy: number[];
  budget: number | null;
  estFuelForLeg: ((dLy: number) => number) | null;
  maxJumpLy: number | null;
}): number | null {
  const { idx, lastScoopIdx, scoop, legLy, budget, estFuelForLeg, maxJumpLy } = params;
  let best: number | null = null;
  const legOkRange = (d: number) => maxJumpLy == null || !(maxJumpLy > 0) || d <= maxJumpLy + RANGE_EPS_LY;

  for (let k = idx; k <= lastScoopIdx; k++) {
    if (!scoop[k]) continue;
    let fuelSum = 0;
    let ok = true;
    for (let i = idx; i < k; i++) {
      const d = legLy[i]!;
      if (!legOkRange(d)) {
        ok = false;
        break;
      }
      if (budget != null && estFuelForLeg != null) {
        fuelSum += estFuelForLeg(d);
        if (fuelSum > budget + FUEL_SUM_EPS) {
          ok = false;
          break;
        }
      }
    }
    if (ok) best = k;
  }
  return best;
}

/** Next N systems on the route starting at `idx` (for scoopable corridor checks). */
const SCOOP_LOOKAHEAD_SYSTEMS = 10;

function scoopableAtWaypoint(wp: NavRouteWaypointDTO, cfg: StarRolesConfig): boolean {
  return roleForStarType(wp.starClass, cfg) === "fuel";
}

function computeRouteRefuelAlert(params: {
  idx: number;
  scoop: boolean[];
  canFinish: boolean | null;
  jReach: number | null;
  jRem: number;
}): RouteRefuelAlertDTO {
  const { idx, scoop, canFinish, jReach, jRem } = params;
  if (jRem <= 0 || canFinish !== false) return "none";

  const lastIdx = scoop.length - 1;
  const horizonEnd = Math.min(lastIdx, idx + (SCOOP_LOOKAHEAD_SYSTEMS - 1));
  let scoopInHorizon = false;
  for (let j = idx; j <= horizonEnd; j++) {
    if (scoop[j]) {
      scoopInHorizon = true;
      break;
    }
  }

  const scoopOnlyHereInHorizon =
    scoop[idx] &&
    (() => {
      for (let j = idx + 1; j <= horizonEnd; j++) {
        if (scoop[j]) return false;
      }
      return true;
    })();

  /** No KGBFOAM-class stars in the next leg of the route — long “fuel desert”. */
  if (!scoopInHorizon) return "red";

  /** Final jump: station fuel is unknown — warn for scoop or top-up. */
  if (jRem === 1) return "red";

  /** Current star is the only scoopable in the near window — must scoop before leaving. */
  if (scoopOnlyHereInHorizon) return "red";

  const firstScoopAhead = (() => {
    for (let j = idx + 1; j <= lastIdx; j++) {
      if (scoop[j]) return j;
    }
    return null;
  })();

  if (jReach === 2) return "yellow";

  if (firstScoopAhead === idx + 1 && !scoop[idx] && jReach != null && jReach >= 1 && jReach <= 3) {
    return "yellow";
  }

  return "none";
}

export function analyzeNavRouteFuel(opts: {
  route: NavRouteWaypointDTO[] | null;
  currentSystemAddress: number | null;
  /** Fallback when `SystemAddress` from the journal and NavRoute disagree (rare edge cases). */
  currentSystemName?: string | null;
  /** `null` when `Status.json` fuel is unavailable — distance fields still computed. */
  fuelTotalT: number | null;
  lastFsdFuelT: number | null;
  lastFsdDistLy: number | null;
  loadoutMaxJumpLy: number | null;
  starRoles: StarRolesConfig;
}): NavRouteFuelAnalysis | null {
  const {
    route,
    currentSystemAddress,
    currentSystemName,
    fuelTotalT,
    lastFsdFuelT,
    lastFsdDistLy,
    loadoutMaxJumpLy,
    starRoles,
  } = opts;
  if (!route || route.length < 2) return null;

  const legLy: number[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    legLy.push(distanceLy3d(route[i]!.starPos, route[i + 1]!.starPos));
  }
  const routeTotalLy = legLy.reduce((s, d) => s + d, 0);

  let idx =
    currentSystemAddress != null ? route.findIndex((w) => w.systemAddress === currentSystemAddress) : -1;
  if (idx < 0) {
    const nn = normalizedSystemName(currentSystemName ?? null);
    if (nn) {
      idx = route.findIndex((w) => normalizedSystemName(w.starSystem) === nn);
    }
  }
  const onPlot = idx >= 0;

  const scoop = route.map((w) => scoopableAtWaypoint(w, starRoles));

  if (!onPlot) {
    return {
      onPlot: false,
      routeTotalLy,
      routeRemainingLy: null,
      routeJumpsRemaining: null,
      fuelCanFinishPlottedRoute: null,
      fuelJumpsReachableOnPlottedRoute: null,
      maxRemainingLegLy: null,
      anyRemainingLegOverMaxRange: false,
      routeRefuelAlert: "none",
      jumpsToLastScoopableOnRoute: null,
    };
  }

  const remainingLegs = legLy.slice(idx);
  const routeRemainingLy = remainingLegs.length === 0 ? 0 : remainingLegs.reduce((s, d) => s + d, 0);
  const routeJumpsRemaining = Math.max(0, route.length - 1 - idx);
  const maxRemainingLegLy = remainingLegs.length === 0 ? null : Math.max(...remainingLegs);

  let anyRemainingLegOverMaxRange = false;
  if (loadoutMaxJumpLy != null && loadoutMaxJumpLy > 0 && maxRemainingLegLy != null) {
    anyRemainingLegOverMaxRange = maxRemainingLegLy > loadoutMaxJumpLy + 1e-3;
  }

  let fuelCanFinishPlottedRoute: boolean | null = null;
  let fuelJumpsReachableOnPlottedRoute: number | null = null;
  let estFuelForLeg: ((dLy: number) => number) | null = null;
  let fuelBudget: number | null = null;

  if (remainingLegs.length === 0) {
    fuelCanFinishPlottedRoute = true;
    fuelJumpsReachableOnPlottedRoute = 0;
  } else if (
    fuelTotalT != null &&
    Number.isFinite(fuelTotalT) &&
    fuelTotalT >= 0 &&
    lastFsdFuelT != null &&
    lastFsdFuelT > 0 &&
    lastFsdDistLy != null &&
    lastFsdDistLy > 0
  ) {
    const d0 = Math.max(lastFsdDistLy, MIN_SAMPLE_DIST_LY);
    estFuelForLeg = (dLy: number) => lastFsdFuelT * (dLy / d0) * (dLy / d0);

    fuelBudget = Math.max(0, fuelTotalT - FUEL_MARGIN_T);
    let totalNeed = 0;
    for (const d of remainingLegs) {
      totalNeed += estFuelForLeg(d);
    }
    fuelCanFinishPlottedRoute = totalNeed <= fuelBudget + 1e-6;

    let tank = fuelBudget;
    let done = 0;
    for (const d of remainingLegs) {
      const need = estFuelForLeg(d);
      if (tank + 1e-9 < need) break;
      tank -= need;
      done++;
    }
    fuelJumpsReachableOnPlottedRoute = done;
  }

  const routeRefuelAlert = computeRouteRefuelAlert({
    idx,
    scoop,
    canFinish: fuelCanFinishPlottedRoute,
    jReach: fuelJumpsReachableOnPlottedRoute,
    jRem: routeJumpsRemaining,
  });

  let jumpsToLastScoopableOnRoute: number | null = null;
  let lastScoopIdx = -1;
  for (let j = idx; j < route.length; j++) {
    if (scoop[j]) lastScoopIdx = j;
  }
  if (lastScoopIdx >= idx) {
    const furthest = furthestReachableScoopIndex({
      idx,
      lastScoopIdx,
      scoop,
      legLy,
      budget: fuelBudget,
      estFuelForLeg,
      maxJumpLy: loadoutMaxJumpLy,
    });
    if (furthest != null) {
      jumpsToLastScoopableOnRoute = furthest - idx;
    }
  }

  return {
    onPlot: true,
    routeTotalLy,
    routeRemainingLy,
    routeJumpsRemaining,
    fuelCanFinishPlottedRoute,
    fuelJumpsReachableOnPlottedRoute,
    maxRemainingLegLy,
    anyRemainingLegOverMaxRange,
    routeRefuelAlert,
    jumpsToLastScoopableOnRoute,
  };
}
