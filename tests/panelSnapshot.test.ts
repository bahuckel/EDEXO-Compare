/**
 * Panel snapshots (owner, 2026-09-26): the EDEXO stamp always, commander / system / time only when
 * switched on in Options.
 */
import { describe, expect, it } from "vitest";
import { snapshotFileName, stampLines, stampTime } from "../src/client/panelSnapshot.js";

const at = new Date(Date.UTC(2026, 8, 26, 21, 58, 7));
const stamp = (commander: boolean, system: boolean, timestamp: boolean) => ({
  prefs: { commander, system, timestamp },
  commanderName: "FALrenica",
  systemName: "Tegnae ZK-Z c28-3",
});

describe("snapshot stamp", () => {
  it("adds nothing beside the EDEXO mark by default", () => {
    expect(stampLines(stamp(false, false, false), at)).toEqual([]);
  });

  it("adds each line only when it is switched on, in a fixed order", () => {
    expect(stampLines(stamp(true, false, false), at)).toEqual(["CMDR FALrenica"]);
    expect(stampLines(stamp(true, true, true), at)).toEqual([
      "CMDR FALrenica",
      "Tegnae ZK-Z c28-3",
      "2026-09-26 21:58 UTC",
    ]);
  });

  it("skips a switched-on line it has nothing for", () => {
    expect(stampLines({ ...stamp(true, true, false), commanderName: null, systemName: " " }, at)).toEqual([]);
  });

  it("writes the time in UTC and names the file after the system and panel", () => {
    expect(stampTime(at)).toBe("2026-09-26 21:58 UTC");
    expect(snapshotFileName("candidates", "Tegnae ZK-Z c28-3", at)).toBe(
      "EDEXO-Tegnae-ZK-Z-c28-3-candidates-20260926-2158.png",
    );
    expect(snapshotFileName("system-map", null, at)).toBe("EDEXO-system-map-20260926-2158.png");
  });
});
