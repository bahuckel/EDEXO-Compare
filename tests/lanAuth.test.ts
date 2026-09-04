import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import {
  createLanAuthGuard,
  generateLanKey,
  isLoopbackAddress,
  keysMatch,
  LAN_KEY_COOKIE,
  lanUrlWithKey,
  loadOrCreateLanKey,
  parseCookieHeader,
  readLanKeyFromRequest,
  requestIsAuthorized,
} from "../src/server/lanAuth.js";

function req(over: {
  url?: string;
  remoteAddress?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  return {
    url: over.url ?? "/",
    headers: over.headers ?? {},
    socket: { remoteAddress: over.remoteAddress ?? "192.168.1.50" },
  } as unknown as IncomingMessage;
}

describe("isLoopbackAddress", () => {
  it("accepts every form Node reports for this machine", () => {
    for (const a of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1", "::FFFF:127.0.0.1"]) {
      expect(isLoopbackAddress(a)).toBe(true);
    }
  });

  it("rejects LAN and public addresses, and an unknown one", () => {
    for (const a of ["192.168.1.50", "10.0.0.2", "8.8.8.8", "::ffff:192.168.1.50", "", null, undefined]) {
      expect(isLoopbackAddress(a)).toBe(false);
    }
  });
});

describe("keysMatch", () => {
  it("is true only for an exact match", () => {
    expect(keysMatch("abcdef", "abcdef")).toBe(true);
    expect(keysMatch("abcdef", "abcdeg")).toBe(false);
    expect(keysMatch("abcdef", "abcde")).toBe(false);
    expect(keysMatch("abcdef", "")).toBe(false);
    expect(keysMatch(null, null)).toBe(false);
    expect(keysMatch(undefined, "abc")).toBe(false);
  });
});

describe("parseCookieHeader", () => {
  it("reads a key out of a normal cookie header", () => {
    expect(parseCookieHeader(`a=1; ${LAN_KEY_COOKIE}=secret; b=2`)[LAN_KEY_COOKIE]).toBe("secret");
  });

  it("decodes percent-encoding and keeps the first of a repeated name", () => {
    expect(parseCookieHeader("x=a%20b").x).toBe("a b");
    expect(parseCookieHeader("x=first; x=second").x).toBe("first");
  });

  it("survives junk", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader("")).toEqual({});
    expect(parseCookieHeader("novalue")).toEqual({});
    expect(parseCookieHeader("=nokey")).toEqual({});
  });
});

describe("readLanKeyFromRequest", () => {
  it("prefers the query string, and says so", () => {
    const r = readLanKeyFromRequest(
      req({ url: "/?k=fromquery", headers: { cookie: `${LAN_KEY_COOKIE}=fromcookie` } }),
    );
    expect(r).toEqual({ key: "fromquery", fromQuery: true });
  });

  it("falls back to the header, then the cookie", () => {
    expect(readLanKeyFromRequest(req({ headers: { "x-edexo-lan-key": "h" } }))).toEqual({
      key: "h",
      fromQuery: false,
    });
    expect(readLanKeyFromRequest(req({ headers: { cookie: `${LAN_KEY_COOKIE}=c` } }))).toEqual({
      key: "c",
      fromQuery: false,
    });
    expect(readLanKeyFromRequest(req({})).key).toBeNull();
  });
});

describe("requestIsAuthorized", () => {
  const KEY = "s3cret-key-value";

  it("lets this PC through with no key at all", () => {
    expect(requestIsAuthorized(req({ remoteAddress: "127.0.0.1" }), KEY)).toBe(true);
    expect(requestIsAuthorized(req({ remoteAddress: "::1" }), KEY)).toBe(true);
  });

  it("refuses a LAN client with no key, a wrong key, or a truncated one", () => {
    expect(requestIsAuthorized(req({}), KEY)).toBe(false);
    expect(requestIsAuthorized(req({ url: "/?k=wrong" }), KEY)).toBe(false);
    expect(requestIsAuthorized(req({ url: `/?k=${KEY.slice(0, -1)}` }), KEY)).toBe(false);
  });

  it("admits a LAN client presenting the key any of the three ways", () => {
    expect(requestIsAuthorized(req({ url: `/?k=${KEY}` }), KEY)).toBe(true);
    expect(requestIsAuthorized(req({ headers: { "x-edexo-lan-key": KEY } }), KEY)).toBe(true);
    expect(requestIsAuthorized(req({ headers: { cookie: `${LAN_KEY_COOKIE}=${KEY}` } }), KEY)).toBe(true);
  });

  it("is wide open when no key is configured — a loopback-only bind", () => {
    expect(requestIsAuthorized(req({}), null)).toBe(true);
  });
});

