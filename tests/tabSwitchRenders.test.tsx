// @vitest-environment jsdom
/**
 * The first tab switch after a start was slow (owner, 2026-10-09): the header, which holds every screen,
 * read the whole tab state, so each switch rendered it and every open screen again (95-425 ms a switch
 * in the dev build, 2-6 ms after). A screen's open state and its slot read only their own slice.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { tabStore } from "../src/client/tabs/tabStore.js";
import { TabSlot, useScreenOpen } from "../src/client/tabs/TabHost.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  localStorage.clear();
  tabStore.resetForTests();
});

describe("switching tabs", () => {
  it("does not render a screen's owner or its slot again", () => {
    let owner = 0;
    let screen = 0;
    function Screen() {
      screen++;
      return <p>boxels</p>;
    }
    function Owner() {
      owner++;
      const [open] = useScreenOpen("boxels");
      return open ? (
        <TabSlot kind="boxels">
          <Screen />
        </TabSlot>
      ) : null;
    }
    const pane = document.createElement("div");
    document.body.append(pane);
    const root = createRoot(document.createElement("div"));
    act(() => {
      tabStore.open("boxels");
      tabStore.open("galaxy");
      tabStore.setPane("boxels", pane);
      root.render(<Owner />);
    });
    expect(pane.textContent).toBe("boxels");
    const [o, s] = [owner, screen];

    act(() => tabStore.activate("boxels"));
    act(() => tabStore.activate("main"));
    act(() => tabStore.activate("galaxy"));
    expect([owner, screen]).toEqual([o, s]);

    // Closing it still reaches the owner.
    act(() => tabStore.close("boxels"));
    expect(owner).toBe(o + 1);
    expect(pane.textContent).toBe("");
    act(() => root.unmount());
  });
});
