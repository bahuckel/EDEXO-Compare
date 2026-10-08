/**
 * Which body a green gas giant codex entry is about (shared/greenCodexMatch.ts; owner, 2026-10-08): the
 * codex line names the ship's body, so the giant is the fitting one scanned with it.
 */
import { describe, expect, it } from "vitest";
import { createGreenCodexMatcher } from "../src/shared/greenCodexMatch.js";

const SYS = 390934255035;
// Braisoo HD-Q d6-11 9 (edGGG #55), the owner's scan: the codex line says BodyID 0, the giant is 36.
const codex = (at = "2026-10-08T13:40:47Z", over: Record<string, unknown> = {}) => ({
  timestamp: at,
  event: "CodexEntry",
  Name: "$Codex_Ent_Green_Sudarsky_Class_II_Name;",
  System: "Braisoo HD-Q d6-11",
  SystemAddress: SYS,
  BodyID: 0,
  IsNewEntry: true,
  ...over,
});
const scan = (bodyId: number, planetClass = "Sudarsky class II gas giant", at = "2026-10-08T13:40:47Z") => ({
  timestamp: at,
  event: "Scan",
  ScanType: "Detailed",
  BodyName: `Braisoo HD-Q d6-11 ${bodyId}`,
  BodyID: bodyId,
  StarSystem: "Braisoo HD-Q d6-11",
  SystemAddress: SYS,
  PlanetClass: planetClass,
});

describe("a green codex entry's body", () => {
  it("is the fitting giant scanned with it, codex first (as at Braisoo)", () => {
    const m = createGreenCodexMatcher();
    expect(m.observe(codex())).toEqual([]);
    expect(
      m.observe({
        timestamp: "2026-10-08T13:40:47Z",
        event: "ScanBaryCentre",
        SystemAddress: SYS,
        BodyID: 35,
      }),
    ).toEqual([]);
    expect(m.observe(scan(36))).toEqual([
      { kind: "match", bodyKey: `${SYS}:36`, codexId: "codex_ent_green_sudarsky_class_ii", codex: codex() },
    ]);
  });

  it("or scan first, and never a body of another class, another system or out of the window", () => {
    const m = createGreenCodexMatcher();
    m.observe(scan(12, "Sudarsky class I gas giant"));
    m.observe(scan(36));
    expect(m.observe(codex()).map((e) => e.bodyKey)).toEqual([`${SYS}:36`]);
    const late = createGreenCodexMatcher();
    late.observe(codex());
    expect(late.observe(scan(36, "Sudarsky class II gas giant", "2026-10-08T13:41:30Z"))).toEqual([]);
    const other = createGreenCodexMatcher();
    other.observe(codex("2026-10-08T13:40:47Z", { SystemAddress: 1 }));
    expect(other.observe(scan(36))).toEqual([]);
  });

  it("is no one's when two fitting giants are scanned with it", () => {
    const m = createGreenCodexMatcher();
    m.observe(codex());
    expect(m.observe(scan(36))).toHaveLength(1);
    expect(m.observe(scan(37))).toEqual([{ kind: "retract", bodyKey: `${SYS}:36` }]);
    expect(m.observe(scan(38))).toEqual([]);
  });
});
