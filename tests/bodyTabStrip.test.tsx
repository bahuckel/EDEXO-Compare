// @vitest-environment jsdom
/**
 * The body tab strip and the live push (plan 2.2, O-16 + F-C7): every snapshot push hands the strip a
 * new `sections` array. That re-ran `scrollIntoView` on the selected tab, which scrolls the *page* to
 * the strip as well — a commander reading a species card further down was yanked back up ten times a
 * second — and tore down and re-added the strip's scroll / resize listeners each time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BodyTabStrip, type TabSection } from "../src/client/BodyTabStrip";
import type { BodyComputed } from "../src/shared/types";

let root: Root | null = null;
let host: HTMLDivElement;

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  // jsdom has no CSS.escape; the keys here need none.
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const body = (key: string, label: string) =>
  ({
    state: { key, bodyName: label, bodyId: 1, biologicalSignals: 2, organicGenusLocks: [], confirmedVariants: [] },
    tabLabel: label,
    matches: [],
  }) as unknown as BodyComputed;

/** A fresh array every call, as each push delivers. */
const sections = (keys: string[]): TabSection[] => [
  { key: "all", label: null, hostCards: keys.map((k) => [body(k, `Body ${k}`)]) },
];

function render(keys: string[], selected: string | null) {
  act(() => {
    root!.render(
      <BodyTabStrip
        sections={sections(keys)}
        selectedBodyKey={selected}
        onSelect={() => {}}
        onOpenJump={() => {}}
        bodyCount={keys.length}
        sortMode="system"
        onSortChange={() => {}}
        proximity={null}
      />,
    );
  });
}

describe("body tab strip under live pushes", () => {
  it("never scrolls the page, and keeps the selected tab in view inside the strip only", () => {
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;
    render(["1:1", "1:2", "1:3"], "1:3");
    const strip = document.querySelector<HTMLElement>(".tabs-strip")!;
    const tab = document.querySelector<HTMLElement>('[data-body-key="1:3"]')!;
    // jsdom has no layout: give the strip a 100 px window and put the tab past its right edge.
    strip.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 30, width: 100, height: 30 }) as DOMRect;
    tab.getBoundingClientRect = () => ({ left: 180, right: 240, top: 0, bottom: 30, width: 60, height: 30 }) as DOMRect;
    render(["1:1", "1:2", "1:3", "1:4"], "1:3");
    expect(intoView).not.toHaveBeenCalled();
    expect(strip.scrollLeft).toBe(140);
  });

  it("subscribes its listeners once, not on every push", () => {
    const add = vi.spyOn(window, "addEventListener");
    const resizes = () => add.mock.calls.filter((c) => (c[0] as string) === "resize").length;
    render(["1:1", "1:2"], "1:1");
    const first = resizes();
    for (let i = 0; i < 5; i++) render(["1:1", "1:2"], "1:1");
    expect(resizes()).toBe(first);
  });
});
