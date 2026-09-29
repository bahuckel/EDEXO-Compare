/**
 * Can this machine draw the 3D map, and how hard should it try?
 *
 * - No WebGL 2: the map cannot run; the screen offers the Classic map instead.
 * - WebGL through a software renderer (SwiftShader, llvmpipe, Microsoft Basic Render — a missing or
 *   broken graphics driver, which the Linux smoke test met): every point costs CPU time, 5.3 M of them
 *   ~300 ms a frame (G0). "Light" mode: a thinned overview, fewer close-up tiles.
 * - Anything else: full.
 */
export type GraphicsTier = "none" | "light" | "full";

export interface Graphics {
  tier: GraphicsTier;
  renderer: string;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;

export function classifyRenderer(renderer: string): GraphicsTier {
  return SOFTWARE.test(renderer) ? "light" : "full";
}

export function detectGraphics(): Graphics {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return { tier: "none", renderer: "no WebGL 2" };
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { tier: classifyRenderer(renderer), renderer };
  } catch {
    return { tier: "none", renderer: "WebGL unavailable" };
  }
}
