import type { JournalHistoryPreset } from "./journalHistoryPreset.js";
import type { PollRatesDTO } from "./pollRates.js";
import type { RadarRadiusDTO } from "./radarRadius.js";

export type { JournalHistoryPreset };
export type { PollRatesDTO };
export type { RadarRadiusDTO };

/*
  The shared DTOs live in ./dto/ by domain (code review D, 2026-09-27: this file was 3,037 lines).
  Everything is re-exported here, so every existing import of "shared/types" keeps working.
*/
export * from "./dto/scan.js";
export * from "./dto/remote.js";
export * from "./dto/species.js";
export * from "./dto/body.js";
export * from "./dto/discoveries.js";
export * from "./dto/exomastery.js";
export * from "./dto/footCatalog.js";
export * from "./dto/app.js";
export * from "./dto/galaxy.js";
export * from "./dto/carriers.js";
export * from "./dto/hud.js";
export * from "./dto/snapshot.js";
export * from "./dto/systemMap.js";
export * from "./dto/codexMap.js";
