/**
 * @vitest-environment jsdom
 *
 * The windowed table with rows of different heights (owner, 2026-10-10: "when I scroll fast up and
 * down in the boxel screen, everything in it disappears"). The Boxels table's rows wrap (32-90 px);
 * the table measured one height off the first drawn row, every scroll drew a different first row,
 * and the height/window loop hit React's update limit, which unmounted the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { Table } from "../src/client/DiscoveriesTables";

type Row = { n: number };
const ROWS: Row[] = Array.from({ length: 2000 }, (_, n) => ({ n }));
// Odd rows wrap to three lines, as a Boxels row with a species list does.
const heightOf = (n: number) => (n % 2 ? 90 : 32);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const k = this.dataset?.rowKey;
    const h = k != null ? heightOf(Number(k)) : 0;
    return { x: 0, y: 0, top: 0, left: 0, bottom: h, right: 100, width: 100, height: h, toJSON: () => ({}) };
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("windowed table, rows of different heights", () => {
  it("survives fast scrolling up and down and keeps drawing rows", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() =>
      root.render(
        <Table<Row>
          rows={ROWS}
          columns={[{ key: "n", label: "#", numeric: true, value: (r) => r.n, render: (r) => String(r.n) }]}
          sort={{ key: "n", dir: 1 }}
          onSort={() => {}}
          rowKey={(r) => String(r.n)}
          empty="none"
        />,
      ),
    );
    const vp = host.querySelector<HTMLDivElement>(".disc-table-wrap")!;
    let top = 0;
    Object.defineProperty(vp, "scrollTop", { get: () => top, set: (v: number) => (top = v), configurable: true });
    Object.defineProperty(vp, "clientHeight", { get: () => 400, configurable: true });
    for (let i = 0; i < 200; i++) {
      top = ((i * 7919) % 2000) * 61;
      act(() => {
        vp.dispatchEvent(new Event("scroll"));
      });
    }
    expect(errors.mock.calls.filter((c) => /Maximum update depth/.test(String(c[0])))).toEqual([]);
    expect(host.querySelectorAll("tr[data-row-key]").length).toBeGreaterThan(0);
    // The measured heights placed the spacers: a drawn row's offset follows the real heights above it.
    top = 0;
    act(() => {
      vp.dispatchEvent(new Event("scroll"));
    });
    expect(host.querySelector("tr[data-row-key]")?.getAttribute("data-row-key")).toBe("0");
  });
});
