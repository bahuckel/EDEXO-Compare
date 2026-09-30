/**
 * The phenomena card (src/shared/nspOutlook.ts, src/server/nspOutlook.ts; owner 2026-09-30): what the
 * journals saw, what EDAstro logged, and the prediction from region, main star and phenomena nearby.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isNspCodexName,
  nspCardWorthShowing,
  nspChanceWord,
  nspOdds,
  nspPredict,
  nspStarKey,
} from "../src/shared/nspOutlook.js";
import { readNspStatus, resetNspMemo, startNspDownload } from "../src/server/edastroNsp.js";
import { nspOutlook } from "../src/server/nspOutlook.js";
import { GameStateStore } from "../src/server/gameState.js";

describe("which codex entries are phenomena", () => {
  it("the NSP families, never an L-type star", () => {
    expect(isNspCodexName("$Codex_Ent_Gas_Clds_Light_Name;")).toBe(true);
    expect(isNspCodexName("$Codex_Ent_L_Cry_MetCry_Gr_Name;")).toBe(true);
    expect(isNspCodexName("codex_ent_small_org_moll01_v6_def")).toBe(true);
    expect(isNspCodexName("$Codex_Ent_L_Type_Name;")).toBe(false);
    expect(isNspCodexName("$Codex_Ent_Standard_Rocky_No_Atmos_Name;")).toBe(false);
  });
});

describe("the prediction", () => {
  it("maps journal star types onto the model's names", () => {
    expect(nspStarKey("H")).toBe("Black Hole");
    expect(nspStarKey("N")).toBe("Neutron Star");
    expect(nspStarKey("DA")).toBe("White Dwarf");
    expect(nspStarKey("M_RedGiant")).toBe("M");
    expect(nspStarKey("A_BlueWhiteSuperGiant")).toBe("A");
    expect(nspStarKey("WNC")).toBe("Wolf-Rayet NC Star");
    expect(nspStarKey("")).toBeNull();
  });

  it("region leads: Dryman's Point likely, Ryker's Hope not worth a card", () => {
    const dry = nspPredict({ region: "Dryman's Point", starType: "K", nearby: null });
    expect(dry.p).toBeGreaterThan(0.3);
    expect(dry.reasons[0]).toMatch(/Dryman's Point is rich in phenomena/);
    expect(nspChanceWord(dry.p)).toBe("Likely");
    const ryk = nspPredict({ region: "Ryker's Hope", starType: "A", nearby: null });
    expect(ryk.p).toBeLessThan(0.03);
    // A reason that raises the chance leads, even when a lowering one weighs more.
    const mixed = nspPredict({ region: "Inner Orion Spur", starType: "A", nearby: 0 });
    expect(mixed.reasons[0]).toMatch(/rich in phenomena|A-type/);
    // A black hole lifts, a neutron star lowers.
    const inner = (st: string) => nspPredict({ region: "Inner Orion Spur", starType: st, nearby: null }).p;
    expect(inner("H")).toBeGreaterThan(inner("K"));
    expect(inner("N")).toBeLessThan(inner("K"));
  });

  it("phenomena nearby move it, and the card only shows from 10 %", () => {
    const none = nspPredict({ region: "Inner Orion Spur", starType: "M", nearby: 0 }).p;
    const many = nspPredict({ region: "Inner Orion Spur", starType: "M", nearby: 150 }).p;
    expect(many).toBeGreaterThan(none * 5);
    const base = { systemAddress: 1, seen: [], logged: [], loggedDetail: [], nearest: [], region: null };
    expect(nspCardWorthShowing({ ...base, guess: { p: 0.06, reasons: [] } })).toBe(false);
    expect(nspCardWorthShowing({ ...base, guess: { p: 0.12, reasons: [] } })).toBe(true);
    expect(nspCardWorthShowing({ ...base, guess: null, seen: [""] })).toBe(true);
    expect(nspOdds(0.08)).toBe("about 1 in 13");
    expect(nspOdds(0.7)).toBe("about 2 in 3");
  });
});

describe("the journals", () => {
  it("remember a phenomenon's FSS signal, then its codex name, through the merge cache", () => {
    const s = new GameStateStore();
    const t = "2026-09-30T12:00:00Z";
    s.apply({ timestamp: t, event: "FSSSignalDiscovered", SystemAddress: 9, SignalName: "$Fixed_Event_Life_Cloud;", SignalType: "Codex" } as never);
    s.apply({ timestamp: t, event: "FSSSignalDiscovered", SystemAddress: 9, SignalName: "$MULTIPLAYER_SCENARIO42_TITLE;" } as never);
    expect(s.nspSeen.get(9)).toEqual([""]);
    s.apply({
      timestamp: t,
      event: "CodexEntry",
      Name: "$Codex_Ent_Gas_Clds_Light_Name;",
      Name_Localised: "Proto-Lagrange Cloud",
      Region_Localised: "Inner Orion Spur",
      System: "Nine",
      SystemAddress: 9,
    } as never);
    s.apply({ timestamp: t, event: "CodexEntry", Name: "$Codex_Ent_L_Type_Name;", Name_Localised: "L Type Star", SystemAddress: 8 } as never);
    expect(s.nspSeen.get(9)).toEqual(["Proto-Lagrange Cloud"]);
    expect(s.nspSeen.has(8)).toBe(false);
    const b = new GameStateStore();
    b.hydrateJournalMergePayload(s.serializeJournalMergePayload());
    expect(b.nspSeen.get(9)).toEqual(["Proto-Lagrange Cloud"]);
  });
});

describe("the outlook", () => {
  let dir: string;
  const saved = process.env.EDEXO_USER_DATA_DIR;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "edexo-nspo-"));
    process.env.EDEXO_USER_DATA_DIR = dir;
    resetNspMemo();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.EDEXO_USER_DATA_DIR;
    else process.env.EDEXO_USER_DATA_DIR = saved;
    resetNspMemo();
    rmSync(dir, { recursive: true, force: true });
  });

  it("without the EDAstro list: his own sightings and the region-and-star prediction", () => {
    const o = nspOutlook({ systemAddress: 1, position: { x: 0, y: 0, z: 0 }, seen: [], region: "Dryman's Point", starType: "M" });
    expect(o.guess!.p).toBeGreaterThan(0.3);
    expect(o.nearest).toEqual([]);
    expect(nspOutlook({ systemAddress: 2, position: null, seen: [""], region: null, starType: null })).toMatchObject({ seen: [""], guess: null });
  });

  it("with it: logged here, the nearest kinds, and the nearby count in the prediction", async () => {
    const csv = [
      'Codex Entry,Codex ID,First Reported,Odyssey,Region,System,X,Y,Z,Main Star Type,"System Address / ID64"',
      'Proto-Lagrange Cloud,codex_ent_gas_clds_light,"2025",0,R,Here,0,0,0,"K",1',
      'Albens Bell Mollusc,codex_ent_small_org_moll01_v6_def,"2025",0,R,Near,30,0,0,"K",2',
      'Metallic Crystals,codex_ent_l_cry_metcry_gr,"2025",0,R,Far,400,0,0,"K",3',
    ].join("\r\n");
    const body = new TextEncoder().encode(csv);
    startNspDownload({
      fetchImpl: (async () =>
        new Response(new Blob([body]).stream(), { status: 200, headers: { "content-length": String(body.length) } })) as typeof fetch,
    });
    for (let i = 0; i < 400 && readNspStatus().running; i++) await new Promise((r) => setTimeout(r, 5));
    const here = nspOutlook({ systemAddress: 1, position: { x: 0, y: 0, z: 0 }, seen: [], region: "Inner Orion Spur", starType: "K" });
    expect(here.logged).toEqual(["Lagrange cloud"]);
    expect(here.loggedDetail).toEqual(["Proto-Lagrange Cloud"]);
    expect(here.nearest.map((n) => [n.name, n.distanceLy])).toEqual([
      ["Space mollusc", 30],
      ["Metallic crystals", 400],
    ]);
    const empty = nspOutlook({ systemAddress: 7, position: { x: 10, y: 0, z: 0 }, seen: [], region: "Inner Orion Spur", starType: "K" });
    expect(empty.nearest[0]).toMatchObject({ name: "Lagrange cloud", distanceLy: 10 });
    expect(empty.guess!.reasons.join(" ")).toMatch(/2 known within 100 ly/);
  });
});
