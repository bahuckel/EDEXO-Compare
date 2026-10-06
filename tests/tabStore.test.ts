// @vitest-environment jsdom
/**
 * Tab view's store (src/client/tabs/tabStore.ts; owner, 2026-10-06): one tab per screen, closing brings
 * the neighbour forward, the strip can be reordered, and the switch and the tabs are remembered.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { tabStore } from "../src/client/tabs/tabStore.js";

beforeEach(() => {
  localStorage.clear();
  tabStore.resetForTests();
});

describe("tab view", () => {
  it("opens one tab per screen and brings it to the front", () => {
    tabStore.open("boxels");
    tabStore.open("encyclopedia");
    tabStore.open("boxels");
    expect(tabStore.get()).toMatchObject({ tabs: ["boxels", "encyclopedia"], active: "boxels" });
  });

  it("closing the tab in front brings its left neighbour forward, then Main", () => {
    tabStore.open("boxels");
    tabStore.open("galaxy");
    tabStore.close("galaxy");
    expect(tabStore.get().active).toBe("boxels");
    tabStore.close("boxels");
    expect(tabStore.get()).toMatchObject({ tabs: [], active: "main" });
  });

  it("moves a tab within the strip", () => {
    tabStore.open("boxels");
    tabStore.open("galaxy");
    tabStore.open("stats");
    tabStore.move("stats", 0);
    expect(tabStore.get().tabs).toEqual(["stats", "boxels", "galaxy"]);
  });

  it("remembers the switch, the tabs and the one in front", () => {
    tabStore.open("poi");
    tabStore.open("carriers");
    tabStore.activate("poi");
    expect(JSON.parse(localStorage.getItem("edexo.tabs")!)).toEqual({
      tabs: ["poi", "carriers"],
      active: "poi",
    });
    tabStore.setOn(false);
    expect(localStorage.getItem("edexo.tabView")).toBe("0");
    expect(tabStore.get()).toMatchObject({ on: false, active: "main" });
  });
});
