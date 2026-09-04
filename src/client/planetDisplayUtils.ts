import type { CSSProperties } from "react";
import type { EstimatedSurfaceTempBand } from "@shared/types";
import {
  journalSurfaceGravityToG,
  journalPressureToAtm,
  JOURNAL_PRESSURE_PA_THRESHOLD,
  ATM_TO_PA,
} from "@shared/journalPhysics";

export const EARTH_TEMP_REF_K = 288;
export { JOURNAL_PRESSURE_PA_THRESHOLD, ATM_TO_PA, journalPressureToAtm };

export type TempUnit = "K" | "C" | "F";
export type PressDisplay = "atm" | "pa";

export function formatTempScalar(k: number, u: TempUnit): string {
  if (u === "K") return `${k.toFixed(0)}°K`;
  if (u === "C") return `${(k - 273.15).toFixed(0)}°C`;
  const c = k - 273.15;
  return `${((c * 9) / 5 + 32).toFixed(0)}°F`;
}

/** One-line temperature pill: band from heuristic + journal snapshot. */
export function formatTemperaturePillLine(
  journalK: number | null | undefined,
  est: EstimatedSurfaceTempBand | null,
  u: TempUnit,
): string {
  const j = journalK != null && Number.isFinite(journalK) ? journalK : null;
  const hasEst = est != null && Number.isFinite(est.minK) && Number.isFinite(est.maxK);
  if (!hasEst && j == null) return "—";
  const rng = (a: number, b: number) => `${formatTempScalar(a, u)} \u00b7 ${formatTempScalar(b, u)}`;
  if (hasEst && j != null) {
    return `${rng(est!.minK, est!.maxK)} J: ${formatTempScalar(j, u)}`;
  }
  if (hasEst) {
    return rng(est!.minK, est!.maxK);
  }
  return `J: ${formatTempScalar(j!, u)}`;
}

export function formatPressurePill(rawJournal: number | null | undefined, display: PressDisplay): string {
  if (rawJournal == null || Number.isNaN(rawJournal)) return "—";
  const atm = journalPressureToAtm(rawJournal);
  if (display === "atm") return `${atm.toFixed(3)} atm`;
  const pa = rawJournal >= JOURNAL_PRESSURE_PA_THRESHOLD ? rawJournal : rawJournal * ATM_TO_PA;
  return `${Math.round(pa).toLocaleString()} Pa`;
}

export function gravHeatStyle(gEarth: number): CSSProperties {
  let r = 100;
  let g = 180;
  let b = 220;
  if (gEarth <= 0) {
    r = 80;
    g = 130;
    b = 220;
  } else if (gEarth < 0.4) {
    r = 90;
    g = 170;
    b = 220;
  } else if (gEarth < 0.85) {
    r = 100;
    g = 200;
    b = 150;
  } else if (gEarth <= 1.15) {
    r = 230;
    g = 210;
    b = 80;
  } else if (gEarth < 2) {
    r = 230;
    g = 140;
    b = 60;
  } else {
    r = 220;
    g = 80;
    b = 70;
  }
  return {
    borderColor: `rgb(${r},${g},${b})`,
    color: `rgb(${Math.min(255, r + 35)},${Math.min(255, g + 25)},${Math.min(255, b + 15)})`,
    background: `rgba(${r},${g},${b},0.14)`,
  };
}

export function tempHeatStyle(k: number): CSSProperties {
  const d = k - EARTH_TEMP_REF_K;
  let r = 120;
  let gc = 200;
  let b = 130;
  if (d < -80) {
    r = 90;
    gc = 150;
    b = 230;
  } else if (d < -30) {
    r = 110;
    gc = 180;
    b = 210;
  } else if (Math.abs(d) <= 25) {
    r = 120;
    gc = 200;
    b = 130;
  } else if (d < 120) {
    r = 230;
    gc = 200;
    b = 100;
  } else {
    r = 230;
    gc = 100;
    b = 90;
  }
  return {
    borderColor: `rgb(${r},${gc},${b})`,
    color: `rgb(${Math.min(255, r + 25)},${Math.min(255, gc + 20)},${Math.min(255, b + 10)})`,
    background: `rgba(${r},${gc},${b},0.14)`,
  };
}

/** Atmosphere pressure (atm): low → high coloring like {@link tempHeatStyle} (thin/cool = blue, ~1 atm = earth band, dense = warm/red). */
export function pressHeatStyle(atm: number): CSSProperties {
  const lr = Math.log10(Math.max(atm, 1e-9));
  const d = lr; /* log10(1 atm) === 0 */
  let r = 120;
  let gc = 200;
  let b = 130;
  if (d < -3) {
    r = 90;
    gc = 150;
    b = 230;
  } else if (d < -1.2) {
    r = 110;
    gc = 180;
    b = 210;
  } else if (d < -0.35) {
    r = 110;
    gc = 195;
    b = 175;
  } else if (d <= 0.35) {
    r = 120;
    gc = 200;
    b = 130;
  } else if (d < 1.2) {
    r = 230;
    gc = 200;
    b = 100;
  } else {
    r = 230;
    gc = 100;
    b = 90;
  }
  return {
    borderColor: `rgb(${r},${gc},${b})`,
    color: `rgb(${Math.min(255, r + 25)},${Math.min(255, gc + 20)},${Math.min(255, b + 10)})`,
    background: `rgba(${r},${gc},${b},0.14)`,
  };
}

