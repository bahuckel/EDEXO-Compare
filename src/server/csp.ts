/**
 * The Content-Security-Policy every page the app serves carries (Phase 6; Fable review 9.5: "No CSP
 * anywhere"). Sent as a header on HTML, so the app, the launcher, the HUD overlays and the legal
 * pages share one policy and the built index.html needs no build step. The Vite dev server does not
 * send it: its React refresh runs inline.
 *
 * - Scripts: this origin only. The launcher's script moved to launcher.js and the overlays' to
 *   hud/boot.js for this; an inline script or an `on…=` attribute no longer runs.
 * - Styles: inline allowed — the launcher's one <style> block and style attributes throughout.
 * - Connections: this origin, its WebSocket, the local API by address (the launcher builds
 *   `http://127.0.0.1:<port>` URLs), and api.ipify.org for the launcher's "show my public address".
 * - Images, media and workers: this origin, plus data: and blob: (snapshots, CSV and JSON exports,
 *   the hex-signals worker).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' ws: wss: http://127.0.0.1:* https://api.ipify.org",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");
