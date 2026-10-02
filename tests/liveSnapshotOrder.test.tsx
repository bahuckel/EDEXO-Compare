// @vitest-environment jsdom
/**
 * `useLiveSnapshot` and a slow `/api/state` (plan 2.2, O-17 + F-9.3): the full fetch at start-up (or
 * from the 10 s backup check) can answer after the WebSocket has already delivered a newer push. It
 * used to be applied anyway — the screen went back to older data until the next push — and it moved
 * the client's revision back, so the backup check fetched again for nothing. And a socket that keeps
 * failing was retried every 1.1 s for ever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLiveSnapshot } from "../src/client/useLiveSnapshot";
import type { AppSnapshot } from "../src/shared/types";

class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(rev: number, tag: string) {
    this.onmessage?.({ data: JSON.stringify({ type: "state", rev, payload: { tag } }) });
  }
  fail() {
    this.readyState = 3;
    this.onclose?.();
  }
  close() {
    this.readyState = 3;
  }
}

let root: Root | null = null;
let seen: (AppSnapshot | null)[] = [];
let answerFetch: ((rev: number, tag: string) => Promise<void>) | null = null;

function Probe() {
  const { snapshot } = useLiveSnapshot();
  seen.push(snapshot);
  return null;
}
const tag = () => (seen.at(-1) as unknown as { tag?: string } | null)?.tag;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  FakeSocket.all = [];
  seen = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((resolve) => {
          answerFetch = async (rev, t) => {
            resolve({ headers: new Headers({ "X-Edexo-Rev": String(rev) }), text: async () => JSON.stringify({ tag: t }) });
            await vi.runOnlyPendingTimersAsync();
          };
        }),
    ),
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Probe />));
});
afterEach(() => {
  act(() => root?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("live snapshot ordering", () => {
  it("drops a full fetch that answers after a newer push", async () => {
    const ws = FakeSocket.all[0]!;
    act(() => {
      ws.open();
      ws.push(5, "push-5");
    });
    expect(tag()).toBe("push-5");
    // The start-up fetch was asked before push 5 and answers with revision 4.
    await act(() => answerFetch!(4, "fetch-4"));
    expect(tag()).toBe("push-5");
  });

  it("takes a fetch that is as new as the last push or newer", async () => {
    const ws = FakeSocket.all[0]!;
    act(() => {
      ws.open();
      ws.push(5, "push-5");
    });
    await act(() => answerFetch!(6, "fetch-6"));
    expect(tag()).toBe("fetch-6");
  });

  it("after the socket drops (a server restart starts counting again), a lower revision is taken", async () => {
    const ws = FakeSocket.all[0]!;
    act(() => {
      ws.open();
      ws.push(50, "push-50");
      ws.fail();
    });
    await act(() => answerFetch!(1, "fetch-1"));
    expect(tag()).toBe("fetch-1");
  });

  it("backs off when the socket keeps failing, and starts over once it connects", () => {
    const gaps: number[] = [];
    let at = Date.now();
    for (let i = 0; i < 6; i++) {
      const before = FakeSocket.all.length;
      act(() => FakeSocket.all.at(-1)!.fail());
      let waited = 0;
      while (FakeSocket.all.length === before && waited < 60_000) {
        act(() => vi.advanceTimersByTime(100));
        waited += 100;
      }
      gaps.push(Date.now() - at);
      at = Date.now();
    }
    expect(gaps[0]).toBeLessThanOrEqual(1200);
    expect(gaps.at(-1)!).toBeGreaterThan(gaps[0]! * 4);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(10_000);
    act(() => {
      FakeSocket.all.at(-1)!.open();
      FakeSocket.all.at(-1)!.fail();
    });
    const before = FakeSocket.all.length;
    act(() => vi.advanceTimersByTime(1200));
    expect(FakeSocket.all.length).toBe(before + 1);
  });
});