/** Map node palette: must stay aligned with `systemMapNodeAppearance` in SystemMapModal. */
export function planetClassToMapBaseLabel(planetClass: string): string {
  const pc = planetClass.trim();
  if (!pc) return "";
  if (pc === "High metal content body") return "HMC";
  if (pc === "Earthlike body") return "ELW";
  if (pc === "Water world") return "WW";
  if (pc === "Ammonia world") return "AW";
  if (pc === "Metal rich body") return "MR";
  if (pc === "Rocky body") return "R";
  if (pc === "Rocky ice body") return "RI";
  if (pc === "Icy body") return "I";
  if (/Sudarsky class I gas giant/i.test(pc)) return "GG1";
  if (/Sudarsky class II gas giant/i.test(pc)) return "GG2";
  if (/Sudarsky class III gas giant/i.test(pc)) return "GG3";
  if (/Sudarsky class IV gas giant/i.test(pc)) return "GG4";
  if (/Sudarsky class V gas giant/i.test(pc)) return "GG5";
  if (/gas giant/i.test(pc)) return "GG";
  return pc
    .replace(/\s+body$/i, "")
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase())
    .join("")
    .slice(0, 5);
}

export function planetClassPillStyle(planetClass: string): CSSProperties {
  const bl = planetClassToMapBaseLabel(planetClass);
  if (bl === "ELW") return { borderColor: "#4ade80", color: "#86efac", background: "rgba(52,211,153,0.15)" };
  if (bl === "WW") return { borderColor: "#60a5fa", color: "#93c5fd", background: "rgba(37,99,235,0.18)" };
  if (bl === "AW") return { borderColor: "#facc15", color: "#fde047", background: "rgba(234,179,8,0.2)" };
  if (bl === "I" || bl === "RI")
    return { borderColor: "#22d3ee", color: "#a5f3fc", background: "rgba(34,211,238,0.16)" };
  if (bl === "R" || bl === "HMC" || bl === "MR")
    return { borderColor: "#ff7a24", color: "#ff9a4d", background: "rgba(255,122,36,0.12)" };
  if (bl === "GG" || /^GG[1-5]$/.test(bl))
    return { borderColor: "#c4a574", color: "#e8d5b8", background: "rgba(196,165,116,0.22)" };
  return { borderColor: "#fb923c", color: "#fdba74", background: "rgba(251,146,60,0.12)" };
}

const ATMOSPHERE_PALETTE: { test: (s: string) => boolean; rgb: string }[] = [
  { test: (s) => /\bargon/i.test(s), rgb: "186, 104, 200" },
  { test: (s) => /\bammonia/i.test(s), rgb: "129, 212, 250" },
  { test: (s) => /\bwater|water\s*vapou?r/i.test(s), rgb: "100, 181, 246" },
  { test: (s) => /\bchlorine/i.test(s), rgb: "124, 252, 0" },
  { test: (s) => /\bmethane/i.test(s), rgb: "158, 158, 158" },
  { test: (s) => /\bnitrogen/i.test(s), rgb: "165, 214, 255" },
  { test: (s) => /\boxygen/i.test(s), rgb: "129, 212, 193" },
  { test: (s) => /\bhelium/i.test(s), rgb: "255, 235, 150" },
  { test: (s) => /\bneon/i.test(s), rgb: "255, 120, 200" },
  { test: (s) => /\bcarbon\s*dioxide|co2/i.test(s), rgb: "158, 158, 158" },
  { test: (s) => /\bsulfur/i.test(s), rgb: "255, 213, 79" },
  { test: (s) => /\bhydrogen/i.test(s), rgb: "240, 230, 255" },
];

export function atmospherePillStyle(atmosphereRaw: string): CSSProperties {
  const s = atmosphereRaw.trim();
  if (!s || /^no\s atmosphere/i.test(s) || s.toLowerCase() === "none") {
    return { borderColor: "#6b7280", color: "#d1d5db", background: "rgba(107,114,128,0.2)" };
  }
  const low = s.toLowerCase();
  let chosen = ATMOSPHERE_PALETTE[0]!;
  for (const p of ATMOSPHERE_PALETTE) {
    if (p.test(low)) {
      chosen = p;
      break;
    }
  }
  const [r, g, b] = chosen.rgb.split(", ").map(Number) as [number, number, number];
  const h = (s.length * 17) % 40;
  const r2 = Math.min(255, r + h);
  const g2 = Math.min(255, g + (h >> 1));
  const b2 = Math.min(255, b);
  return {
    borderColor: `rgb(${r2},${g2},${b2})`,
    color: `rgb(${Math.min(255, r2 + 40)},${Math.min(255, g2 + 35)},${Math.min(255, b2 + 30)})`,
    background: `rgba(${r2},${g2},${b2},0.14)`,
  };
}

/** CSS color for neon dotted ring on system map (atmosphere). */
export function atmosphereRingColor(atmosphereRaw: string | undefined | null): string | null {
  const s = (atmosphereRaw ?? "").trim();
  if (!s || /^no\s atmosphere/i.test(s) || s.toLowerCase() === "none") return null;
  const st = atmospherePillStyle(s);
  const bc = st.borderColor;
  return typeof bc === "string" ? bc : null;
}

export const pillLabelStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: "0.78rem",
  color: "#c4c0ba",
};

export function gravityFromScan(scan: { SurfaceGravity?: number | null } | null): {
  gEarth: number;
  label: string;
} {
  const sg = scan?.SurfaceGravity;
  if (sg == null || Number.isNaN(sg)) return { gEarth: NaN, label: "—" };
  const gEarth = journalSurfaceGravityToG(sg);
  return { gEarth, label: `${gEarth.toFixed(3)} g ≈ ${sg.toFixed(2)} m/s²` };
}
