/**
 * The commander's settings file: what is written, what is read back and how (the same clamps as the
 * setters). Split out of edexoBootstrap.ts (code review D, 2026-09-28).
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { GameStateStore } from "./gameState.js";
import type { PhotoStampPrefs } from "../shared/types.js";
import { parseJournalHistoryPreset } from "../shared/journalHistoryPreset.js";
import { readEdsmCredentials } from "./edsmCredentials.js";

export function persistUserPreferences(store: GameStateStore, file: string): void {
  try {
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          includeBacteriumInSearch: store.includeBacteriumInSearch,
          includeExplorationScanDataInDataValue: store.includeExplorationScanDataInDataValue,
          pranavAntalBonus: store.pranavAntalBonus,
          sellAtFleetCarrier: store.sellAtFleetCarrier,
          exoMapTierPlusMinCr: store.exoMapTierPlusMinCr,
          exoMapTierPlusPlusMinCr: store.exoMapTierPlusPlusMinCr,
          footTravelOdometerEnabled: store.footTravelOdometerEnabled,
          journalHistoryPreset: store.journalHistoryPreset,
          // The toggle only. The EDSM key lives in its own file (edsmCredentials.ts) precisely so
          // it never lands in a settings JSON that gets pasted into bug reports.
          edsmAutoFetchEnabled: store.edsmAutoFetchEnabled,
          canonnUploadEnabled: store.canonnUploadEnabled,
          eddnUploadEnabled: store.eddnUploadEnabled,
          edsmUploadEnabled: store.edsmUploadEnabled,
          edsmLiveUploadEnabled: store.edsmLiveUploadEnabled,
          statusPollMs: store.statusPollMs,
          journalPollMs: store.journalPollMs,
          minimapRadiusM: store.minimapRadiusM,
          hudPrefs: store.hudPrefs,
          photoStamp: store.photoStamp,
          trackedAchievementId: store.trackedAchievementId,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch {
    /* optional */
  }
}

export type PersistedUserPrefs = {
  includeBacteriumInSearch?: boolean;
  includeExplorationScanDataInDataValue?: boolean;
  pranavAntalBonus?: boolean;
  sellAtFleetCarrier?: boolean;
  exoMapTierPlusMinCr?: number;
  exoMapTierPlusPlusMinCr?: number;
  footTravelOdometerEnabled?: boolean;
  journalHistoryPreset?: string;
  edsmAutoFetchEnabled?: boolean;
  canonnUploadEnabled?: boolean;
  eddnUploadEnabled?: boolean;
  edsmUploadEnabled?: boolean;
  edsmLiveUploadEnabled?: boolean;
  statusPollMs?: number;
  journalPollMs?: number;
  minimapRadiusM?: number;
  hudPrefs?: unknown;
  photoStamp?: Partial<PhotoStampPrefs>;
  trackedAchievementId?: string | null;
};

export function applyPersistedUserPrefs(store: GameStateStore, j: PersistedUserPrefs): void {
  if (j.hudPrefs && typeof j.hudPrefs === "object") store.setHudPrefs(j.hudPrefs);
  if (j.photoStamp && typeof j.photoStamp === "object") store.setPhotoStamp(j.photoStamp);
  if (typeof j.trackedAchievementId === "string") store.setTrackedAchievement(j.trackedAchievementId);
  if (typeof j.statusPollMs === "number" || typeof j.journalPollMs === "number") {
    // Read back through the same clamp that wrote them: a hand-edited settings file is the case
    // this exists for, and a 5 ms status poll would read the same file two hundred times a second.
    store.setPollRates(j.statusPollMs ?? store.statusPollMs, j.journalPollMs ?? store.journalPollMs);
  }
  if (typeof j.minimapRadiusM === "number") store.setMinimapRadiusM(j.minimapRadiusM);
  if (typeof j.includeBacteriumInSearch === "boolean") {
    store.setIncludeBacteriumInSearch(j.includeBacteriumInSearch);
  }
  if (typeof j.includeExplorationScanDataInDataValue === "boolean") {
    store.setIncludeExplorationScanDataInDataValue(j.includeExplorationScanDataInDataValue);
  }
  if (typeof j.pranavAntalBonus === "boolean") store.setPranavAntalBonus(j.pranavAntalBonus);
  if (typeof j.sellAtFleetCarrier === "boolean") store.setSellAtFleetCarrier(j.sellAtFleetCarrier);
  if (typeof j.exoMapTierPlusMinCr === "number" && typeof j.exoMapTierPlusPlusMinCr === "number") {
    store.setExoMapTierThresholds(j.exoMapTierPlusMinCr, j.exoMapTierPlusPlusMinCr);
  }
  if (typeof j.footTravelOdometerEnabled === "boolean") {
    store.setFootTravelOdometerEnabled(j.footTravelOdometerEnabled);
  }
  // dssSlack* keys from older preference files are ignored: the mechanism they tuned is gone.
  if (typeof j.journalHistoryPreset === "string") {
    store.setJournalHistoryPreset(parseJournalHistoryPreset(j.journalHistoryPreset));
  }
  // Restored only alongside a stored key: a settings file carried to a machine without one must
  // not switch outbound traffic back on by itself.
  if (j.edsmAutoFetchEnabled === true && readEdsmCredentials()) {
    store.setEdsmAutoFetchEnabled(true);
  }
  // Restored as written. There is no second factor to check the way the EDSM key is checked —
  // the switch is the whole consent — so a settings file that says on means the commander said on.
  if (j.canonnUploadEnabled === true) store.setCanonnUploadEnabled(true);
  if (j.eddnUploadEnabled === true) store.setEddnUploadEnabled(true);
  if (j.edsmUploadEnabled === true) store.setEdsmUploadEnabled(true);
  // Only meaningful with the upload on; a settings file saying otherwise is a file that was edited.
  if (j.edsmLiveUploadEnabled === true && store.edsmUploadEnabled) store.setEdsmLiveUploadEnabled(true);
}

export function tryReadUserPrefs(file: string): PersistedUserPrefs | null {
  try {
    const raw = readFileSync(file, "utf8");
    return JSON.parse(raw) as PersistedUserPrefs;
  } catch {
    return null;
  }
}
