/**
 * The Volcanism field's journal side (owner, 2026-10-05): a body's geological signal count, and the
 * surface geology codex entries logged on it.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 77_001;
const line = (x: Record<string, unknown>) => ({ timestamp: "2026-10-05T10:00:00Z", ...x }) as unknown as JournalLine;

describe("geology in the journals", () => {
  it("keeps the geological count and the geology logged on the body, never as a plant", () => {
    const s = new GameStateStore();
    s.apply(line({ event: "FSDJump", StarSystem: "Geo Test", SystemAddress: SYS, StarPos: [0, 0, 0] }));
    s.apply(
      line({
        event: "FSSBodySignals",
        SystemAddress: SYS,
        BodyID: 4,
        BodyName: "Geo Test 4",
        Signals: [{ Type: "$SAA_SignalType_Geological;", Type_Localised: "Geological", Count: 3 }],
      }),
    );
    s.apply(
      line({
        event: "CodexEntry",
        EntryID: 1400114,
        Name: "$Codex_Ent_Fumarole_SulphurDioxideMagma_Name;",
        Name_Localised: "Sulphur Dioxide Fumarole",
        SubCategory: "$Codex_SubCategory_Geology_and_Anomalies;",
        Category: "$Codex_Category_Biology;",
        Region: "$Codex_RegionName_18;",
        Region_Localised: "Inner Orion Spur",
        System: "Geo Test",
        SystemAddress: SYS,
        BodyID: 4,
      }),
    );
    const b = s.bodies.get(`${SYS}:4`)!;
    expect(b.geologicalSignals).toBe(3);
    expect(b.biologicalSignals ?? null).toBeNull();
    expect(b.geologyLogged).toEqual(["codex_ent_fumarole_sulphurdioxidemagma"]);
    expect(b.organicGenusLocks).toEqual([]);
  });
});
