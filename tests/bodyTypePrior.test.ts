/**
 * The body-type-conditional prior: what grows on a body of *this kind*.
 *
 * Two things need guarding. The first is the **key**, because the builder and the reader must agree
 * to the character or every lookup misses and the prior silently does nothing — which is exactly how
 * three categorical terms spent months contributing nothing (§C1j). The second is the **backoff**,
 * because a thin cell answering confidently is worse than no answer at all.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BODY_TYPE_PRIOR_WEIGHT,
  MIN_CELL,
  bodyTypeKeys,
  bodyTypeLogPrior,
  loadBodyTypePrior,
} from "../src/server/bodyTypePrior.js";
import {
  BODY_TYPE_T_EDGES,
  bodyTypeAtmosphere,
  bodyTypePlanetClass,
  bodyTypeTemperature,
  bodyTypeVolcanism,
} from "../src/shared/bodyTypeKey.js";
import type { PlanetScan } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scan = (o: Record<string, unknown>) =>
  ({
    BodyName: "x",
    BodyID: 1,
    StarSystem: "s",
    SystemAddress: 1,
    Landable: true,
    ...o,
  }) as unknown as PlanetScan;

describe("the key, which the builder and the reader share", () => {
  it("lands EDSM's spelling and the journal's on the same token", () => {
    /*
      THE ONE THAT MATTERS. The table is built from EDSM's wording — "High metal content world",
      "Thin Carbon dioxide", "Major Water Magma" — and read with the journal's — "High metal content
      body", "CarbonDioxide", "major water magma volcanism". They have never matched by accident, and
      when the likelihood's own buckets did not, the terms scored nothing on most bodies for months.
    */
    expect(bodyTypePlanetClass("High metal content world")).toBe(
      bodyTypePlanetClass("High metal content body"),
    );
    expect(bodyTypePlanetClass("Rocky Ice world")).toBe(bodyTypePlanetClass("Rocky ice body"));
    expect(bodyTypePlanetClass("Metal-rich body")).toBe(bodyTypePlanetClass("Metal rich body"));
    expect(bodyTypeAtmosphere("Thin Carbon dioxide")).toBe(bodyTypeAtmosphere("CarbonDioxide"));
    expect(bodyTypeAtmosphere("Hot thin Sulphur dioxide")).toBe(bodyTypeAtmosphere("SulphurDioxide"));
    expect(bodyTypeAtmosphere("Thin Neon-rich")).toBe(bodyTypeAtmosphere("NeonRich"));
    expect(bodyTypeVolcanism("Major Water Magma")).toBe(bodyTypeVolcanism("major water magma volcanism"));
    expect(bodyTypeVolcanism("No volcanism")).toBe(bodyTypeVolcanism(""));
  });

  it("does not fold two facts that are genuinely different", () => {
    // A fold loose enough to make everything agree would pass the case above and destroy the prior.
    expect(bodyTypePlanetClass("Rocky body")).not.toBe(bodyTypePlanetClass("Rocky ice body"));
    expect(bodyTypePlanetClass("High metal content body")).not.toBe(bodyTypePlanetClass("Metal rich body"));
    expect(bodyTypeAtmosphere("CarbonDioxide")).not.toBe(bodyTypeAtmosphere("SulphurDioxide"));
    expect(bodyTypeVolcanism("Major Water Magma")).not.toBe(bodyTypeVolcanism("Minor Nitrogen Magma"));
  });

  it("bands temperature on the edges the sweep chose", () => {
    /*
      `[100, 160, 185, 300]`. The corpus is piled at two spikes — 72.8 % of bodies between 150 K and
      200 K — so the obvious [100, 200, 300] put three quarters of everything in one cell and the
      term said nothing on most bodies. 300 stays an edge because it is where tela's rule turns over.
    */
    expect(BODY_TYPE_T_EDGES).toEqual([100, 160, 185, 300]);
    expect(bodyTypeTemperature(52)).toBe("a");
    expect(bodyTypeTemperature(176)).toBe("c"); // inside the spike, and split from its neighbours
    expect(bodyTypeTemperature(192)).toBe("d");
    expect(bodyTypeTemperature(420)).toBe("e");
    expect(bodyTypeTemperature(null)).toBe("?");
  });

  it("offers the levels finest first", () => {
    const keys = bodyTypeKeys(
      scan({
        PlanetClass: "Icy body",
        AtmosphereType: "Neon",
        SurfaceTemperature: 52,
        Volcanism: "major water magma volcanism",
      }),
    );
    expect(keys[0]).toBe("icy|neon|watermagma|a");
    expect(keys[1]).toBe("icy|neon|watermagma");
    expect(keys[2]).toBe("icy|neon|volc");
    expect(keys[3]).toBe("icy|neon");
    expect(keys[4]).toBe("neon");
  });
});

describe("the shipped table", () => {
  it("is present and answers on a body the corpus knows well", () => {
    const table = loadBodyTypePrior(root);
    expect(table, "run scripts/build-body-type-prior.ts").not.toBeNull();
    const hot = scan({
      PlanetClass: "High metal content body",
      AtmosphereType: "SulphurDioxide",
      SurfaceTemperature: 400,
      Volcanism: "",
    });
    const tela = bodyTypeLogPrior(hot, "bacterium_bacterium_tela", root);
    expect(tela).not.toBeNull();
    // Hot thin sulphur dioxide is where tela lives; the cell has to say so far louder than its
    // galaxy-wide 1.6 %.
    expect(Math.exp(tela!.logShare)).toBeGreaterThan(0.2);
  });

  it("says nothing rather than guessing when no level has enough bodies", () => {
    // A body class the corpus has never met. Null is "no opinion", and the caller keeps the
    // galaxy-wide prior — it is never read as "the species is absent".
    const odd = scan({
      PlanetClass: "Supermassive black hole",
      AtmosphereType: "Bananas",
      SurfaceTemperature: 9000,
    });
    expect(bodyTypeLogPrior(odd, "bacterium_bacterium_tela", root)).toBeNull();
  });

  it("falls through to a coarser cell rather than trusting a thin one", () => {
    const body = scan({
      PlanetClass: "Icy body",
      AtmosphereType: "Neon",
      SurfaceTemperature: 52,
      Volcanism: "minor nitrogen magma volcanism",
    });
    const hit = bodyTypeLogPrior(body, "bacterium_bacterium_acies", root, 10_000);
    // With an impossible floor nothing is trusted at all, which is the honest end of the ladder.
    expect(hit).toBeNull();
  });

  it("returns null everywhere when the table is missing, so the app ranks as it did before", () => {
    expect(
      bodyTypeLogPrior(scan({ PlanetClass: "Rocky body" }), "bacterium_bacterium_tela", "/no/such/root"),
    ).toBeNull();
  });
});

describe("the settings the sweep chose", () => {
  it("pins the weight and the cell floor", () => {
    /*
      Both were swept on the owner's cache, 664 ranked species over 2,066 rows. The floor barely
      moved the headline, and the smaller one keeps the finest level answering on body types the
      corpus has met only a few dozen times.

      The weight is **not** the top of that sweep. Full weight takes the most top-3 and 0.75 the most
      top-1; 0.4 is the largest value at which the model still agrees with both of the owner's own
      landings — acies on his neon moon, verrata on water magma — and it is his call, 2026-09-21.
      Raising it is a decision about whose evidence wins, not a tuning step.

      A re-tune is a deliberate edit here as well as there.
    */
    expect(BODY_TYPE_PRIOR_WEIGHT).toBe(0.4);
    expect(MIN_CELL).toBe(10);
  });
});
