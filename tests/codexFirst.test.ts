/**
 * [CODEX FIRST] (src/server/codexFirst.ts, owner 2026-09-30): a candidate nobody has logged in its
 * region, per EDSM's codex dump shipped in data/codex/edsm-codex-regions.json.
 */
import { describe, expect, it } from "vitest";
import { codexFirstCheck, codexFirstColours, codexFirstDataDate } from "../src/server/codexFirst.js";
import { createNoticesService } from "../src/server/notices.js";
import { DEFAULT_NOTIFY_PREFS, mergeNotifyPrefs } from "../src/shared/notices.js";

const root = process.cwd();

describe("who has logged it in the region", () => {
  it("a common plant in the bubble is not a first; an unknown one is; an unknown region never is", () => {
    // Bacterium Cerbrus is everywhere in the Inner Orion Spur.
    expect(codexFirstColours(root, "Inner Orion Spur", "Bacterium Cerbrus", "(unknown)")).toBeNull();
    expect(codexFirstColours(root, "Inner Orion Spur", "Imaginarius Plantus", "Green")).toEqual(["Green"]);
    expect(codexFirstColours(root, "Inner Orion Spur", "Imaginarius Plantus", "(unknown)")).toEqual([]);
    expect(codexFirstColours(root, "Nowhere Special", "Imaginarius Plantus", "Green")).toBeNull();
    // Region spellings meet: "Achilles's Altar" in the data, "Achilles' Altar" in the game.
    expect(codexFirstColours(root, "Achilles' Altar", "Imaginarius Plantus", "Green")).toEqual(["Green"]);
    expect(codexFirstDataDate(root)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("per colour: of two predicted colours, only the one nobody logged", () => {
    // Find a species logged in the Inner Orion Spur in one colour but not in some other colour.
    const logged = codexFirstColours(root, "Inner Orion Spur", "Bacterium Cerbrus", "Teal");
    expect(logged).toBeNull();
    const mixed = codexFirstColours(root, "Inner Orion Spur", "Bacterium Cerbrus", "Teal or Nonsense");
    expect(mixed).toEqual(["Nonsense"]);
  });
});

describe("EDAstro's plants per region too (owner, 2026-10-01)", () => {
  // Stratum Paleas - Indigo is not in EDSM's Trojan Belt (the owner's own first); its id is _02_y.
  const ed = (...keys: string[]) => ({ ids: new Set(keys), fetchedAtMs: Date.parse("2026-10-01T10:00:00Z") });
  const check = (label: string, e: ReturnType<typeof ed> | null) =>
    codexFirstCheck(root, "Trojan Belt", "Stratum Paleas", label, e);

  it("without EDAstro's list: EDSM alone, as before", () => {
    expect(check("Indigo", null)).toEqual({ colours: ["Indigo"], edastro: false, edastroSpeciesOnly: false });
  });
  it("EDAstro has the colour there: not a first", () => {
    expect(check("Indigo", ed("trojanbelt|codex_ent_stratum_02_y"))).toBeNull();
    // Another region's Indigo says nothing about the Trojan Belt.
    expect(check("Indigo", ed("veils|codex_ent_stratum_02_y"))).toEqual({ colours: ["Indigo"], edastro: true, edastroSpeciesOnly: false });
  });
  it("EDAstro has only the species there: still gold, with the note; with no colour to go on, not a first", () => {
    for (const id of ["codex_ent_stratum_02", "codex_ent_stratum_02_zz"]) {
      expect(check("Indigo", ed(`trojanbelt|${id}`))).toEqual({ colours: ["Indigo"], edastro: true, edastroSpeciesOnly: true });
      expect(check("(unknown)", ed(`trojanbelt|${id}`))).toBeNull();
    }
  });
  it("an id neither EDSM nor its base knows is ignored", () => {
    expect(check("Indigo", ed("trojanbelt|codex_ent_nothing_99_q"))).toEqual({ colours: ["Indigo"], edastro: true, edastroSpeciesOnly: false });
  });
});

describe("the notice", () => {
  const find = {
    bodyKey: "5:3",
    systemAddress: 5,
    system: "Five",
    body: "3 a",
    species: "Aleoida Arcus",
    speciesId: "aleoida-arcus",
    colours: ["Green"],
    region: "Tenebrae",
  };
  it("once per species, colour and body; off when switched off", () => {
    const n = createNoticesService({ filePath: null });
    expect(n.announceCodexFirst([find], "2026-09-30T12:00:00Z")).toBe(true);
    expect(n.announceCodexFirst([find], "2026-09-30T12:01:00Z")).toBe(false);
    expect(n.list()[0]).toMatchObject({ kind: "codex", title: "Codex first possible: Aleoida Arcus (Green)", body: "3 a" });
    expect(n.list()[0]!.text).toMatch(/nobody has logged it in Tenebrae/);
    n.setPrefs({ codexFirst: false });
    expect(n.announceCodexFirst([{ ...find, bodyKey: "5:4" }], "2026-09-30T12:02:00Z")).toBe(false);
  });
  it("is on by default, also for settings saved before it existed", () => {
    expect(DEFAULT_NOTIFY_PREFS.codexFirst).toBe(true);
    const old = { ...DEFAULT_NOTIFY_PREFS } as Partial<typeof DEFAULT_NOTIFY_PREFS>;
    delete old.codexFirst;
    expect(mergeNotifyPrefs(old as typeof DEFAULT_NOTIFY_PREFS, {}).codexFirst).toBe(true);
  });
});
