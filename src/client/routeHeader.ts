/**
 * The route header's models and aria strings, pure functions (7.3).
 */
import { Tooltip } from "./ui/Tooltip";
import type { AppSnapshot } from "@shared/types";

/** Tooltip for header route row — NavRoute.json, Status.json, journal FSD. */
export function routeNavCardTitle(snap: AppSnapshot): string {
  const parts: string[] = [];
  const fr = snap.liveShipFuelRange;
  const nav = fr?.navRoute;

  if (nav) {
    if (nav.onPlot && nav.routeRemainingLy != null) {
      parts.push(
        `${nav.routeJumpsRemaining ?? 0} jump(s) left · ${nav.routeRemainingLy.toFixed(2)} ly remaining of ${nav.routeTotalLy.toFixed(2)} ly total (NavRoute.json).`,
      );
    } else {
      parts.push(
        `Plotted route ${nav.routeTotalLy.toFixed(2)} ly total (sum of 3D StarPos steps in live Elite Dangerous NavRoute.json).`,
      );
    }
    if (nav.onPlot) {
      if (nav.anyRemainingLegOverMaxRange && fr?.maxJumpRangeLy != null) {
        parts.push(
          `At least one upcoming leg is farther than your merged Loadout max jump range (${fr.maxJumpRangeLy.toFixed(1)} ly) — FSD boosting or a longer path may be required.`,
        );
      }
      if (fr?.hasLiveStatusFuel) {
        if (nav.fuelCanFinishPlottedRoute === true) {
          parts.push(
            `Fuel: estimated sufficient to finish the route (Status.json tank vs per-leg use ~∝ jump distance², calibrated from your last FSDJump FuelUsed and JumpDist).`,
          );
        } else if (nav.fuelCanFinishPlottedRoute === false && nav.fuelJumpsReachableOnPlottedRoute != null) {
          parts.push(
            `Fuel: may run short — about ${nav.fuelJumpsReachableOnPlottedRoute} of ${nav.routeJumpsRemaining ?? "?"} upcoming jump(s) before the tank is dry (same model; refuel to refresh).`,
          );
        } else if (nav.fuelCanFinishPlottedRoute === null) {
          parts.push(
            `Fuel: merge a recent FSDJump (FuelUsed + JumpDist) in the journal to estimate tonnage per leg.`,
          );
        }
      }
      if (nav.routeRefuelAlert === "red") {
        parts.push(
          `Refuel warning (pulsing red): treat as urgent — e.g. no main-sequence scoopable (KGBFOAM-style O–M) star in the next 10 NavRoute systems, only scoop in the near window is here, and/or final plotted hop (station fuel not guaranteed). Uses the same star-class rules as the system map (data/system-map/star-roles.json).`,
        );
      } else if (nav.routeRefuelAlert === "yellow") {
        parts.push(
          `Refuel caution (pulsing yellow): narrow margin — about two hyperspace jumps before the tank is empty on the estimate, and/or plan to scoop at the next waypoint on the plot.`,
        );
      }
    } else {
      parts.push(
        `Your commander is not at a system in this NavRoute list — distances are for the file only.`,
      );
    }
  }

  if (snap.remainingJumpsInRoute != null) {
    parts.push(`Journal FSDTarget: ${snap.remainingJumpsInRoute} jump(s) remaining in route (game tally).`);
  }

  if (fr?.hasLiveStatusFuel) {
    parts.push(
      `Live tank: ${fr.fuelMainT.toFixed(2)} t main + ${fr.fuelReserveT.toFixed(2)} t reserve (${fr.fuelTotalT.toFixed(2)} t, Status.json).`,
    );
  }

  if (fr && !nav?.onPlot && fr.estJumpsRemaining != null && fr.calibration === "fsd_sample") {
    parts.push(
      `Without NavRoute context: ~${fr.estJumpsRemaining} max-range jump(s) (linear scale from last jump to Loadout max range — less accurate than route legs).`,
    );
  }

  if (nav?.onPlot && nav.routeJumpsRemaining != null && nav.routeJumpsRemaining > 0) {
    if (nav.jumpsToLastScoopableOnRoute != null) {
      parts.push(
        `Furthest main-sequence scoop reachable on current tank (NavRoute leg distances, FSDJump fuel × (leg/sample)², max jump per leg): ${nav.jumpsToLastScoopableOnRoute} jump(s) ahead.`,
      );
    } else {
      parts.push(
        `No fuel-scoopable star ahead on the remaining plot is reachable on the current tank and max-jump limits (NavRoute + Status + last FSDJump), or NavRoute StarClass rules it out.`,
      );
    }
  }

  return parts.join(" ");
}

export type RouteHeaderMetricMode = "distance" | "refuel";

export function routeHeaderToggleTitleHint(mode: RouteHeaderMetricMode): string {
  return mode === "distance"
    ? "Click: show jumps to furthest scoop reachable on current fuel (bar = that fraction of remaining hops)."
    : "Click: show light-years left and tank reach (blue = jumps you can finish on current fuel).";
}

