/**
 * localStorage-backed preferences and their keys (7.3).
 */
import { PressDisplay, TempUnit } from "./planetDisplayUtils";

export const EXO_MAP_CR_MIN = 1_000_000;

export const EXO_MAP_CR_MAX = 20_000_000;

export const EXO_MAP_CR_STEP = 50_000;

/** Leave room so ++ can always be at least one step above + within the 20M cap. */
export const EXO_MAP_PLUS_SLIDER_MAX = EXO_MAP_CR_MAX - EXO_MAP_CR_STEP;

export function secondScreenUrl(lanUrl: string): string {
  try {
    const u = new URL(lanUrl);
    u.searchParams.set("screen", "triage");
    return u.toString();
  } catch {
    return lanUrl;
  }
}

export const EDEXO_COMPACT_CANDIDATE_VIEW_LS = "edexo.compactCandidateView";

const EDEXO_TEMP_UNIT_LS = "edexo.bodyTempUnit";

const EDEXO_PRESS_UNIT_LS = "edexo.bodyPressUnit";

export function readTempUnitFromLs(): TempUnit {
  try {
    const v = localStorage.getItem(EDEXO_TEMP_UNIT_LS);
    if (v === "K" || v === "C" || v === "F") return v;
  } catch {
    /* ignore */
  }
  return "K";
}

export function writeTempUnitToLs(u: TempUnit) {
  try {
    localStorage.setItem(EDEXO_TEMP_UNIT_LS, u);
  } catch {
    /* ignore */
  }
}

export function readPressUnitFromLs(): PressDisplay {
  try {
    const v = localStorage.getItem(EDEXO_PRESS_UNIT_LS);
    if (v === "atm" || v === "pa") return v;
  } catch {
    /* ignore */
  }
  return "atm";
}

export function writePressUnitToLs(u: PressDisplay) {
  try {
    localStorage.setItem(EDEXO_PRESS_UNIT_LS, u);
  } catch {
    /* ignore */
  }
}

/** Route / fuel / data-value cards matter while travelling, not while sampling — so they fold. */
export const EDEXO_HEADER_TRAY_LS = "edexo.headerTrayOpen";

export function readLsBool(key: string, defaultVal: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaultVal;
    return v !== "0" && v !== "false";
  } catch {
    return defaultVal;
  }
}

export function writeLsBool(key: string, val: boolean) {
  try {
    localStorage.setItem(key, val ? "1" : "0");
  } catch {
    /* ignore */
  }
}
