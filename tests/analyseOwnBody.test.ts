/**
 * `ScanOrganic Analyse` naming the wrong body (plan 2.4, Fable S4; owner 2026-09-22: board and fly
 * off before the analysis ends, and `Analyse` fires at wherever the ship is). The run was taken on
 * body 5; the Analyse names body 7. It completes the run on 5 and leaves 7 alone.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const SA = 1234567890123;
const organic = (type: string, body: number, t: number, species = "Osseus Spiralis") =>
  ({
    timestamp: `2026-10-02T10:0${t}:00Z`,
    event: "ScanOrganic",
    ScanType: type,
    Genus: "$Codex_Ent_Osseus_Genus_Name;",
    Genus_Localised: "Osseus",
    Species: `$Codex_Ent_${species.replace(" ", "_")}_Name;`,
    Species_Localised: species,
    SystemAddress: SA,
    Body: body,
  }) as unknown as JournalLine;

const run = (s: GameStateStore, body: number) => {
  s.apply(organic("Log", body, 1));
  s.apply(organic("Sample", body, 2));
  s.apply(organic("Sample", body, 3));
};
const species = (s: GameStateStore, body: number) =>
  (s.bodies.get(`${SA}:${body}`)?.organicGenusLocks ?? []).map((l) => `${l.speciesLocalised} ${l.source ?? ""}`.trim());

describe("an Analyse that names another body", () => {
  it("completes the run where it was taken", () => {
    const s = new GameStateStore();
    run(s, 5);
    const fixed = s.ownBodyForAnalyse(organic("Analyse", 7, 4));
    expect(fixed.Body).toBe(5);
    s.apply(organic("Analyse", 7, 4));
    expect(species(s, 7)).toEqual([]);
    expect(s.bodies.get(`${SA}:5`)?.organicGenusLocks.some((l) => l.speciesLocalised === "Osseus Spiralis")).toBe(true);
    // The run is closed: the same Analyse again has nowhere to go and is left as written.
    expect(s.ownBodyForAnalyse(organic("Analyse", 7, 5)).Body).toBe(7);
  });

  it("is left alone when its own body has the run, or no run has both samples", () => {
    const s = new GameStateStore();
    run(s, 7);
    expect(s.ownBodyForAnalyse(organic("Analyse", 7, 4)).Body).toBe(7);
    const t = new GameStateStore();
    t.apply(organic("Log", 5, 1)); // logged and left
    expect(t.ownBodyForAnalyse(organic("Analyse", 7, 4)).Body).toBe(7);
  });

  it("is left alone when two runs of the species are waiting", () => {
    const s = new GameStateStore();
    run(s, 5);
    run(s, 6);
    expect(s.ownBodyForAnalyse(organic("Analyse", 7, 4)).Body).toBe(7);
  });
});
