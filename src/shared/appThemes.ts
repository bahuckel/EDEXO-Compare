/**
 * Colour schemes for the app (guild tester report, 2026-09-30: "some pre-built colour schemes to
 * quickly select from, and save your own"). A scheme is the accent: everything the app draws in
 * orange follows it (tokens.css `--accent-rgb`, `--accent-bright`, `--accent-deep`). What carries a
 * meaning keeps its colour whatever the scheme — green for the live sampling run, blue for done,
 * red and yellow for warnings, the rarity tiers, the ×5 badge, the record gold.
 */

export interface AppThemeColours {
  /** "r, g, b" */
  rgb: string;
  bright: string;
  deep: string;
}

export interface AppThemePreset extends AppThemeColours {
  key: string;
  label: string;
}

export const APP_THEME_PRESETS: readonly AppThemePreset[] = [
  { key: "orange", label: "Elite orange", rgb: "255, 138, 31", bright: "#ffb060", deep: "#f2760f" },
  { key: "amber", label: "Amber", rgb: "255, 184, 28", bright: "#ffd47a", deep: "#e09a00" },
  { key: "red", label: "Red", rgb: "255, 84, 64", bright: "#ff9a8a", deep: "#d93a26" },
  { key: "magenta", label: "Magenta", rgb: "236, 72, 190", bright: "#f59ad9", deep: "#c02a98" },
  { key: "violet", label: "Violet", rgb: "160, 110, 255", bright: "#c7a8ff", deep: "#7c4ddb" },
  { key: "blue", label: "Blue", rgb: "72, 150, 255", bright: "#9cc6ff", deep: "#2f73d6" },
  { key: "green", label: "Green", rgb: "88, 214, 120", bright: "#a4ecb6", deep: "#34a856" },
  { key: "silver", label: "Silver", rgb: "205, 212, 224", bright: "#f1f4f9", deep: "#9aa3b2" },
];

export const DEFAULT_APP_THEME = APP_THEME_PRESETS[0]!;

/** What is stored: a preset, or a custom colour (saved under a name or not). */
export type AppThemeChoice = { preset: string } | { custom: string; name?: string };

