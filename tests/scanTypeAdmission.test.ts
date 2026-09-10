/**
 * Which scans describe a body well enough to predict on.
 *
 * The app used to require `ScanType: "Detailed"`, assuming nothing else carries the physics. Flying
 * to a body instead of reaching it through the FSS writes an `AutoScan` with the entire record, so
 * a commander who flew out saw no candidate species at all — reported from the field on
 * Aucoks AN-Q d6-59 BC 2.
 *
 * Across 245 journals that gate discarded 1,223 landable bodies whose auto scan was complete, and
 * 142 more from nav beacons. The test is now what the line contains, not what it is called.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 2037735475771;
const BODY = 14;
const KEY = `${SYS}:${BODY}`;
const NAME = "Aucoks AN-Q d6-59 BC 2";
const TS = "2026-09-10T16:39:50Z";
const j = (o: Record<string, unknown>) => o as unknown as JournalLine;

/** The owner's own line, trimmed to what decides admission. */
const scan = (scanType: string, extra: Record<string, unknown> = {}) =>
  j({
    timestamp: TS,
    event: "Scan",
    ScanType: scanType,
    BodyName: NAME,
    BodyID: BODY,
    StarSystem: "Aucoks AN-Q d6-59",
    SystemAddress: SYS,
    PlanetClass: "High metal content body",
    Atmosphere: "thin sulfur dioxide atmosphere",
    AtmosphereType: "SulphurDioxide",
    Volcanism: "",
    SurfaceGravity: 5.020853,
    SurfaceTemperature: 335.726593,
    SurfacePressure: 359.977539,
    Landable: true,
    WasDiscovered: true,
    WasMapped: false,
    WasFootfalled: false,
    ...extra,
  });

function seeded(): GameStateStore {
  const st = new GameStateStore();
  st.apply(j({ timestamp: TS, event: "FSDJump", StarSystem: "Aucoks AN-Q d6-59", SystemAddress: SYS }));
  return st;
}

describe("a scan that describes the body", () => {
  for (const scanType of ["Detailed", "AutoScan", "NavBeaconDetail"]) {
    it(`is kept when it is a ${scanType}`, () => {
      const st = seeded();
      st.apply(scan(scanType));
      const body = st.bodies.get(KEY);
      expect(body?.scan?.PlanetClass).toBe("High metal content body");
      expect(body?.scan?.SurfaceTemperature).toBeCloseTo(335.73, 1);
      expect(body?.scan?.Landable).toBe(true);
    });
  }
});

describe("a scan that does not", () => {
  it("is dropped, whatever it is labelled", () => {
    // `Basic` carries no planet class and no numbers: 9 in 245 journals, none usable.
    const st = seeded();
    st.apply(
      j({
        timestamp: TS,
        event: "Scan",
        ScanType: "Basic",
        BodyName: NAME,
        BodyID: BODY,
        StarSystem: "Aucoks AN-Q d6-59",
        SystemAddress: SYS,
      }),
    );
    expect(st.bodies.get(KEY)?.scan).toBeFalsy();
  });

  it("is dropped when the class is there but the numbers are not", () => {
    const st = seeded();
    st.apply(
      j({
        timestamp: TS,
        event: "Scan",
        ScanType: "AutoScan",
        BodyName: NAME,
        BodyID: BODY,
        StarSystem: "Aucoks AN-Q d6-59",
        SystemAddress: SYS,
        PlanetClass: "High metal content body",
      }),
    );
    expect(st.bodies.get(KEY)?.scan).toBeFalsy();
  });
});

describe("the two arriving together", () => {
  it("keeps a complete record when the detailed scan follows the auto scan", () => {
    const st = seeded();
    st.apply(scan("AutoScan"));
    st.apply(scan("Detailed", { SurfaceTemperature: 335.7 }));
    expect(st.bodies.get(KEY)?.scan?.PlanetClass).toBe("High metal content body");
  });

  it("does not lose the detailed record to a later auto scan", () => {
    // Order is not guaranteed across journal files. Whichever arrives last, the body must still be
    // described — this asserts the physics survives rather than being blanked.
    const st = seeded();
    st.apply(scan("Detailed"));
    st.apply(scan("AutoScan"));
    const scanned = st.bodies.get(KEY)?.scan;
    expect(scanned?.PlanetClass).toBe("High metal content body");
    expect(scanned?.SurfaceGravity).toBeCloseTo(5.02, 2);
  });
});
