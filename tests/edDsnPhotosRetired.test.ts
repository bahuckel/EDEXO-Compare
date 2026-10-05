/**
 * ED-DSN's photographs are here only until a replacement arrives (agreement with ED-DSN: many belong
 * to individual commanders). Once a species has a contributed photograph, ED-DSN's of that species
 * leaves the tree — NOTICE.md says so, and on 2026-10-05 seventeen replaced ones were still shipping.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(process.cwd(), "data", "species");
const credits = JSON.parse(readFileSync(path.join(root, "photo-credits.json"), "utf8")) as { byFile: Record<string, string> };
const IMAGE = /\.(png|jpe?g|webp)$/i;

describe("ED-DSN photographs", () => {
  it("are gone from every species that has a contributed one", () => {
    const leftovers: string[] = [];
    for (const genus of readdirSync(root)) {
      const g = path.join(root, genus);
      if (!statSync(g).isDirectory()) continue;
      for (const folder of readdirSync(g).filter((d) => d.endsWith("_photos"))) {
        const files = readdirSync(path.join(g, folder)).filter((f) => IMAGE.test(f));
        const contributed = files.filter((f) => credits.byFile[f]).map((f) => f.toLowerCase());
        for (const f of files.filter((x) => !credits.byFile[x])) {
          const stem = f.replace(IMAGE, "").toLowerCase();
          if (contributed.some((c) => c.startsWith(`${stem}-`) || c.startsWith(`${stem}.`))) leftovers.push(`${folder}/${f}`);
        }
      }
    }
    expect(leftovers).toEqual([]);
  });
});
