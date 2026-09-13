/**
 * Slim snapshots per client kind (owner, 2026-09-13, "snapshot deltas" — the root fix for the
 * launcher's heaviness).
 *
 * One snapshot used to go to every socket: the app needs all of it, the HUD reads sixteen fields
 * and one body's candidate rows, the launcher reads five. Each socket now says what it is
 * (`{ type: "hello", channel }`) and gets a payload cut to that. The app keeps the full state.
 */
import type { AppSnapshot, BodyComputed } from "../shared/types.js";

export type WsChannel = "app" | "hud" | "launcher";

export function parseWsChannel(v: unknown): WsChannel | null {
  return v === "app" || v === "hud" || v === "launcher" ? v : null;
}

/** Everything `public/hud.js` reads off the snapshot (`d.<key>`), plus the bodies it looks up. */
const HUD_KEYS = [
  "port",
  "journalBoot",
  "currentRegion",
  "exoOverlayFocusBodyKey",
  "exoOverlayFocusBody",
  "exoOrganicOverlay",
  "exoMinimap",
  "statusDestination",
  "jumpTarget",
  "dScanBodies",
  "liveShipFuelRange",
  "organicDataValueCredits",
  "organicPendingSampleCount",
  "explorationScanDataValueCredits",
  "includeExplorationScanDataInDataValue",
  "hudPrefs",
] as const satisfies readonly (keyof AppSnapshot)[];

/** What the launcher's `applyLauncherSnapshotData` reads; its live strip polls `/api/status` on its own. */
const LAUNCHER_KEYS = [
  "port",
  "journalBoot",
  "journalDir",
  "journalDirConfiguredOk",
  "journalFileCount",
  "lastJournalEventIso",
] as const satisfies readonly (keyof AppSnapshot)[];

/** A body as the HUD's candidate list needs it: the journal state, the label, the rows' essentials. */
export function slimBodyForHud(b: BodyComputed): Partial<BodyComputed> {
  return {
    state: b.state,
    tabLabel: b.tabLabel,
    matches: b.matches.map((m) => ({
      entry: {
        id: m.entry.id,
        displayName: m.entry.displayName,
        genus: m.entry.genus,
        genusDataDir: m.entry.genusDataDir,
      },
      priceCredits: m.priceCredits,
      presenceProbabilityPercent: m.presenceProbabilityPercent,
      unlikely: m.unlikely,
      organicAnalysisComplete: m.organicAnalysisComplete,
      exomasterySimilarityPercent: m.exomasterySimilarityPercent,
    })) as unknown as BodyComputed["matches"],
  };
}

export function slimSnapshotForChannel(snap: AppSnapshot, channel: WsChannel): Partial<AppSnapshot> {
  if (channel === "app") return snap;
  const out: Record<string, unknown> = {};
  const keys: readonly (keyof AppSnapshot)[] = channel === "hud" ? HUD_KEYS : LAUNCHER_KEYS;
  for (const k of keys) out[k] = snap[k];
  if (channel === "hud") {
    out.bodies = (snap.bodies ?? []).map(slimBodyForHud);
    if (snap.exoOverlayFocusBody) out.exoOverlayFocusBody = slimBodyForHud(snap.exoOverlayFocusBody);
  }
  return out as Partial<AppSnapshot>;
}
