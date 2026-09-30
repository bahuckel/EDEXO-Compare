/**
 * Applies the app's colour scheme (shared/appThemes.ts) to the page: three custom properties on the
 * root, so every rule written against the accent tokens follows. Stored per device, like the other
 * look-and-feel choices; the HUD overlays keep their own scheme, set in the launcher.
 */
import {
  DEFAULT_APP_THEME,
  isAppThemeChoice,
  resolveAppTheme,
  rgbToHex,
  themeNeutrals,
  type AppThemeChoice,
  type SavedAppTheme,
} from "@shared/appThemes";

const LS_THEME = "edexo.appTheme";
const LS_SAVED = "edexo.appThemesSaved";
export const APP_THEME_EVENT = "edexo-app-theme";

export function readAppTheme(): AppThemeChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_THEME) ?? "null") as unknown;
    if (isAppThemeChoice(raw)) return raw;
  } catch {
    /* default */
  }
  return { preset: DEFAULT_APP_THEME.key };
}

/** Everything a scheme sets on the root, so going back to the default can clear it all. */
const THEMED = [
  "--accent-rgb",
  "--accent-bright",
  "--accent-deep",
  "--hud",
  "--hud-hi",
  "--hud-dim",
  "--hud-faint",
  "--hud-ghost",
  "--hud-glow",
  "--hex-grid",
  ...Object.keys(themeNeutrals(DEFAULT_APP_THEME.rgb)),
];

/** The static honeycomb behind the app (tokens.css `--hex-grid`), stroked in the accent. */
function hexGridUrl(rgb: string): string {
  const stroke = encodeURIComponent(rgbToHex(rgb));
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 27.7128 48'%3E%3Cpath d='M13.8564 0L27.7128 8L27.7128 24L13.8564 32L0 24L0 8ZM13.8564 32L13.8564 48' fill='none' stroke='${stroke}' stroke-opacity='0.16' stroke-width='0.75'/%3E%3C/svg%3E")`;
}

export function applyAppTheme(choice: AppThemeChoice = readAppTheme()): void {
  const t = resolveAppTheme(choice);
  const root = document.documentElement.style;
  if (t.key === DEFAULT_APP_THEME.key) {
    // The default is what tokens.css already says: leave the page exactly as it was.
    for (const p of THEMED) root.removeProperty(p);
  } else {
    root.setProperty("--accent-rgb", t.rgb);
    root.setProperty("--accent-bright", t.bright);
    root.setProperty("--accent-deep", t.deep);
    // The shared palette's names for the same colour (second screen, snapshots).
    root.setProperty("--hud", `rgb(${t.rgb})`);
    root.setProperty("--hud-hi", t.bright);
    root.setProperty("--hud-dim", `rgba(${t.rgb}, 0.55)`);
    root.setProperty("--hud-faint", `rgba(${t.rgb}, 0.22)`);
    root.setProperty("--hud-ghost", `rgba(${t.rgb}, 0.1)`);
    root.setProperty("--hud-glow", `0 0 6px rgba(${t.rgb}, 0.45)`);
    root.setProperty("--hex-grid", hexGridUrl(t.rgb));
    // The text and panels were tinted towards the orange too (2026-09-30).
    for (const [k, v] of Object.entries(themeNeutrals(t.rgb))) root.setProperty(k, v);
  }
  window.dispatchEvent(new CustomEvent(APP_THEME_EVENT));
}

export function setAppTheme(choice: AppThemeChoice): void {
  try {
    localStorage.setItem(LS_THEME, JSON.stringify(choice));
  } catch {
    /* applied for this session anyway */
  }
  applyAppTheme(choice);
}

/** The accent for the backdrop, or null for the default (the backdrop keeps its own warmer orange). */
export function backdropAccentRgb(): string | null {
  const t = resolveAppTheme(readAppTheme());
  return t.key === DEFAULT_APP_THEME.key ? null : t.rgb;
}

export function readSavedThemes(): SavedAppTheme[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SAVED) ?? "[]") as unknown;
    return Array.isArray(raw)
      ? raw.filter(
          (x): x is SavedAppTheme =>
            !!x && typeof x.name === "string" && typeof x.hex === "string" && /^#[0-9a-f]{6}$/i.test(x.hex),
        )
      : [];
  } catch {
    return [];
  }
}

export function writeSavedThemes(list: SavedAppTheme[]): void {
  try {
    localStorage.setItem(LS_SAVED, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* not kept */
  }
}
