/**
 * Proximity ladders for MK-style comparisons (Harvard spectral temperature sequence,
 * Yerkes luminosity, integer subclass).
 */

/** Hot → cool (Main sequence + brown dwarfs); exotics anchored for finite distances. */
const HARVARD_ORDER = [
  "O",
  "W",
  "B",
  "A",
  "F",
  "G",
  "K",
  "M",
  "TTS",
  "L",
  "T",
  "Y",
  "N",
  "D",
  "H",
] as const;

const HARVARD_INDEX = new Map<string, number>();
for (let i = 0; i < HARVARD_ORDER.length; i++) {
  HARVARD_INDEX.set(HARVARD_ORDER[i]!, i);
}

/** Yerkes-style luminosity: 0 brightest → VII white dwarf. */
const YERKES_ORDER = ["0", "I", "II", "III", "IV", "V", "VI", "VII"] as const;
const YERKES_INDEX = new Map<string, number>();
for (let i = 0; i < YERKES_ORDER.length; i++) {
  YERKES_INDEX.set(YERKES_ORDER[i]!, i);
}

function upperLetterToken(s: string): string | null {
  const t = s.trim().toUpperCase();
  if (!t) return null;
  if (t.startsWith("TTS") || /^T\s*TAURI/i.test(s)) return "TTS";
  if (t.startsWith("NEUTRON") || t === "N") return "N";
  const m = /^([OBAFGKMLTNWDWY])/.exec(t);
  return m?.[1] ?? null;
}

/** Map journal / feeder spectral token to coarse Harvard ladder slot. */
export function harvardSpectralSlot(letterOrLabel: string | null | undefined): string | null {
  if (letterOrLabel == null) return null;
  const raw = letterOrLabel.trim();
  if (!raw) return null;
  const u = raw.toUpperCase();
  if (u.includes("BLACK") && u.includes("HOLE")) return "H";
  if (/\bBLACK\s*HOLE\b/i.test(raw)) return "H";
  if (/\bNEUTRON\b/i.test(raw)) return "N";
  if (/\bWHITE\s+DWARF\b/i.test(raw) || /^D[A-Z]?(\s|$)/i.test(raw)) return "D";
  if (/WOLF[-\s]*RAYET/i.test(raw) || u.startsWith("W")) return "W";
  if (u.startsWith("TTS") || /\bT\s+TAURI\b/i.test(raw)) return "TTS";
  return upperLetterToken(raw);
}

/**
 * Integer Manhattan distance along Harvard ladder; unknown → high penalty (caller caps).
 */
export function harvardSpectralStepDistance(slotA: string | null, slotB: string | null): number | null {
  if (!slotA || !slotB) return null;
  const ia = HARVARD_INDEX.get(slotA);
  const ib = HARVARD_INDEX.get(slotB);
  if (ia == null || ib == null) return null;
  return Math.abs(ia - ib);
}

export function normalizeYerkesLuminosity(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let s = raw.trim().toUpperCase().replace(/\s+/g, "");
  /** Elite appends redundant trailing `a` on Yerkes class (e.g. `Va` ≡ `V`); `Ia`/`Ib` still coarse-map to `I` below. */
  if (s.length >= 2 && s.endsWith("A")) {
    const sansA = s.slice(0, -1);
    if (YERKES_INDEX.has(sansA)) s = sansA;
  }
  if (s === "IA+" || /^I[AB][+]?$/i.test(s)) return "I";
  if (s.startsWith("II")) {
    if (s.startsWith("III")) return "III";
    return "II";
  }
  if (s.startsWith("III")) return "III";
  if (/^IV/.test(s)) return "IV";
  if (/^VII/.test(s)) return "VII";
  if (/^VI/.test(s)) return "VI";
  if (/^V[^I]/.test(s) || s === "V") return "V";
  if (s === "0" || s === "0.0") return "0";
  const rom = /^([IVX]+|[0])/i.exec(s);
  return rom?.[1]?.toUpperCase() ?? null;
}

export function yerkesLuminosityStepDistance(a: string | null, b: string | null): number | null {
  const ca = a ? normalizeYerkesLuminosity(a) : null;
  const cb = b ? normalizeYerkesLuminosity(b) : null;
  if (!ca || !cb) return null;
  const ia = YERKES_INDEX.get(ca);
  const ib = YERKES_INDEX.get(cb);
  if (ia == null || ib == null) return null;
  return Math.abs(ia - ib);
}

