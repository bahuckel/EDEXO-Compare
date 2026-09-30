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
