/**
 * Notable stellar phenomena from EDAstro's codex file (src/server/edastroNsp.ts): the opt-in 855 MB
 * download, read as it streams, keeping only the phenomena (owner, 2026-09-30).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  nearbyNsp,
  nspColumns,
  nspFamilyLabel,
  parseNspLine,
  readNspStatus,
  resetNspMemo,
  resolveNspCachePath,
  startNspDownload,
} from "../src/server/edastroNsp.js";

const HEADER = 'Codex Entry,Codex ID,First Reported,Odyssey,Region,System,X,Y,Z,Main Star Type,"System Address / ID64"';
const CSV = [
  HEADER,
  ",codex_ent_fonticulus_02,,,Inner Orion Spur,10 Canum Venaticorum,-9.375,55.4375,-7,\"F (White) Star\",79196866923",
  'Proto-Lagrange Cloud,codex_ent_gas_clds_light,"2025-09-13 05:57:18",0,Inner Orion Spur,Near One,10,0,0,"K (Yellow-Orange) Star",111',
  // The same entry again (another commander): kept once.
  'Proto-Lagrange Cloud,codex_ent_gas_clds_light,"2025-09-14 05:57:18",0,Inner Orion Spur,Near One,10,0,0,"K (Yellow-Orange) Star",111',
  'Albens Bell Mollusc,codex_ent_small_org_moll01_v6_def,"2020-01-01 00:00:00",0,Inner Orion Spur,Near One,10,0,0,"K (Yellow-Orange) Star",111',
  // A localised name: the family stands in.
  '"Таргоиды",codex_ent_l_cry_metcry_yw,"2020-01-01 00:00:00",0,Inner Orion Spur,Near Two,0,30,0,"M (Red dwarf) Star",222',
  'Rubeum Bioluminescent Anemone,codex_ent_sphereefgh_01,"2020",0,Inner Orion Spur,Near Two,0,30,0,"M",222',
  'Far Cloud,codex_ent_gas_clds_green,"2020",0,Inner Orion Spur,Far Away,5000,0,0,"M",333',
].join("\r\n");

let dir: string;
const saved = process.env.EDEXO_USER_DATA_DIR;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-nsp-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
  resetNspMemo();
});
afterEach(() => {
  if (saved === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = saved;
  resetNspMemo();
  rmSync(dir, { recursive: true, force: true });
});

/** A server that sends the file in small pieces, so lines break across chunks. */
function fakeFetch(body: string, opts: { etag?: string; seenEtag?: (e: string | null) => void } = {}): typeof fetch {
  return (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
    const inm = init?.headers?.["If-None-Match"] ?? null;
    opts.seenEtag?.(inm);
    if (inm && inm === opts.etag) return new Response(null, { status: 304 });
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 37) c.enqueue(bytes.slice(i, i + 37));
        c.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-length": String(bytes.length), ...(opts.etag ? { etag: opts.etag } : {}) },
    });
  }) as typeof fetch;
}

async function waitDone() {
  for (let i = 0; i < 200 && readNspStatus().running; i++) await new Promise((r) => setTimeout(r, 5));
}

describe("which rows are phenomena", () => {
  it("by codex id: clouds, small and large space-borne life; not surface biology", () => {
    const col = nspColumns(HEADER);
    const lines = CSV.split("\r\n").slice(1);
    const kept = lines.map((l) => parseNspLine(l, col)).filter(Boolean);
    expect(kept.map((r) => r!.id)).toEqual([
      "codex_ent_gas_clds_light",
      "codex_ent_gas_clds_light",
      "codex_ent_small_org_moll01_v6_def",
      "codex_ent_l_cry_metcry_yw",
      "codex_ent_gas_clds_green",
    ]);
    expect(kept[3]!.name).toBe("Metallic crystals");
    expect(nspFamilyLabel("codex_ent_gas_clds_green_storm")).toBe("Lagrange storm cloud");
  });
});

describe("the download", () => {
  it("streams the file, keeps each phenomenon once per system, and answers nearby by system", async () => {
    startNspDownload({ fetchImpl: fakeFetch(CSV, { etag: '"v1"' }) });
    await waitDone();
    const st = readNspStatus();
    expect(st.error).toBeNull();
    expect(st.rowCount).toBe(4);
    expect(st.systemCount).toBe(3);
    const near = nearbyNsp({ x: 0, y: 0, z: 0 }, 100);
    expect(near).toEqual([
      { system: "Near One", systemAddress: 111, distanceLy: 10, names: ["Proto-Lagrange Cloud", "Albens Bell Mollusc"] },
      { system: "Near Two", systemAddress: 222, distanceLy: 30, names: ["Metallic crystals"] },
    ]);
    // Small on disk: only the phenomena.
    expect(readFileSync(resolveNspCachePath(), "utf8").length).toBeLessThan(CSV.length);
  });

  it("waits a day unless forced, then asks with the ETag and keeps the rows on 304", async () => {
    startNspDownload({ fetchImpl: fakeFetch(CSV, { etag: '"v1"' }) });
    await waitDone();
    let asked: string | null | undefined;
    const before = readNspStatus().fetchedAtMs;
    startNspDownload({ fetchImpl: fakeFetch(CSV, { etag: '"v1"', seenEtag: (e) => (asked = e) }) });
    await waitDone();
    expect(asked).toBeUndefined(); // cooldown: not asked at all
    startNspDownload({ force: true, fetchImpl: fakeFetch("", { etag: '"v1"', seenEtag: (e) => (asked = e) }) });
    await waitDone();
    expect(asked).toBe('"v1"');
    expect(readNspStatus().rowCount).toBe(4);
    expect(readNspStatus().fetchedAtMs).toBeGreaterThanOrEqual(before!);
  });

  it("reports a failure instead of writing a broken file", async () => {
    startNspDownload({ fetchImpl: (async () => new Response("nope", { status: 503 })) as typeof fetch });
    await waitDone();
    expect(readNspStatus().error).toContain("503");
    expect(readNspStatus().haveData).toBe(false);
  });
});