/** Remaining plotted jumps vs fuel-reachable jumps — bar is blue for reachable fraction, red for the rest. */
function routeJumpFuelBarModel(snap: AppSnapshot): {
  showBar: boolean;
  bluePct: number;
  redPct: number;
  indeterminate: boolean;
} {
  const fr = snap.liveShipFuelRange;
  const nav = fr?.navRoute;
  if (!nav?.onPlot || nav.routeJumpsRemaining == null || nav.routeJumpsRemaining <= 0) {
    return { showBar: false, bluePct: 100, redPct: 0, indeterminate: false };
  }
  const jRem = nav.routeJumpsRemaining;
  /** Need live tank + FSD calibration for red segment. */
  const canShapeBar =
    fr?.hasLiveStatusFuel === true &&
    nav.fuelCanFinishPlottedRoute !== null &&
    nav.fuelJumpsReachableOnPlottedRoute != null;
  if (!canShapeBar) {
    return { showBar: true, bluePct: 100, redPct: 0, indeterminate: true };
  }
  const jFuel = Math.max(0, nav.fuelJumpsReachableOnPlottedRoute ?? 0);
  if (nav.fuelCanFinishPlottedRoute === true || jFuel >= jRem) {
    return { showBar: true, bluePct: 100, redPct: 0, indeterminate: false };
  }
  const bluePct = Math.max(0, Math.min(100, (jFuel / jRem) * 100));
  return {
    showBar: true,
    bluePct,
    redPct: 100 - bluePct,
    indeterminate: false,
  };
}

/** Refuel view: blue = hops until last scoopable on plot; red = hops after that (no scoop until destination). */
function routeLastScoopBarModel(snap: AppSnapshot): {
  showBar: boolean;
  bluePct: number;
  redPct: number;
  indeterminate: boolean;
} {
  const nav = snap.liveShipFuelRange?.navRoute;
  if (!nav?.onPlot || nav.routeJumpsRemaining == null || nav.routeJumpsRemaining <= 0) {
    return { showBar: false, bluePct: 100, redPct: 0, indeterminate: false };
  }
  const jRem = nav.routeJumpsRemaining;
  const jLast = nav.jumpsToLastScoopableOnRoute;
  if (jLast == null) {
    return { showBar: true, bluePct: 0, redPct: 100, indeterminate: false };
  }
  const bluePct = Math.max(0, Math.min(100, (jLast / jRem) * 100));
  return {
    showBar: true,
    bluePct,
    redPct: 100 - bluePct,
    indeterminate: false,
  };
}

export function routeHeaderBarModel(
  snap: AppSnapshot,
  mode: RouteHeaderMetricMode,
): {
  showBar: boolean;
  bluePct: number;
  redPct: number;
  indeterminate: boolean;
} {
  return mode === "distance" ? routeJumpFuelBarModel(snap) : routeLastScoopBarModel(snap);
}

function routeJumpFuelBarAria(snap: AppSnapshot, model: ReturnType<typeof routeJumpFuelBarModel>): string {
  const nav = snap.liveShipFuelRange?.navRoute;
  if (!model.showBar || !nav?.onPlot || nav.routeJumpsRemaining == null) {
    return "Route summary";
  }
  const jRem = nav.routeJumpsRemaining;
  if (model.indeterminate) {
    return `Plotted route: ${jRem} jumps ahead — tank estimate needs Status.json fuel and a recent FSDJump in the journal.`;
  }
  const jF = nav.fuelJumpsReachableOnPlottedRoute ?? 0;
  if (model.redPct <= 0.5) {
    return `Tank covers all ${jRem} remaining jumps on this plot (estimated).`;
  }
  return `About ${Math.round(jF)} of ${jRem} jumps ahead on current tank (estimated); the rest exceeds plotted fuel (hover bar for details).`;
}

function routeLastScoopBarAria(snap: AppSnapshot, model: ReturnType<typeof routeLastScoopBarModel>): string {
  const nav = snap.liveShipFuelRange?.navRoute;
  if (!model.showBar || !nav?.onPlot || nav.routeJumpsRemaining == null) {
    return "Route — refuel window on plot";
  }
  const jRem = nav.routeJumpsRemaining;
  const jLast = nav.jumpsToLastScoopableOnRoute;
  if (jLast == null) {
    return `No main-sequence scoop ahead is reachable on current fuel and max jump (NavRoute legs) — ${jRem} jump(s) to destination. Bar is all caution (red).`;
  }
  if (model.redPct <= 0.5) {
    return `Furthest reachable scoop on this tank is at the route destination — ${jRem} jump(s).`;
  }
  return `Furthest scoop reachable on current fuel in ${jLast} jump(s); ${jRem} total ahead — red is hops after that star with no scoop.`;
}

export function routeHeaderBarAria(
  snap: AppSnapshot,
  mode: RouteHeaderMetricMode,
  model: ReturnType<typeof routeHeaderBarModel>,
): string {
  if (mode === "distance") return routeJumpFuelBarAria(snap, model);
  return routeLastScoopBarAria(snap, model);
}

const EDEXO_ROUTE_HEADER_METRIC_LS = "edexo.routeHeaderMetricMode";

export function readRouteHeaderMetricMode(): RouteHeaderMetricMode {
  try {
    const v = localStorage.getItem(EDEXO_ROUTE_HEADER_METRIC_LS);
    if (v === "refuel" || v === "distance") return v;
  } catch {
    /* ignore */
  }
  return "distance";
}

export function writeRouteHeaderMetricMode(m: RouteHeaderMetricMode) {
  try {
    localStorage.setItem(EDEXO_ROUTE_HEADER_METRIC_LS, m);
  } catch {
    /* ignore */
  }
}
