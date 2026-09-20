/**
 * Bacterium tela does not require volcanism, and the codex row said it did.
 *
 * Reported by the owner as an alert he could not explain: he had sampled Bacterium tela on
 * `Eorgh Prou OP-C c27-179 B 2` — High metal content, thin sulphur dioxide, 343.8 K, 0.460 g, **no
 * volcanism** — and the app raised "Confirmed on foot — not a candidate". It was right to. The row
 * carried `volcanism: ["Helium", "Iron", "Silicate", "Ammonia"]`, which the matcher reads as a hard
 * requirement, so on any body with no volcanism the species was never listed at all.
 *
 * The corpus settles it: **706 of the 833 observed bodies for this species have no volcanism**, so
 * the gate was hiding it on 85% of the worlds it actually grows on. Every other volcanism-gated
 * species sits at 0-4.5% no-volcanism, which is why this was one bad row rather than a rule worth
 * softening — the row's own description read "linked to multiple volcanism types", which is a list of
 * where it has *also* been seen, transcribed as a condition. That sentence was replaced on
 * 2026-09-20, once the two branches below said the same thing properly.
 *
 * The evidence is pinned here as well as the fix. A number that came out of the corpus is the only
 * thing standing between this row and somebody restoring it from the codex again.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getProjectRoot, getSpeciesDataDir } from "../src/server/paths.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

const root = getProjectRoot();
const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
const tela = db.species.find((e) => e.displayName.toLowerCase() === "bacterium tela")!;

/** The body the owner stood on, out of his journal. */
const REPORTED: PlanetScan = {
  BodyName: "Eorgh Prou OP-C c27-179 B 2",
  BodyID: 18,
  StarSystem: "Eorgh Prou OP-C c27-179",
  SystemAddress: 1,
  PlanetClass: "High metal content body",
  AtmosphereType: "SulphurDioxide",
  SurfaceGravity: 4.512,
  SurfaceTemperature: 343.8,
  SurfacePressure: 202,
  Landable: true,
  // No `Volcanism` at all, which is the whole point of the row.
};

function verdict(scan: PlanetScan) {
  const est = estimatedTemperatureRangeForScan(scan);
  const t = scan.SurfaceTemperature;
  const band = t != null ? { minK: t, maxK: t } : est ? { minK: est.tMin, maxK: est.tMax } : null;
  return speciesMatchesCriteria(tela, scan, band, est, { surfacePressureAtm: 0.002 });
}

