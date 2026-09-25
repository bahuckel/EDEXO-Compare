/**
 * The header's "Fix" stubs are the commander's own corrections, so they live in the user data folder.
 * Next to the codex they sat inside the program folder: lost on update, and on every quit of the
 * single exe. An older stub found next to the codex is copied across once, never over a newer copy.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCodexCriteriaPatchesFromFixesJson } from "../src/server/exoDataAlertFix.js";
import { resolveSpeciesFixesDir } from "../src/server/paths.js";
import type { SpeciesEntry } from "../src/shared/types.js";

let tree: string;
let codex: string;

const stub = (alertId: string, volcanism: string) => ({
  schema: "edexo.fix_stub.v1",
  targetRelative: "data/species/Bacterium/Bacterium_new.json",
  targetKind: "codex_new_json",
  entries: [
    {
      writtenAt: "2026-09-25T00:00:00Z",
      alertId,
      severity: "warn",
      detectionSource: "journal",
      title: "t",
      detail: "d",
      criteriaPatch: { speciesEntryId: "bact-1", volcanismIncludesAppend: [volcanism] },
    },
  ],
});

const species = (): SpeciesEntry[] => [{ id: "bact-1", criteria: {} } as unknown as SpeciesEntry];

function userCopyPath(): string {
  return path.join(resolveSpeciesFixesDir(), "Bacterium", "fixes_Bacterium_new.json");
}

beforeEach(() => {
  tree = mkdtempSync(path.join(tmpdir(), "edexo-fixtree-"));
  mkdirSync(path.join(tree, "Bacterium"), { recursive: true });
  codex = path.join(tree, "Bacterium", "Bacterium_new.json");
  writeFileSync(codex, "{}");
  rmSync(path.join(resolveSpeciesFixesDir()), { recursive: true, force: true });
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
  rmSync(path.join(resolveSpeciesFixesDir()), { recursive: true, force: true });
});

describe("fix stubs in the user data folder", () => {
  it("lives beside the user settings, not in the species tree", () => {
    expect(resolveSpeciesFixesDir().startsWith(process.env.EDEXO_USER_DATA_DIR!)).toBe(true);
  });

  it("applies a stub that exists only in the user data folder", () => {
    mkdirSync(path.dirname(userCopyPath()), { recursive: true });
    writeFileSync(userCopyPath(), JSON.stringify(stub("a1", "iron")));
    const s = species();
    applyCodexCriteriaPatchesFromFixesJson(codex, s);
    expect(s[0]!.criteria.volcanismIncludes).toEqual(["iron"]);
  });

  it("copies an old stub from next to the codex across, and applies it", () => {
    writeFileSync(
      path.join(tree, "Bacterium", "fixes_Bacterium_new.json"),
      JSON.stringify(stub("a1", "iron")),
    );
    const s = species();
    applyCodexCriteriaPatchesFromFixesJson(codex, s);
    expect(existsSync(userCopyPath())).toBe(true);
    expect(s[0]!.criteria.volcanismIncludes).toEqual(["iron"]);
  });

  it("never overwrites the user's copy, and applies both", () => {
    mkdirSync(path.dirname(userCopyPath()), { recursive: true });
    const mine = JSON.stringify(stub("a2", "silicate"));
    writeFileSync(userCopyPath(), mine);
    writeFileSync(
      path.join(tree, "Bacterium", "fixes_Bacterium_new.json"),
      JSON.stringify(stub("a1", "iron")),
    );
    const s = species();
    applyCodexCriteriaPatchesFromFixesJson(codex, s);
    expect(readFileSync(userCopyPath(), "utf8")).toBe(mine);
    expect(s[0]!.criteria.volcanismIncludes).toEqual(["silicate", "iron"]);
  });

  it("reading the same patch twice adds it once", () => {
    mkdirSync(path.dirname(userCopyPath()), { recursive: true });
    writeFileSync(userCopyPath(), JSON.stringify(stub("a1", "iron")));
    writeFileSync(
      path.join(tree, "Bacterium", "fixes_Bacterium_new.json"),
      JSON.stringify(stub("a1", "iron")),
    );
    const s = species();
    applyCodexCriteriaPatchesFromFixesJson(codex, s);
    expect(s[0]!.criteria.volcanismIncludes).toEqual(["iron"]);
  });
});
