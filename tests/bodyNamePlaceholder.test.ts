/**
 * ScanOrganic and CodexEntry name a body only by id. They come after the Scan that named it (landing
 * follows scanning), and their "Body 2" placeholder used to replace the real name — 282 of the
 * owner's bio bodies, Tegnae HT-Z d13-1 1 a among them (BACKLOG §N).
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = "Tegnae HT-Z d13-1";
const ADDR = 48611743739;
const j = (o: Record<string, unknown>) =>
  ({ timestamp: "2026-09-25T05:41:36Z", ...o }) as unknown as JournalLine;

function scanned(): GameStateStore {
  const s = new GameStateStore();
  s.apply(j({ event: "FSDJump", StarSystem: SYS, SystemAddress: ADDR, StarPos: [0, 0, 0], Population: 0 }));
  s.apply(
    j({
      event: "Scan",
      ScanType: "Detailed",
      BodyName: `${SYS} 1 a`,
      BodyID: 2,
      Parents: [{ Planet: 1 }, { Star: 0 }],
      StarSystem: SYS,
      SystemAddress: ADDR,
      PlanetClass: "Rocky body",
      Atmosphere: "",
      SurfaceGravity: 0.5,
      SurfaceTemperature: 180,
      Landable: true,
      DistanceFromArrivalLS: 1134.8,
    }),
  );
  s.apply(
    j({
      event: "FSSBodySignals",
      BodyName: `${SYS} 1 a`,
      BodyID: 2,
      SystemAddress: ADDR,
      Signals: [{ Type: "$SAA_SignalType_Biological;", Count: 1 }],
    }),
  );
  return s;
}

describe("body names", () => {
  it("a ScanOrganic after the Scan keeps the real name", () => {
    const s = scanned();
    s.apply(
      j({
        event: "ScanOrganic",
        ScanType: "Log",
        Genus: "$Codex_Ent_Cone_Genus_Name;",
        Genus_Localised: "Bark Mounds",
        Species: "$Codex_Ent_Cone_Name;",
        Species_Localised: "Bark Mounds",
        SystemAddress: ADDR,
        Body: 2,
      }),
    );
    expect(s.bodies.get(`${ADDR}:2`)?.bodyName).toBe(`${SYS} 1 a`);
  });

  it("a CodexEntry after the Scan keeps the real name", () => {
    const s = scanned();
    s.apply(
      j({
        event: "CodexEntry",
        EntryID: 2100301,
        Name: "$Codex_Ent_Cone_Name;",
        Name_Localised: "Bark Mounds",
        SubCategory: "$Codex_SubCategory_Organic_Structures;",
        Category: "$Codex_Category_Biology;",
        System: SYS,
        SystemAddress: ADDR,
        BodyID: 2,
      }),
    );
    expect(s.bodies.get(`${ADDR}:2`)?.bodyName).toBe(`${SYS} 1 a`);
  });
});
