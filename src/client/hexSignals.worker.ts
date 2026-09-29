/// <reference lib="webworker" />
/**
 * Draws the hex-grid signals off the main thread (HexSignals.tsx hands it the OffscreenCanvas).
 */
import { runHexSignals, type HexSignalsHandle } from "./hexSignalsEngine";

type Msg =
  | { type: "start"; canvas: OffscreenCanvas; w: number; h: number; dpr: number }
  | { type: "resize"; w: number; h: number; dpr: number }
  | { type: "stop" };

let handle: HexSignalsHandle | null = null;

self.onmessage = (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.type === "start") {
    handle = runHexSignals(m.canvas, m, (w, h) => new OffscreenCanvas(w, h));
  } else if (m.type === "resize") {
    handle?.resize(m.w, m.h, m.dpr);
  } else {
    handle?.stop();
    handle = null;
  }
};
