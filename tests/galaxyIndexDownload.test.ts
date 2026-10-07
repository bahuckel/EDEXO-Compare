/**
 * The galaxy index as a separate download (owner, 2026-10-04, plan 4.2): it lands beside the settings,
 * a cut download never looks like an index, and the downloaded copy wins over the project's.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  downloadGalaxyIndex,
  galaxyIndexFilePath,
  galaxyIndexStatus,
  probeGalaxyIndexSize,
} from "../src/server/galaxyIndexFiles.js";

let dir: string;
let before: string | undefined;
beforeEach(() => {
  before = process.env.EDEXO_USER_DATA_DIR;
  dir = mkdtempSync(path.join(os.tmpdir(), "edexo-gidx-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
});
afterEach(() => {
  if (before === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = before;
  rmSync(dir, { recursive: true, force: true });
});

const serve = (failOn?: string) =>
  (async (url: string) => {
    const name = String(url).split("/").pop()!;
    if (name === failOn) return new Response("nope", { status: 404 });
    const body = new TextEncoder().encode(`index:${name}`);
    return new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
  }) as unknown as typeof fetch;

describe("the galaxy index download", () => {
  it("lands both files beside the settings, and they win over the project's copies", async () => {
    let done = 0;
    await downloadGalaxyIndex(() => (done += 1), serve());
    expect(done).toBe(1);
    const p = galaxyIndexFilePath("bio-index.bin");
    expect(p.startsWith(dir)).toBe(true);
    expect(readFileSync(p, "utf8")).toBe("index:bio-index.bin");
    expect(readFileSync(galaxyIndexFilePath("system-traits.bin.gz"), "utf8")).toBe("index:system-traits.bin.gz");
    const st = galaxyIndexStatus();
    expect(st.present).toBe(true);
    expect(st.downloading).toBeNull();
    expect(st.error).toBeNull();
  });

  it("a failed file leaves no half file and says why", async () => {
    let done = 0;
    await downloadGalaxyIndex(() => (done += 1), serve("system-traits.bin.gz"));
    expect(done).toBe(0);
    expect(galaxyIndexStatus().error).toMatch(/system-traits\.bin\.gz: HTTP 404/);
    expect(galaxyIndexFilePath("system-traits.bin.gz").startsWith(dir)).toBe(false);
  });

  // Owner, 2026-10-07: with an index here the map offered no download at all; now it says when the release differs.
  it("says when the release holds other files than the ones here", async () => {
    await downloadGalaxyIndex(() => {}, serve());
    const sized = (n: number) =>
      (async () => new Response(null, { status: 200, headers: { "content-length": String(n) } })) as unknown as typeof fetch;
    await probeGalaxyIndexSize(sized("index:bio-index.bin".length));
    expect(galaxyIndexStatus().updateAvailable).toBe(true); // the traits file differs in size
    const same = (async (url: string) => {
      const n = `index:${String(url).split("/").pop()}`.length;
      return new Response(null, { status: 200, headers: { "content-length": String(n) } });
    }) as unknown as typeof fetch;
    await probeGalaxyIndexSize(same);
    expect(galaxyIndexStatus().updateAvailable).toBe(false);
  });
});
