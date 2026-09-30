/**
 * Applies the app's colour scheme (shared/appThemes.ts) to the page: three custom properties on the
 * root, so every rule written against the accent tokens follows. Stored per device, like the other
 * look-and-feel choices; the HUD overlays keep their own scheme, set in the launcher.
 */
import {
  DEFAULT_APP_THEME,
  isAppThemeChoice,
  resolveAppTheme,
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

export function applyAppTheme(choice: AppThemeChoice = readAppTheme()): void {
  const t = resolveAppTheme(choice);
  const root = document.documentElement.style;
  if (t.key === DEFAULT_APP_THEME.key) {
    // The default is what tokens.css already says: leave the page exactly as it was.
    for (const p of ["--accent-rgb", "--accent-bright", "--accent-deep", "--hud", "--hud-hi"]) root.removeProperty(p);
  } else {
    root.setProperty("--accent-rgb", t.rgb);
    root.setProperty("--accent-bright", t.bright);
    root.setProperty("--accent-deep", t.deep);
    // The shared palette's name for the same colour (second screen, snapshots).
    root.setProperty("--hud", `rgb(${t.rgb})`);
    root.setProperty("--hud-hi", t.bright);
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
