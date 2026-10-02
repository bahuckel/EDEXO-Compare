/**
 * New exobiology journal shapes are kept, once each, instead of dropped (review F-5.13: the Nomad and
 * the Mk II Biological Scanner have no documented journal event yet).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUnknownExobioLog, unknownExobioKey } from "../src/server/exobioUnknown.js";
import type { JournalLine } from "../src/shared/types.js";

const L = (o: Record<string, unknown>) => ({ timestamp: "2026-10-02T18:00:00Z", ...o }) as JournalLine;

describe("unknownExobioKey", () => {
  it("knows the three scan types and the sale", () => {
    for (const t of ["Log", "Sample", "Analyse"])
      expect(unknownExobioKey(L({ event: "ScanOrganic", ScanType: t }))).toBeNull();
    expect(unknownExobioKey(L({ event: "SellOrganicData" }))).toBeNull();
  });

  it("keeps a new scan type and a new exobiology-looking event", () => {
    expect(unknownExobioKey(L({ event: "ScanOrganic", ScanType: "Pulse" }))).toBe("ScanOrganic|Pulse");
    expect(unknownExobioKey(L({ event: "ScanOrganic" }))).toBe("ScanOrganic|(none)");
    expect(unknownExobioKey(L({ event: "NomadLaunched" }))).toBe("NomadLaunched");
    expect(unknownExobioKey(L({ event: "BiologicalScan" }))).toBe("BiologicalScan");
  });

  it("leaves everything else alone", () => {
    for (const e of ["FSDJump", "Scan", "CodexEntry", "SAASignalsFound", "FSSBodySignals", "Touchdown"]) {
      expect(unknownExobioKey(L({ event: e }))).toBeNull();
    }
  });
});

describe("createUnknownExobioLog", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "edexo-exobio-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps each shape once, with the line, and remembers across starts", () => {
    const file = path.join(dir, "u.jsonl");
    const said: string[] = [];
    const log = createUnknownExobioLog(file, (k) => said.push(k));
    expect(
      log.offer(L({ event: "ScanOrganic", ScanType: "Pulse", Genus: "$Codex_Ent_Bacterial_Genus_Name;" })),
    ).toBe(true);
    expect(log.offer(L({ event: "ScanOrganic", ScanType: "Pulse" }))).toBe(false);
    expect(log.offer(L({ event: "ScanOrganic", ScanType: "Analyse" }))).toBe(false);
    expect(said).toEqual(["ScanOrganic|Pulse"]);
    const kept = readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(kept).toHaveLength(1);
    expect(kept[0].line.Genus).toBe("$Codex_Ent_Bacterial_Genus_Name;");
    const again = createUnknownExobioLog(file);
    expect(again.offer(L({ event: "ScanOrganic", ScanType: "Pulse" }))).toBe(false);
    expect(again.keys()).toEqual(["ScanOrganic|Pulse"]);
  });
});
