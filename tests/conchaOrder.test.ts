/**
 * Concha labiata or renibus leads by gravity when both are shown (src/server/conchaOrder.ts).
 */
import { describe, expect, it } from "vitest";
import { CONCHA_LABIATA_BELOW_G, orderConchaPair } from "../src/server/conchaOrder.js";
import type { PlanetScan, SpeciesMatch } from "../src/shared/types.js";

const row = (id: string, pct: number, extra: Partial<SpeciesMatch> = {}): SpeciesMatch =>
  ({ entry: { id, genusDataDir: "concha" }, reasons: [], presenceProbabilityPercent: pct, genusSharePercent: pct, ...extra }) as unknown as SpeciesMatch;
const at = (g: number) => ({ SurfaceGravity: g * 9.80665 }) as PlanetScan;
const lead = (ms: SpeciesMatch[]) => [...ms].sort((a, b) => b.presenceProbabilityPercent! - a.presenceProbabilityPercent!)[0]!.entry.id;

describe("Concha labiata and renibus", () => {
  it("puts labiata first on a light body and renibus first on a heavier one", () => {
    const light = [row("concha_concha_labiata", 30), row("concha_concha_renibus", 70)];
    orderConchaPair(light, at(CONCHA_LABIATA_BELOW_G - 0.01));
    expect(lead(light)).toBe("concha_concha_labiata");
    const heavy = [row("concha_concha_labiata", 70), row("concha_concha_renibus", 30)];
    orderConchaPair(heavy, at(0.2));
    expect(lead(heavy)).toBe("concha_concha_renibus");
  });

  it("only swaps the two chances: the same rows, the same numbers", () => {
    const ms = [row("concha_concha_labiata", 30), row("concha_concha_renibus", 70)];
    orderConchaPair(ms, at(0.08));
    expect(ms.map((m) => m.presenceProbabilityPercent).sort()).toEqual([30, 70]);
    expect(ms.every((m) => !m.unlikely)).toBe(true);
  });

  it("leaves a list alone when one of the pair is hidden or a third Concha is shown", () => {
    const hidden = [row("concha_concha_labiata", 30), row("concha_concha_renibus", 70, { unlikely: true })];
    orderConchaPair(hidden, at(0.08));
    expect(hidden[0]!.presenceProbabilityPercent).toBe(30);
    const three = [row("concha_concha_labiata", 30), row("concha_concha_renibus", 60), row("concha_concha_aureolas", 10)];
    orderConchaPair(three, at(0.08));
    expect(three[0]!.presenceProbabilityPercent).toBe(30);
  });
});
