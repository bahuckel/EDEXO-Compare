// @vitest-environment jsdom
/**
 * The HUD's socket comes back (combined plan 1.3, Phase 6 test): after a server restart or a phone's
 * Wi-Fi drop it reconnects with a back-off of 1 s doubling to 10 s, reset once a socket opens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadHudModule } from "./helpers/loadHud.js";

type HudApi = { mount: (names: string[], opts?: { noTimers?: boolean }) => HTMLElement };

class FakeSocket {
  static made: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeSocket.made.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.onclose?.();
  }
}

describe("HUD socket", () => {
  beforeEach(() => {
    FakeSocket.made = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    // The 5 s fallback poll: never answers, which is all this test needs of it.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks for the HUD channel, and reconnects with a doubling back-off reset by a good connection", async () => {
    const HUD = await loadHudModule<HudApi>();
    HUD.mount(["distance"]);
    expect(FakeSocket.made).toHaveLength(1);
    expect(FakeSocket.made[0]!.url).toMatch(/\/ws\?channel=hud$/);

    // Dropped before it ever opened: retry after 1 s, then 2 s.
    FakeSocket.made[0]!.close();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.made).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.made).toHaveLength(2);
    FakeSocket.made[1]!.close();
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.made).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.made).toHaveLength(3);

    // A socket that opens says hello and resets the back-off to 1 s.
    const s = FakeSocket.made[2]!;
    s.onopen?.();
    expect(JSON.parse(s.sent[0]!)).toEqual({ type: "hello", channel: "hud" });
    s.close();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.made).toHaveLength(4);
  });

  it("never waits more than 10 s between tries", async () => {
    const HUD = await loadHudModule<HudApi>();
    HUD.mount(["distance"]);
    // 1, 2, 4, 8, then 10 s every time.
    for (const wait of [1000, 2000, 4000, 8000, 10_000, 10_000]) {
      const n = FakeSocket.made.length;
      FakeSocket.made[n - 1]!.close();
      vi.advanceTimersByTime(wait - 1);
      expect(FakeSocket.made).toHaveLength(n);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.made).toHaveLength(n + 1);
    }
  });
});
