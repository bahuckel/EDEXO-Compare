/// <reference lib="webworker" />
/**
 * Draws the hex-grid glimmer and signals off the main thread (HexSignals.tsx hands it the
 * OffscreenCanvas).
 */
import { runHexSignals, type BackdropOptions, type HexSignalsHandle } from "./hexSignalsEngine";

type Msg =
  | { type: "start"; canvas: OffscreenCanvas; w: number; h: number; dpr: number; opts: BackdropOptions }
  | { type: "resize"; w: number; h: number; dpr: number }
  | { type: "accent"; rgb: string | null }
  | { type: "stop" };

let handle: HexSignalsHandle | null = null;

self.onmessage = (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.type === "start") {
    handle = runHexSignals(m.canvas, m, m.opts);
  } else if (m.type === "resize") {
    handle?.resize(m.w, m.h, m.dpr);
  } else if (m.type === "accent") {
    handle?.setAccent(m.rgb);
  } else {
    handle?.stop();
    handle = null;
  }
};
