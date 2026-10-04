/**
 * The pages run under a Content-Security-Policy without 'unsafe-inline' for scripts (Phase 6), so
 * no page may carry an inline script or an `on…=` handler attribute: it would silently not run.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY } from "../src/server/csp.js";

const pages = [
  ...readdirSync("public")
    .filter((f) => f.endsWith(".html"))
    .map((f) => path.join("public", f)),
  ...readdirSync(path.join("public", "legal"))
    .filter((f) => f.endsWith(".html"))
    .map((f) => path.join("public", "legal", f)),
  path.join("src", "client", "index.html"),
];

describe("Content-Security-Policy", () => {
  it("allows scripts from this origin only", () => {
    const script = CONTENT_SECURITY_POLICY.split("; ").find((d) => d.startsWith("script-src"));
    expect(script).toBe("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });

  it.each(pages)("%s has no inline script and no on…= handler", (p) => {
    const html = readFileSync(p, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(
      (m) => !/\bsrc=/.test(m[1]!) || m[2]!.trim() !== "",
    );
    expect(inline.map((m) => m[0].slice(0, 80))).toEqual([]);
    expect(html.match(/<[^>]+\son[a-z]+\s*=/gi) ?? []).toEqual([]);
  });
});
