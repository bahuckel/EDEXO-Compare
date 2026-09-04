/**
 * Access key for LAN-bound instances.
 *
 * The default bind is `0.0.0.0`, so every device on the network could reach the mutating endpoints
 * — `POST /api/exobiology/reset`, `/api/settings/*`, `/api/ui/view-system`, `/api/exomastery/reload`
 * — with no credential at all. On a home LAN that is mostly a nuisance rather than a breach, but
 * "mostly" is not a security model, and the reset endpoint destroys journal-derived state.
 *
 * The rule here is deliberately narrow:
 *
 *   - loopback is always allowed, so the app on this PC (and Electron) behaves exactly as before;
 *   - every other remote address must present the key, once, and then holds a cookie;
 *   - a client that fails the check gets 401 and never reaches the route handlers or the JSON body
 *     parser, because the guard is the first middleware.
 *
 * The key lives next to the user settings so a phone's bookmark keeps working across restarts.
 * Delete that file to invalidate every paired device.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import type { RequestHandler } from "express";

/** `?k=` in a LAN URL — short, because it is typed by hand off a phone screen often enough. */
export const LAN_KEY_QUERY = "k";
export const LAN_KEY_COOKIE = "edexo_lan_key";
export const LAN_KEY_HEADER = "x-edexo-lan-key";

/** 16 bytes of base64url. Long enough that guessing is hopeless, short enough to retype. */
const LAN_KEY_BYTES = 16;

export function generateLanKey(): string {
  return randomBytes(LAN_KEY_BYTES).toString("base64url");
}

/**
 * Loopback covers IPv4 `127.0.0.0/8`, IPv6 `::1`, and the IPv4-mapped form Node reports on a
 * dual-stack listener (`::ffff:127.0.0.1`).
 */
export function isLoopbackAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const a = addr.trim().toLowerCase();
  if (a === "::1" || a === "::ffff:127.0.0.1") return true;
  const v4 = a.startsWith("::ffff:") ? a.slice("::ffff:".length) : a;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

export function parseCookieHeader(raw: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[name] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/** Constant-time compare; `timingSafeEqual` throws on a length mismatch, which is itself a leak. */
export function keysMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Query string first (the pairing link), then the header (scripts), then the cookie (paired). */
export function readLanKeyFromRequest(req: IncomingMessage): { key: string | null; fromQuery: boolean } {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const q = url.searchParams.get(LAN_KEY_QUERY);
  if (q) return { key: q, fromQuery: true };
  const header = req.headers[LAN_KEY_HEADER];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (headerValue) return { key: headerValue, fromQuery: false };
  const cookie = parseCookieHeader(req.headers.cookie)[LAN_KEY_COOKIE];
  return { key: cookie ?? null, fromQuery: false };
}

export function requestIsAuthorized(req: IncomingMessage, lanKey: string | null): boolean {
  if (!lanKey) return true;
  if (isLoopbackAddress(req.socket?.remoteAddress)) return true;
  return keysMatch(readLanKeyFromRequest(req).key, lanKey);
}

/** `http://192.168.1.10:7111` → `http://192.168.1.10:7111/?k=…`, the form a phone can bookmark. */
export function lanUrlWithKey(baseUrl: string, lanKey: string | null): string {
  if (!lanKey) return baseUrl;
  const u = new URL(baseUrl);
  if (!u.pathname || u.pathname === "") u.pathname = "/";
  u.searchParams.set(LAN_KEY_QUERY, lanKey);
  return u.toString();
}

/**
 * Read the stored key, or mint and store one. Best-effort: if the file cannot be written the key
 * still works for this run, it just will not survive a restart.
 */
export function loadOrCreateLanKey(file: string): string {
  try {
    if (existsSync(file)) {
      const stored = readFileSync(file, "utf8").trim();
      if (stored.length >= 16) return stored;
    }
  } catch {
    /* fall through and mint a new one */
  }
  const key = generateLanKey();
  try {
    writeFileSync(file, `${key}\n`, "utf8");
  } catch {
    /* in-memory only for this run */
  }
  return key;
}

const UNAUTHORIZED_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ED Exo Compare — access key required</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a0d;color:#e8e2da;font:15px/1.5 system-ui,sans-serif}
main{max-width:30rem;padding:1.5rem;border:1px solid rgba(255,106,26,.35);border-radius:10px;background:#12121a}
h1{margin:0 0 .6rem;font-size:1.1rem;color:#ff6a1a}p{margin:.6rem 0}code{color:#ffb27a}</style>
<main><h1>Access key required</h1>
<p>This ED Exo Compare is running on a local network. Devices other than the host PC need the
access key that the launcher shows under <strong>Network settings &rarr; LAN</strong>.</p>
<p>Open the full link from there — it ends in <code>?k=…</code> — and this device stays paired.</p></main>`;

/**
 * Express guard. Pass `null` to disable it entirely (loopback-only binds, where there is nothing
 * to protect against that a local process could not already do).
 */
export function createLanAuthGuard(lanKey: string | null): RequestHandler {
  return (req, res, next) => {
    if (!lanKey) {
      next();
      return;
    }
    if (isLoopbackAddress(req.socket?.remoteAddress)) {
      next();
      return;
    }
    const { key, fromQuery } = readLanKeyFromRequest(req);
    if (!keysMatch(key, lanKey)) {
      res.status(401);
      if (String(req.headers.accept ?? "").includes("text/html")) {
        res.type("text/html; charset=utf-8").send(UNAUTHORIZED_HTML);
      } else {
        res.json({ error: "lan_key_required" });
      }
      return;
    }
    if (fromQuery) {
      // One year: the phone pairs once. Not `Secure` — this is plain HTTP on a home LAN.
      res.setHeader(
        "Set-Cookie",
        `${LAN_KEY_COOKIE}=${encodeURIComponent(lanKey)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`,
      );
      // Redirect the pairing navigation to the clean URL so the key stops riding in the address
      // bar, browser history and any Referer the page later sends.
      if (req.method === "GET" && String(req.headers.accept ?? "").includes("text/html")) {
        const url = new URL(req.originalUrl || req.url || "/", "http://127.0.0.1");
        url.searchParams.delete(LAN_KEY_QUERY);
        res.redirect(302, `${url.pathname}${url.search}`);
        return;
      }
    }
    next();
  };
}