export interface SavedAppTheme {
  name: string;
  /** #rrggbb */
  hex: string;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** A custom accent: the bright tint is 45 % towards white, the deep shade 18 % towards black. */
export function coloursFromHex(hex: string): AppThemeColours | null {
  const c = hexToRgb(hex);
  if (!c) return null;
  return {
    rgb: c.join(", "),
    bright: toHex(c.map((v) => v + (255 - v) * 0.45)),
    deep: toHex(c.map((v) => v * 0.82)),
  };
}

/*
  The orange that is not the accent (owner, 2026-09-30: "everything still has an orange hue even when
  the colour was changed"). The text is peach and the panels are warm browns, tinted towards the
  default accent. A scheme keeps their lightness and saturation and turns their hue by as much as its
  accent turned from the orange, and a pale accent (Silver) takes the tint down with it. The page black and the ink stay as they are.
*/
const WARM_NEUTRALS: readonly [string, string][] = [
  ["--panel", "#0e0b0a"],
  ["--surface", "#120e0c"],
  ["--surface-1", "#0e0b0a"],
  ["--surface-2", "#120e0c"],
  ["--surface-3", "#0b0908"],
  ["--text", "#ffe6cf"],
  ["--hud-text", "#ffe6cf"],
  ["--muted", "#8f8378"],
  ["--text-dim", "#d9cabb"],
  ["--text-faint", "#ab9f94"],
  ["--panel-warm", "#0d0907"],
  ["--panel-warm-2", "#120d0a"],
  ["--surface-warm-deep", "#0b0806"],
  ["--menu-warm", "#0e0905"],
  ["--target-warm", "#1a1207"],
  ["--top-warm", "#0c0a08"],
  ["--tint-0a0908", "#0a0908"],
  ["--tint-0c0a09", "#0c0a09"],
  ["--tint-fff4e0", "#fff4e0"],
  ["--tint-ff9447", "#ff9447"],
  ["--tint-ff9a4d", "#ff9a4d"],
  ["--tint-ffab40", "#ffab40"],
  ["--tint-ffb070", "#ffb070"],
  ["--tint-ffb347", "#ffb347"],
];

/** The same for tokens kept as "r, g, b" triplets (used as rgba(var(--x), alpha)). */
const WARM_TRIPLETS: readonly [string, [number, number, number]][] = [
  ["--shade-rgb", [48, 24, 8]],
  ["--shade-hover-rgb", [28, 16, 8]],
  ["--shade-glass-rgb", [20, 14, 10]],
  ["--shade-veil-rgb", [6, 4, 3]],
  ["--shade-warm-rgb", [40, 20, 10]],
  ["--shade-fade-rgb", [13, 9, 7]],
  ["--shade-top-rgb", [12, 7, 4]],
  ["--shade-brand-rgb", [10, 6, 4]],
  ["--shade-next-rgb", [40, 26, 10]],
  ["--peach-rgb", [255, 230, 207]],
  ["--glint-rgb", [255, 180, 100]],
  ["--shade-mid-rgb", [16, 9, 5]],
  ["--tint-14-11-10", [14, 11, 10]],
  ["--tint-12-10-9", [12, 10, 9]],
  ["--tint-20-18-14", [20, 18, 14]],
  ["--tint-14-12-10", [14, 12, 10]],
  ["--tint-20-18-16", [20, 18, 16]],
  ["--shade-row-rgb", [40, 18, 3]],
  ["--shade-row-2-rgb", [22, 12, 5]],
  ["--tint-255-186-112", [255, 186, 112]],
  ["--tint-255-100-40", [255, 100, 40]],
  ["--tint-255-106-26", [255, 106, 26]],
  ["--tint-255-120-30", [255, 120, 30]],
  ["--tint-255-120-60", [255, 120, 60]],
  ["--tint-255-130-60", [255, 130, 60]],
  ["--tint-255-140-70", [255, 140, 70]],
  ["--tint-255-154-77", [255, 154, 77]],
  ["--tint-255-158-41", [255, 158, 41]],
  ["--tint-255-160-60", [255, 160, 60]],
  ["--tint-255-160-80", [255, 160, 80]],
  ["--tint-255-170-80", [255, 170, 80]],
  ["--tint-255-171-64", [255, 171, 64]],
  ["--tint-255-176-96", [255, 176, 96]],
];

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** The page's warm neutrals in a scheme's hue: custom property → value. Empty for the default. */
export function themeNeutrals(rgb: string): Record<string, string> {
  const triplet = (x: string) => x.split(",").map((v) => Number(v.trim()) || 0) as [number, number, number];
  const [h, s] = rgbToHsl(triplet(rgb));
  const [h0, s0] = rgbToHsl(triplet(DEFAULT_APP_THEME.rgb));
  // Turned by as much as the accent turned from the orange, so their small differences stay.
  const turn = (nh: number) => (((nh + h - h0) % 360) + 360) % 360;
  const scale = Math.min(1, s / Math.max(s0, 1e-6));
  const out: Record<string, string> = {};
  for (const [name, hex] of WARM_NEUTRALS) {
    const [nh, ns, nl] = rgbToHsl(hexToRgb(hex)!);
    out[name] = toHex(hslToRgb([turn(nh), ns * scale, nl]));
  }
  for (const [name, c] of WARM_TRIPLETS) {
    const [nh, ns, nl] = rgbToHsl(c);
    out[name] = hslToRgb([turn(nh), ns * scale, nl]).map(Math.round).join(", ");
  }
  const [sh, ss, sl] = rgbToHsl([12, 9, 8]);
  out["--surface-scrim"] = `rgba(${hslToRgb([turn(sh), ss * scale, sl]).map(Math.round).join(", ")}, 0.98)`;
  return out;
}

export function rgbToHex(rgb: string): string {
  return toHex(rgb.split(",").map((v) => Number(v.trim()) || 0));
}

/** The colours a stored choice stands for; anything unreadable is the default. */
export function resolveAppTheme(choice: AppThemeChoice | null | undefined): AppThemeColours & { key: string } {
  if (choice && "custom" in choice) {
    const c = coloursFromHex(choice.custom);
    if (c) return { ...c, key: "custom" };
  }
  if (choice && "preset" in choice) {
    const p = APP_THEME_PRESETS.find((x) => x.key === choice.preset);
    if (p) return p;
  }
  return DEFAULT_APP_THEME;
}

export function isAppThemeChoice(v: unknown): v is AppThemeChoice {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.preset === "string" || (typeof o.custom === "string" && hexToRgb(o.custom) != null);
}
