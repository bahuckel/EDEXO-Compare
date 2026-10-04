/**
 * The journal cache's save and fingerprint check (combined plan 1.1c, 2026-10-01): a save leaves no
 * temp files and reads back as a hit; a closed journal rewritten at the same size (a restored backup)
 * is a miss; a journal that grew is a tail step from the recorded size.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let root: string;
const prevDir = process.env.EDEXO_USER_DATA_DIR;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-cache-save-"));
  process.env.EDEXO_USER_DATA_DIR = path.join(root, "userdata");
});
afterEach(() => {
  if (prevDir === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = prevDir;
  rmSync(root, { recursive: true, force: true });
});

const jump = (sys: string, addr: number) =>
  JSON.stringify({ timestamp: "2026-10-01T02:00:00Z", event: "FSDJump", StarSystem: sys, SystemAddress: addr, StarPos: [addr, 0, 0] }) + "\r\n";

async function setup() {
  const jdir = path.join(root, "journals");
  const proj = path.join(root, "project");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(jdir, { recursive: true });
  mkdirSync(proj, { recursive: true });
  const files = [path.join(jdir, "Journal.2026-09-30T010000.01.log"), path.join(jdir, "Journal.2026-10-01T010000.01.log")];
  writeFileSync(files[0]!, jump("Cache Test A", 1));
  writeFileSync(files[1]!, jump("Cache Test B", 2));
  const { GameStateStore } = await import("../src/server/gameState.js");
  const store = new GameStateStore();
  for (const f of files) {
    const { readJournalFull } = await import("../src/server/journalWatcher.js");
    await readJournalFull(f, (l) => store.apply(l));
  }
  const m = await import("../src/server/journalMergeCache.js");
  const manifest = await m.buildJournalFileManifest(files);
  await m.saveJournalMergeCache(jdir, manifest, store, proj, "all");
  const load = async () =>
    m.tryPrepareJournalCacheLoad(proj, path.normalize(jdir), files, await m.buildJournalFileManifest(files), "all");
  const save = async () => m.saveJournalMergeCache(jdir, await m.buildJournalFileManifest(files), store, proj, "all");
  return { files, load, save };
}

describe("journal cache save", () => {
  it("leaves only the meta and the payload, and reads back as a hit", async () => {
    const { load } = await setup();
    const cacheDir = path.join(root, "userdata", ".edexo-cache");
    expect(readdirSync(cacheDir).sort()).toEqual(["journal-merge.meta.json", "journal-merge.payload.v8gz"]);
    const r = await load();
    expect(r.hit).toBe(true);
    if (r.hit) expect(r.steps).toEqual([]);
  });

  it("reads a save that stopped half-way as a clean miss, and leaves no temp files (combined plan 1.1c)", async () => {
    const { load, save } = await setup();
    const cacheDir = path.join(root, "userdata", ".edexo-cache");
    const payload = path.join(cacheDir, "journal-merge.payload.v8gz");
    // Something holds the payload's name (Windows antivirus, the indexer): the next save's rename of
    // the new payload fails after the old meta is gone.
    rmSync(payload);
    mkdirSync(path.join(payload, "held"), { recursive: true });
    await save();
    expect(readdirSync(cacheDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(cacheDir)).not.toContain("journal-merge.meta.json");
    expect((await load()).hit).toBe(false);
  });

  it("misses when a closed journal was rewritten at the same size", async () => {
    const { files, load } = await setup();
    const t = new Date("2026-09-30T05:00:00Z");
    utimesSync(files[0]!, t, t);
    expect((await load()).hit).toBe(false);
  });

  it("tails the newest journal from the recorded size when it grew", async () => {
    const { files, load } = await setup();
    const size = Buffer.byteLength(jump("Cache Test B", 2));
    appendFileSync(files[1]!, jump("Cache Test C", 3));
    const r = await load();
    expect(r.hit).toBe(true);
    if (r.hit) expect(r.steps).toEqual([{ kind: "tail", path: files[1], startByte: size }]);
  });
});