export function stellarSubclassStepDistance(a: number | null, b: number | null): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const ai = Math.min(9, Math.max(0, Math.round(a)));
  const bi = Math.min(9, Math.max(0, Math.round(b)));
  return Math.abs(ai - bi);
}

/** UI tier: compare step distance capped at 4 (red). */
export function proximityTierFromSteps(steps: number | null): number | null {
  if (steps == null || !Number.isFinite(steps)) return null;
  return Math.min(4, Math.max(0, Math.floor(steps)));
}

/** Parse loose MK-ish labels: "G2V", "F (IV)", "M5", "Ae". */
export function parseLooseSpectralMk(
  raw: string | null | undefined,
): { spectralSlot: string | null; subclass: number | null; luminosity: string | null } {
  if (!raw?.trim())
    return { spectralSlot: null, subclass: null, luminosity: null };
  const s = raw.trim();
  const slot = harvardSpectralSlot(s);
  let subclass: number | null = null;
  const dm = /\b([OBAFGKMLTNWDWY])\s*[a-z]{0,2}\s*(\d)\b/i.exec(s);
  if (dm && dm[2]) subclass = Number(dm[2]);

  /** Roman luminosity trailing or in parens — pick last plausible */
  let lum: string | null = null;
  const paren = /\(\s*([IVXL0]{1,4}[AB]?)\s*\)/i.exec(s);
  if (paren) lum = normalizeYerkesLuminosity(paren[1]);
  if (!lum) {
    const trail = /\b([IVX]{1,4}|VI{1,3})a?\s*$/i.exec(s.replace(/\([^)]*\)/g, ""));
    if (trail) lum = normalizeYerkesLuminosity(trail[1]);
  }
  return { spectralSlot: slot, subclass, luminosity: lum };
}

export function isFeederHostStarSpectralPath(path: string): boolean {
  const low = path.toLowerCase();
  return /(\bhost\b.*\bstar\b(.*(spectral|class|letter))?)|(\bexo\.host\b)|(primary[_.\s]*stell)|(host_star)/i.test(
    low,
  );
}

export function isFeederHostStarSubclassPath(path: string): boolean {
  const low = path.toLowerCase();
  return (
    /\bhost\b.*\bsub\s*class\b/i.test(low) ||
    /\bexo\..*sub\s*class\b/i.test(low) ||
    /host_star.*sub\s*class/i.test(low)
  );
}

export function isFeederHostStarLuminosityPath(path: string): boolean {
  const low = path.toLowerCase();
  return (
    /\bhost\b.*\bluminosit/i.test(low) || /\bexo\..*luminosit/i.test(low) || /host_star.*luminosit/i.test(low)
  );
}

export function classifyHostMkPath(path: string): "spectral" | "subclass" | "luminosity" | null {
  if (isFeederHostStarSubclassPath(path)) return "subclass";
  if (isFeederHostStarLuminosityPath(path)) return "luminosity";
  if (isFeederHostStarSpectralPath(path)) return "spectral";
  return null;
}

/** Step distance along the chosen MK ladder (`null` = unknown). */
export function computeMkAxisStepDistance(
  axis: "spectral" | "subclass" | "luminosity",
  typicalDisplay: string,
  currentDisplay: string,
): number | null {
  const t = typicalDisplay.trim();
  const c = currentDisplay.trim();
  if (!t || !c) return null;
  switch (axis) {
    case "spectral": {
      const a = harvardSpectralSlot(t) ?? parseLooseSpectralMk(t).spectralSlot;
      const b = harvardSpectralSlot(c) ?? parseLooseSpectralMk(c).spectralSlot;
      return harvardSpectralStepDistance(a, b);
    }
    case "subclass": {
      const a = Number.parseInt(t.replace(/[^\d-]/g, ""), 10);
      const b = Number.parseInt(c.replace(/[^\d-]/g, ""), 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      return stellarSubclassStepDistance(a, b);
    }
    case "luminosity":
      return yerkesLuminosityStepDistance(t, c);
    default:
      return null;
  }
}
