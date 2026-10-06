/**
 * The one spelling the game varies (src/shared/spelling.ts, owner 2026-10-06): sulfur and sulphur
 * read the same wherever atmosphere, material or geology text is compared.
 */
import { describe, expect, it } from "vitest";
import { foldSpelling } from "../src/shared/spelling.js";
import { atmosphereKey } from "../src/server/genusBodySplit.js";
import { atmosphereCompositionKey } from "../src/shared/scanAtmosphereMatch.js";
import { atmospherePillStyle } from "../src/client/planetDisplayUtils.js";

describe("sulfur and sulphur", () => {
  it("folds to sulphur, keeping a capital", () => {
    expect(foldSpelling("thin sulfur dioxide atmosphere")).toBe("thin sulphur dioxide atmosphere");
    expect(foldSpelling("Thin Sulfur dioxide")).toBe("Thin Sulphur dioxide");
    expect(foldSpelling("SulphurDioxide")).toBe("SulphurDioxide");
  });

  it("keys and colours an atmosphere the same in either spelling", () => {
    expect(atmosphereKey("Thin Sulfur dioxide")).toBe(atmosphereKey("Thin Sulphur dioxide"));
    expect(atmosphereKey("Thin Sulphur dioxide")).toBe(atmosphereKey("SulphurDioxide"));
    expect(atmosphereCompositionKey("Sulfur dioxide")).toBe(atmosphereCompositionKey("SulphurDioxide"));
    // The pill's yellow (255, 213, 79; tinted by the text's length, the blue channel stays 79), not the
    // first colour of the list (argon), which an unmatched "Sulphur" fell back to.
    for (const t of ["Thin Sulphur dioxide", "thin sulfur dioxide atmosphere"]) {
      expect(String(atmospherePillStyle(t).borderColor)).toMatch(/,79\)$/);
    }
  });
});
