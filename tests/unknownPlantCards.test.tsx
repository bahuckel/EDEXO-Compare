/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UnknownPlantCards } from "../src/client/BodyPane";

describe("the unknown plant cards", () => {
  it("names the genus the scanner found, or says what the signal probably is", () => {
    const html = renderToStaticMarkup(
      <UnknownPlantCards
        slots={[{ genus: "Tussock" }, { genus: null }, { genus: null, maybeBacterium: true }]}
      />,
    );
    expect(html).toContain("Unknown Tussock");
    expect(html).toContain("Unknown plant</strong>");
    expect(html).toContain("Unknown plant — probably Bacterium");
    expect(html.match(/species-card--unknown/g)).toHaveLength(3);
  });
});
