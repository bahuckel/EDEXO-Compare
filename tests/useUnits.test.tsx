/**
 * @vitest-environment jsdom
 *
 * One temperature unit for the whole app (code review B17, 2026-09-28): a change made in one component
 * shows in every other one at once, and is saved.
 */
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { nextTempUnit, useTempUnit } from "../src/client/useUnits";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the shared temperature unit", () => {
  it("changes everywhere at once and is saved", () => {
    const seen: string[][] = [[], []];
    let setFromFirst: ((u: "K" | "C" | "F" | ((p: "K" | "C" | "F") => "K" | "C" | "F")) => void) | null =
      null;
    function A() {
      const [u, set] = useTempUnit();
      setFromFirst = set;
      seen[0]!.push(u);
      return null;
    }
    function B() {
      const [u] = useTempUnit();
      seen[1]!.push(u);
      return null;
    }
    const el = document.createElement("div");
    const root = createRoot(el);
    act(() =>
      root.render(
        <>
          <A />
          <B />
        </>,
      ),
    );
    const start = seen[1]!.at(-1)!;
    act(() => setFromFirst!(nextTempUnit));
    expect(seen[0]!.at(-1)).toBe(nextTempUnit(start as "K"));
    expect(seen[1]!.at(-1)).toBe(nextTempUnit(start as "K"));
    expect(localStorage.getItem("edexo.bodyTempUnit")).toBe(nextTempUnit(start as "K"));
    act(() => root.unmount());
  });
});
