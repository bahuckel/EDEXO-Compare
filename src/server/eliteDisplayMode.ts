/**
 * Which display mode Elite is set to, because it decides whether the HUDs can be seen at all.
 *
 * A click-through always-on-top window draws over a **borderless** game and cannot draw over an
 * **exclusive fullscreen** one. That is a Windows rule, not something this app can work around: in
 * exclusive fullscreen the game owns the display and the compositor is out of the picture.
 *
 * The commander met the near miss of this and it cost an evening. His HUD stopped appearing, the
 * report read as the hotkey breaking, and the real cause was the window sitting *underneath* the
 * game — the app had asserted always-on-top once and never again (`raiseHudWindow` in
 * `electron/main.cjs`). He was in borderless, so re-asserting fixed it. Had he been in fullscreen
 * there would have been nothing to fix and no way to say so, which is what this is for.
 *
 * The game writes the setting itself:
 *
 *     %LOCALAPPDATA%\Frontier Developments\Elite Dangerous\Options\Graphics\DisplaySettings.xml
 *     <FullScreen>2</FullScreen>
 *
 * `0` windowed, `1` fullscreen, `2` borderless. Read-only, and read fresh each time — the commander
 * changes it while the app is running, which is exactly when the answer matters.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export type EliteDisplayMode = "windowed" | "fullscreen" | "borderless" | "unknown";

export interface EliteDisplayStatus {
  mode: EliteDisplayMode;
  /** True only when the app can say, from the game's own file, that overlays cannot be drawn. */
  overlaysBlocked: boolean;
  /** The file it read, for a commander who wants to check. Absent when nothing was found. */
  source?: string;
}

/** Elite's own numbering, from the file it writes. */
const MODE_BY_VALUE: Record<string, EliteDisplayMode> = {
  "0": "windowed",
  "1": "fullscreen",
  "2": "borderless",
};

export function eliteDisplaySettingsPath(): string {
  const override = process.env.EDEXO_ELITE_OPTIONS_DIR?.trim();
  const base =
    override ||
    path.join(process.env.LOCALAPPDATA || "", "Frontier Developments", "Elite Dangerous", "Options");
  return path.join(base, "Graphics", "DisplaySettings.xml");
}

/**
 * Read the mode, or report `unknown`.
 *
 * Unknown is never treated as a warning. A commander running Elite from a different drive, a
 * different launcher, or not at all would otherwise be told his overlays are broken on the strength
 * of a file this app could not find.
 */
export function readEliteDisplayMode(file = eliteDisplaySettingsPath()): EliteDisplayStatus {
  let xml: string;
  try {
    xml = readFileSync(file, "utf8");
  } catch {
    return { mode: "unknown", overlaysBlocked: false };
  }

  const m = /<FullScreen>\s*(\d+)\s*<\/FullScreen>/i.exec(xml);
  const mode = m ? (MODE_BY_VALUE[m[1]!] ?? "unknown") : "unknown";
  return { mode, overlaysBlocked: mode === "fullscreen", source: file };
}

/** One sentence for the launcher. Null when there is nothing worth saying. */
export function eliteDisplayWarning(status: EliteDisplayStatus): string | null {
  if (!status.overlaysBlocked) return null;
  return (
    "Elite is set to Fullscreen. Windows does not let any overlay draw over an exclusive " +
    "fullscreen game, so the HUDs will not appear. Switch the game to Borderless."
  );
}