describe("lanUrlWithKey", () => {
  it("appends the key to a bare LAN origin", () => {
    expect(lanUrlWithKey("http://192.168.1.10:7111", "abc")).toBe("http://192.168.1.10:7111/?k=abc");
  });

  it("returns the URL untouched when there is no key", () => {
    expect(lanUrlWithKey("http://192.168.1.10:7111", null)).toBe("http://192.168.1.10:7111");
  });

  it("escapes a key that needs it", () => {
    expect(lanUrlWithKey("http://10.0.0.2:7111", "a+b/c")).toContain("k=a%2Bb%2Fc");
  });
});

describe("loadOrCreateLanKey", () => {
  it("mints a key, stores it, and returns the same one next time", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "edexo-lan-"));
    const file = path.join(dir, "lan-key.txt");
    const first = loadOrCreateLanKey(file);
    expect(first.length).toBeGreaterThanOrEqual(16);
    expect(readFileSync(file, "utf8").trim()).toBe(first);
    expect(loadOrCreateLanKey(file)).toBe(first);
  });

  it("replaces a stored value too short to be a key", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "edexo-lan-"));
    const file = path.join(dir, "lan-key.txt");
    writeFileSync(file, "short\n", "utf8");
    expect(loadOrCreateLanKey(file)).not.toBe("short");
  });

  it("generates a different key every time", () => {
    const keys = new Set(Array.from({ length: 25 }, () => generateLanKey()));
    expect(keys.size).toBe(25);
  });
});

/** Minimal stand-ins for the bits of Express's req/res the guard touches. */
type GuardResult = {
  nextCalled: boolean;
  status: number | null;
  body: unknown;
  headers: Record<string, string>;
  redirectedTo: string | null;
};

function runGuard(
  lanKey: string | null,
  over: { url?: string; method?: string; remoteAddress?: string; headers?: Record<string, string> },
): GuardResult {
  const out: GuardResult = {
    nextCalled: false,
    status: null,
    body: undefined,
    headers: {},
    redirectedTo: null,
  };
  const req = {
    url: over.url ?? "/",
    originalUrl: over.url ?? "/",
    method: over.method ?? "GET",
    headers: over.headers ?? {},
    socket: { remoteAddress: over.remoteAddress ?? "192.168.1.50" },
  };
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    type() {
      return this;
    },
    send(b: unknown) {
      out.body = b;
      return this;
    },
    json(b: unknown) {
      out.body = b;
      return this;
    },
    setHeader(name: string, value: string) {
      out.headers[name.toLowerCase()] = value;
    },
    redirect(code: number, location: string) {
      out.status = code;
      out.redirectedTo = location;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createLanAuthGuard(lanKey)(req as any, res as any, () => {
    out.nextCalled = true;
  });
  return out;
}

describe("createLanAuthGuard", () => {
  const KEY = "s3cret-key-value";

  it("passes everything through when no key is configured", () => {
    expect(runGuard(null, {}).nextCalled).toBe(true);
  });

  it("passes loopback through untouched", () => {
    const r = runGuard(KEY, { remoteAddress: "127.0.0.1" });
    expect(r.nextCalled).toBe(true);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });

  it("answers an unpaired API call with 401 JSON and never calls next", () => {
    const r = runGuard(KEY, { url: "/api/status" });
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "lan_key_required" });
  });

  it("answers an unpaired page load with a 401 page that explains the key", () => {
    const r = runGuard(KEY, { url: "/", headers: { accept: "text/html" } });
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(401);
    expect(String(r.body)).toContain("Access key required");
  });

  it("refuses a mutating call from a LAN client with no key", () => {
    const r = runGuard(KEY, { url: "/api/exobiology/reset", method: "POST" });
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(401);
  });

  it("pairs a browser on the ?k= link: sets the cookie and redirects the key out of the URL", () => {
    const r = runGuard(KEY, { url: `/?k=${KEY}`, headers: { accept: "text/html" } });
    expect(r.status).toBe(302);
    expect(r.redirectedTo).toBe("/");
    expect(r.headers["set-cookie"]).toContain(`${LAN_KEY_COOKIE}=${KEY}`);
    expect(r.headers["set-cookie"]).toContain("HttpOnly");
    expect(r.nextCalled).toBe(false);
  });

  it("keeps the rest of the query string when it redirects", () => {
    const r = runGuard(KEY, { url: `/launcher.html?k=${KEY}&tab=map`, headers: { accept: "text/html" } });
    expect(r.redirectedTo).toBe("/launcher.html?tab=map");
  });

  it("serves an XHR that carries ?k= directly, without redirecting it", () => {
    const r = runGuard(KEY, { url: `/api/state?k=${KEY}` });
    expect(r.nextCalled).toBe(true);
    expect(r.redirectedTo).toBeNull();
    expect(r.headers["set-cookie"]).toBeTruthy();
  });

  it("serves a paired browser straight through on its cookie", () => {
    const r = runGuard(KEY, { url: "/api/state", headers: { cookie: `${LAN_KEY_COOKIE}=${KEY}` } });
    expect(r.nextCalled).toBe(true);
    expect(r.status).toBeNull();
  });
});