describe("Bacterium tela on a body with no volcanism", () => {
  it("carries no volcanism requirement any more", () => {
    expect(tela.criteria.volcanismIncludes ?? []).toEqual([]);
    expect(tela.criteria.volcanismActiveRequired).not.toBe(true);
  });

  it("is offered on the body the commander actually sampled it on", () => {
    const r = verdict(REPORTED);
    expect(r.ok).toBe(true);
  });

  it("still gates on the thing that does decide it — a thin atmosphere", () => {
    // Dropping the wrong gate must not drop the right one. Airless, and it should not be offered.
    const airless: PlanetScan = { ...REPORTED, AtmosphereType: undefined, Atmosphere: undefined };
    expect(verdict(airless).ok).toBe(false);
  });

  it("agrees with the corpus it was corrected from", () => {
    /*
      The measurement, not a memory of it. If a profile rebuild ever moves these counts, this test
      says so rather than letting the justification quietly go stale.
    */
    const file = path.join(
      getSpeciesDataDir(root),
      "bacterium",
      "exomastery",
      "bacterium_tela_exomastery.json",
    );
    if (!existsSync(file)) return; // a build without the feeder profiles: nothing to check against
    const j = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const findVolc = (o: unknown, d = 0): Record<string, number> | null => {
      if (d > 3 || !o || typeof o !== "object") return null;
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (/volcanismType$/i.test(k)) return v as Record<string, number>;
        const r = findVolc(v, d + 1);
        if (r) return r;
      }
      return null;
    };
    const hist = findVolc(j);
    expect(hist).not.toBeNull();
    const total = Object.values(hist!).reduce((n, v) => n + Number(v), 0);
    const none = Number(hist!["No volcanism"] ?? 0);
    expect(total).toBeGreaterThan(500);
    // 706 of 833 when this was written. The claim is "the great majority", not the exact figure.
    expect(none / total).toBeGreaterThan(0.7);
  });

  /*
    The two branches, on real bodies.

    The row above says volcanism is not a *requirement*; these say what replaced the gap it left.
    Tela is on a body with volcanism, or on a body at 300 K or more, and on nothing else: 687 of 687
    corpus bodies, 33 of 33 in an independent EDDN sample, 0 of 10,630 cold non-volcanic Bacterium
    bodies. Each case below is one of those bodies. See docs/tela-decision-20092026.md.
  */
  const ICY_NEON_COLD: PlanetScan = {
    BodyName: "cold icy neon, from the relay sample",
    BodyID: 3,
    StarSystem: "test",
    SystemAddress: 2,
    PlanetClass: "Icy body",
    AtmosphereType: "Neon",
    SurfaceGravity: 5.0,
    SurfaceTemperature: 40,
    SurfacePressure: 180,
    Landable: true,
    Volcanism: "",
  };

  it("is not on a cold body with no volcanism — neither tier, not a demotion", () => {
    const r = verdict(ICY_NEON_COLD);
    expect(r.ok).toBe(false);
    const presence = r.reasons.find((x) => x.field === "Presence");
    expect(presence, "the failure has to name Presence, or the panel cannot explain it").toBeTruthy();
    // Hard. A soft failure is liftable by restoreDemotionsBelowSignalCount, which would put the row
    // back on exactly the bodies three datasets say it is never on.
    expect(presence!.soft).not.toBe(true);
    expect(r.softOnly).toBe(false);
  });

  it("is on that same cold body once it has volcanism", () => {
    const volcanic: PlanetScan = { ...ICY_NEON_COLD, Volcanism: "major water magma volcanism" };
    const r = verdict(volcanic);
    expect(r.ok, "the cold branch is volcanism, any type").toBe(true);
  });

  it("is on a hot body with no volcanism — the branch the old CO₂ demotion got wrong", () => {
    /*
      `Floawns BF-L b14-8 3` in the relay sample: HMC, thin CO₂, 347 K, no volcanism. Carbon dioxide
      used to demote tela outright; above 300 K the corpus has it on 14 of 24 such bodies.
    */
    const hotCo2: PlanetScan = {
      ...ICY_NEON_COLD,
      PlanetClass: "High metal content body",
      AtmosphereType: "CarbonDioxide",
      SurfaceTemperature: 347,
      Volcanism: "",
    };
    expect(verdict(hotCo2).ok).toBe(true);
  });

  it("does not let the estimator sneak a cold body into the hot branch", () => {
    /*
      With no thermometer the branch falls back to the estimated band, which is wide — a mean 137 K
      and a p90 of 291 K. That is deliberate, so an unscanned body is not hidden from the FSS list,
      but it must still be an overlap test and not a pass. An icy body's estimate does not reach
      300 K, so the branch fails and the row is gone.
    */
    const noReading: PlanetScan = { ...ICY_NEON_COLD, SurfaceTemperature: undefined };
    expect(verdict(noReading).ok).toBe(false);
  });

  it("leaves the genuinely volcanism-bound species alone", () => {
    /*
      Fifteen other species carry this gate and every one of them checks out at 0-4.5% no-volcanism
      in the corpus. Removing tela's must not become a reason to remove theirs.
    */
    for (const name of ["Bacterium omentum", "Bacterium scopulum", "Bacterium verrata", "Fumerola aquatis"]) {
      const e = db.species.find((x) => x.displayName.toLowerCase() === name.toLowerCase());
      expect(e, name).toBeTruthy();
      expect((e!.criteria.volcanismIncludes ?? []).length, name).toBeGreaterThan(0);
    }
  });
});
