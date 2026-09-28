/**
 * The HUD as its overlay pages load it: `public/hud/main.js` and the modules under it (split out of
 * the single `public/hud.js` on 2026-09-28). Each call starts from a fresh module graph, so one test's
 * section state — the radar's last fix, the cue memory, the theme — never leaks into the next.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { vi } from "vitest";

const MAIN = pathToFileURL(path.resolve(__dirname, "..", "..", "public", "hud", "main.js")).href;

export async function loadHudModule<T>(): Promise<T> {
  document.body.innerHTML =
    '<div class="shell" id="shell"><div class="panel" id="card"><div class="panel__body" id="hud"></div></div></div>';
  vi.resetModules();
  const mod = (await import(/* @vite-ignore */ MAIN)) as { HUD: T };
  return mod.HUD;
}
