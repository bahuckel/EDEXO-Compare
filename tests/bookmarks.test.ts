/**
 * Bookmarks (src/server/bookmarks.ts, src/shared/bookmarks.ts): a system or a body, tags and a note,
 * kept beside the user settings (guild tester report, 2026-09-30).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBookmarksService } from "../src/server/bookmarks.js";
import { normaliseTag, normaliseTags, parseBookmarkInput } from "../src/shared/bookmarks.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function file() {
  const d = mkdtempSync(path.join(tmpdir(), "edexo-bm-"));
  dirs.push(d);
  return path.join(d, "edexo-bookmarks.json");
}

describe("tags and input", () => {
  it("presets keep their spelling, customs are trimmed, duplicates go", () => {
    expect(normaliseTag("  first   FOOTFALL ")).toBe("First footfall");
    expect(normaliseTags(["Biology", "biology", " My  spot ", 3, ""])).toEqual(["Biology", "My spot"]);
  });
  it("a bookmark needs a system; the rest is cleaned", () => {
    expect(parseBookmarkInput({ system: "  " })).toBeNull();
    expect(parseBookmarkInput({ system: "Col 285", systemAddress: "x", tags: ["fuel"], note: 5 })).toEqual({
      system: "Col 285",
      systemAddress: null,
      body: null,
      bodyKey: null,
      tags: ["Fuel"],
      note: "",
      pos: null,
    });
  });
});

describe("the list", () => {
  it("saves, updates the same system and body in place, lists with distance, custom tags, and survives a restart", () => {
    const f = file();
    let t = Date.parse("2026-09-30T10:00:00Z");
    const a = createBookmarksService({ filePath: f, now: () => (t += 1000) });
    const one = a.save(
      { system: "Blatrimpe", systemAddress: 7, body: null, bodyKey: null, tags: ["Biology", "Legendary tree"], note: "Frutexa" },
      { x: 30, y: 40, z: 0 },
    );
    a.save({ system: "Aurai", systemAddress: 8, body: "1 a", bodyKey: "8:12", tags: ["Revisit"], note: "" }, null);
    // Same system, no body, no id: the same bookmark, not a second one.
    const again = a.save(
      { system: "Blatrimpe", systemAddress: 7, body: null, bodyKey: null, tags: ["Biology"], note: "Frutexa collum" },
      null,
    );
    expect(again.id).toBe(one.id);
    expect(again.pos).toEqual({ x: 30, y: 40, z: 0 }); // kept from the first save
    const list = a.list({ x: 0, y: 0, z: 0 });
    expect(list.items.map((b) => [b.system, b.distanceLy])).toEqual([
      ["Blatrimpe", 50],
      ["Aurai", null],
    ]);
    expect(list.customTags).toEqual([]);
    expect(a.forSystem(7, null).map((b) => b.note)).toEqual(["Frutexa collum"]);

    const b = createBookmarksService({ filePath: f });
    expect(b.all()).toHaveLength(2);
    expect(b.remove(one.id)).toBe(true);
    expect(b.remove(one.id)).toBe(false);
    expect(createBookmarksService({ filePath: f }).all().map((x) => x.system)).toEqual(["Aurai"]);
  });

  it("custom tags are listed for the chips", () => {
    const a = createBookmarksService({ filePath: null });
    a.save({ system: "X", systemAddress: 1, body: null, bodyKey: null, tags: ["Nice view", "Fuel"], note: "" }, null);
    expect(a.list(null).customTags).toEqual(["Nice view"]);
  });
});

describe("a system picked on the galaxy map (owner, 2026-09-30)", () => {
  it("carries its position when the journals do not know it", async () => {
    const { parseBookmarkInput } = await import("../src/shared/bookmarks.js");
    expect(parseBookmarkInput({ system: "Far Away", pos: { x: 1, y: 2, z: 3 } })?.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(parseBookmarkInput({ system: "Far Away", pos: { x: "1", y: 2, z: 3 } })?.pos).toBeNull();
    expect(parseBookmarkInput({ system: "Far Away" })?.pos).toBeNull();
  });
});
