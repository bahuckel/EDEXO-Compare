/**
 * Selling clears the value, never the biology.
 *
 * Two different sales reach the store and neither may take the plants with it:
 *
 *   - `MultiSellExplorationData` / `SellExplorationData` — cartographic data. Already cost the
 *     owner the in-app system view once (see soldSystemView.test.ts); the physics now moves to
 *     `soldExplorationScans` rather than being dropped. The biological signal count and any DSS
 *     genus list live on `bodies`, a different map again, and must be untouched.
 *   - `SellOrganicData` — the organic samples themselves. This one *should* empty the unsold ledger,
 *     because those credits have been paid. What it must not do is forget that the species was
 *     found here: a sold Stratum is still a confirmed Stratum on that body.
 *
 * This matters beyond the ledger. The first-discovery backlog treats a body as still worth flying to
 * based on `biologicalSignals` and `organicGenusLocks`; if a sale wiped either, a cashed-in system
 * would either vanish from the list or come back as an unvisited target the commander has already
 * stripped.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 6914570015099;
const BODY = 3;
const KEY = `${SYS}:${BODY}`;
const NAME = "Eorgh Prou KN-A d14-201 B 3";
const SYSNAME = "Eorgh Prou KN-A d14-201";
const TS = "2026-05-05T05:09:05Z";

const j = (o: Record<string, unknown>) => o as unknown as JournalLine;

const fss = j({
  timestamp: TS,
  event: "FSSBodySignals",
  BodyName: NAME,
  BodyID: BODY,
  SystemAddress: SYS,
  Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: 3 }],
});

const scan = j({
  timestamp: TS,
  event: "Scan",
  ScanType: "Detailed",
  BodyName: NAME,
  BodyID: BODY,
  StarSystem: SYSNAME,
  SystemAddress: SYS,
  PlanetClass: "High metal content body",
  AtmosphereType: "CarbonDioxide",
  SurfaceGravity: 5.647542,
  SurfaceTemperature: 251.650421,
  Landable: true,
  WasDiscovered: false,
  WasMapped: false,
  WasFootfalled: false,
});

const saaSignals = j({
  timestamp: TS,
  event: "SAASignalsFound",
  BodyName: NAME,
  BodyID: BODY,
  SystemAddress: SYS,
  Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: 3 }],
  Genuses: [{ Genus: "$Codex_Ent_Stratum_Genus_Name;", Genus_Localised: "Stratum" }],
});

const scanOrganic = j({
  timestamp: TS,
  event: "ScanOrganic",
  ScanType: "Analyse",
  Genus: "$Codex_Ent_Stratum_Genus_Name;",
  Genus_Localised: "Stratum",
  Species: "$Codex_Ent_Stratum_04_Name;",
  Species_Localised: "Stratum Tectonicas",
  Variant: "$Codex_Ent_Stratum_04_F_Name;",
  Variant_Localised: "Stratum Tectonicas - Green",
  SystemAddress: SYS,
  Body: BODY,
});

const sellCartographic = j({
  timestamp: TS,
  event: "MultiSellExplorationData",
  Discovered: [{ SystemName: SYSNAME, NumBodies: 12 }],
  BaseValue: 5_000_000,
  Bonus: 0,
  TotalEarnings: 5_000_000,
});

function seeded(): GameStateStore {
  const st = new GameStateStore();
  st.apply(j({ timestamp: TS, event: "FSDJump", StarSystem: SYSNAME, SystemAddress: SYS }));
  st.apply(scan);
  st.apply(fss);
  st.apply(saaSignals);
  return st;
}

describe("selling cartographic data", () => {
  let st: GameStateStore;
  beforeEach(() => {
    st = seeded();
  });

  it("keeps the biological signal count", () => {
    expect(st.bodies.get(KEY)?.biologicalSignals).toBe(3);
    st.apply(sellCartographic);
    expect(st.bodies.get(KEY)?.biologicalSignals).toBe(3);
  });

  it("keeps the DSS genus list", () => {
    st.apply(sellCartographic);
    const g = st.bodies.get(KEY)?.genusHints ?? [];
    expect(g.length).toBe(1);
  });

  it("keeps the body itself", () => {
    st.apply(sellCartographic);
    expect(st.bodies.has(KEY)).toBe(true);
    expect(st.bodies.get(KEY)?.bodyName).toBe(NAME);
  });

  it("keeps the physics, moved to the sold archive", () => {
    // The regression behind soldSystemView.test.ts, asserted from the store's own side.
    st.apply(sellCartographic);
    expect(st.physicsExplorationScan(KEY)).not.toBeNull();
  });
});

describe("selling the organic samples", () => {
  it("empties the unsold ledger but keeps the species on the body", () => {
    const st = seeded();
    st.apply(scanOrganic);
    st.apply(scanOrganic);
    st.apply(scanOrganic);

    const locksBefore = st.bodies.get(KEY)?.organicGenusLocks ?? [];
    expect(locksBefore.length).toBeGreaterThan(0);

    st.apply(
      j({
        timestamp: TS,
        event: "SellOrganicData",
        MarketID: 1,
        BioData: [
          {
            // Shape copied from the owner's 2023-10-11 log. `Variant` matters: the ledger key is
            // genus|species|variant, so a BioData row without it does not cancel the pending sale.
            Genus: "$Codex_Ent_Stratum_Genus_Name;",
            Genus_Localised: "Stratum",
            Species: "$Codex_Ent_Stratum_04_Name;",
            Species_Localised: "Stratum Tectonicas",
            Variant: "$Codex_Ent_Stratum_04_F_Name;",
            Variant_Localised: "Stratum Tectonicas - Green",
            Value: 19_010_800,
            Bonus: 0,
          },
        ],
      }),
    );

    // Paid for, so it must not still be counted as owed.
    expect(st.pendingOrganicSales.length).toBe(0);
    // But the plant was still there, and the backlog must not offer this body again.
    expect(st.bodies.get(KEY)?.organicGenusLocks.length).toBe(locksBefore.length);
    expect(st.bodies.get(KEY)?.biologicalSignals).toBe(3);
  });
});
