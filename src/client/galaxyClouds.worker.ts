/// <reference lib="webworker" />
/**
 * Draws the Milky Way off the main thread (galaxyClouds.ts; regionBackdrop.ts asks): the flat picture
 * for the classic map, or the 3D clouds for the galaxy map.
 */
import { galaxyCloudSprites, renderGalaxyClouds, type CloudFrame } from "@shared/galaxyClouds";

type Ask = CloudFrame | { frame: CloudFrame; sprites: { emission: number; dust: number } };

self.onmessage = (ev: MessageEvent<Ask>) => {
  const ask = ev.data;
  if ("sprites" in ask) {
    const n = ask.frame.width * ask.frame.height;
    const clear = new Uint8ClampedArray(n * 4);
    const dust = new Float32Array(n);
    renderGalaxyClouds(ask.frame, { clear, dust });
    const out = galaxyCloudSprites(ask.frame, clear, dust, ask.sprites);
    (self as unknown as Worker).postMessage(out.buffer, [out.buffer]);
    return;
  }
  const px = renderGalaxyClouds(ask);
  (self as unknown as Worker).postMessage(px.buffer, [px.buffer]);
};
