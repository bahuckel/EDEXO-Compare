/**
 * The test run's %TEMP% sweep: earlier runs' leftovers go, anything else stays.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sweepTestLeftovers } from "./setup/globalTmp.js";

describe("sweepTestLeftovers", () => {
  it("removes old run folders and old mkdtemp folders, and keeps the rest", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sweep-"));
    try {
      const now = Date.now();
      const make = (name: string, ageDays: number, file = false) => {
        const p = path.join(dir, name);
        if (file) writeFileSync(p, "");
        else mkdirSync(p);
        const t = new Date(now - ageDays * 86_400_000);
        utimesSync(p, t, t);
        return p;
      };
      const gone = [make("edexo-test-run-Ab12Cd", 2), make("edexo-test-userdata-x9Y8z7", 2), make("edexo-replay-tegnae", 8)];
      const kept = [
        make("edexo-test-run-Zz11Yy", 0.1), // this run, or one still going
        make("edexo-replay-QQ12ww", 3), // a mkdtemp folder, but under a week old
        make("edexo-dev-profile", 30), // the dev server's profile
        make("edexo-e2e-profile", 30),
        make("edexo-engine-v1.2.11-zip", 30), // another tool's
        make("EDExoPortable", 30), // the portable app's unpack folder
        make("edexo-test-run-Ab12Cd.log", 30, true), // a file, not a folder
      ];
      expect(sweepTestLeftovers(dir, now)).toBe(3);
      for (const p of gone) expect(existsSync(p)).toBe(false);
      for (const p of kept) expect(existsSync(p)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
