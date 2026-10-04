/// <reference lib="webworker" />
/**
 * Draws the Milky Way backdrop off the main thread (galaxyClouds.ts; regionBackdrop.ts asks).
 */
import { renderGalaxyClouds, type CloudFrame } from "@shared/galaxyClouds";

self.onmessage = (ev: MessageEvent<CloudFrame>) => {
  const px = renderGalaxyClouds(ev.data);
  (self as unknown as Worker).postMessage(px.buffer, [px.buffer]);
};
