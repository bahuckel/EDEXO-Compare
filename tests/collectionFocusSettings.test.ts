/**
 * The collection marker's thresholds, now editable from Options.
 *
 * They lived only in `edexo-collection-focus.json` beside the user settings — a text editor and a
 * restart, which is not a setting so much as a rumour. `⌖2` in the prediction rows is
 * `targetScans − ownScans`, so the commander could see the count and not the thing that set it.
 *
 * What is pinned here is the clamping and the merge, because both are ways a settings route goes
 * quietly wrong: a value the server refuses must come *back* so the box shows what will really be
 * used, and a patch touching one field must not blank the rest.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_COLLECTION_FOCUS,
  collectionFocusPath,
  loadCollectionFocusConfig,
  saveCollectionFocusConfig,
} from "../src/server/collectionFocus.js";
import { mergeCollectionFocus, type CollectionFocusConfig } from "../src/shared/collectionFocus.js";

let home: string;
let priorEnv: string | undefined;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "edexo-focus-"));
  priorEnv = process.env.EDEXO_USER_DATA_DIR;
  process.env.EDEXO_USER_DATA_DIR = home;
});

afterEach(() => {
  if (priorEnv === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = priorEnv;
  rmSync(home, { recursive: true, force: true });
});

describe("editing one field", () => {
  it("leaves the others alone", () => {
    // The panel sends `{ targetScans }` on its own. A merge that rebuilt from defaults would quietly
    // reset a corpus floor the commander had moved.
    const current: CollectionFocusConfig = {
      ...DEFAULT_COLLECTION_FOCUS,
      corpusFloor: 400,
      dismissed: ["x"],
    };
    const next = mergeCollectionFocus(current, { targetScans: 5 });
    expect(next.targetScans).toBe(5);
    expect(next.corpusFloor).toBe(400);
    expect(next.dismissed).toEqual(["x"]);
    expect(next.enabled).toBe(current.enabled);
  });

  it("turns the marker off without losing the numbers", () => {
    const next = mergeCollectionFocus(DEFAULT_COLLECTION_FOCUS, { enabled: false });
    expect(next.enabled).toBe(false);
    expect(next.targetScans).toBe(DEFAULT_COLLECTION_FOCUS.targetScans);
  });
});

describe("clamping", () => {
  it("keeps the scan target inside its bounds", () => {
    // Zero would retire every species instantly; a huge one would ask forever.
    expect(mergeCollectionFocus(DEFAULT_COLLECTION_FOCUS, { targetScans: 0 }).targetScans).toBe(1);
    expect(mergeCollectionFocus(DEFAULT_COLLECTION_FOCUS, { targetScans: 999 }).targetScans).toBe(20);
  });

  it("keeps the corpus floor inside its bounds", () => {
    expect(mergeCollectionFocus(DEFAULT_COLLECTION_FOCUS, { corpusFloor: -5 }).corpusFloor).toBe(0);
    expect(mergeCollectionFocus(DEFAULT_COLLECTION_FOCUS, { corpusFloor: 99_999 }).corpusFloor).toBe(5000);
  });

  it("rounds, so a typed decimal cannot become a fractional threshold", () => {
    expect(mergeCollectionFocus(DEFAULT_COLLECTION_FOCUS, { targetScans: 3.7 }).targetScans).toBe(4);
  });

  it("ignores a field that is not a number rather than zeroing it", () => {
    /*
      An empty number input sends `""`, which `Number("")` makes 0 — and 0 is inside the corpus
      floor's range, so a half-typed value would silently become "never thin". The same trap the poll
      rates had.
    */
    const current = { ...DEFAULT_COLLECTION_FOCUS, corpusFloor: 150 };
    expect(mergeCollectionFocus(current, { corpusFloor: "" as unknown as number }).corpusFloor).toBe(150);
    expect(mergeCollectionFocus(current, { corpusFloor: NaN }).corpusFloor).toBe(150);
  });
});

describe("the file it is stored in", () => {
  it("round-trips through disk", () => {
    const cfg: CollectionFocusConfig = { ...DEFAULT_COLLECTION_FOCUS, targetScans: 7, corpusFloor: 42 };
    saveCollectionFocusConfig(cfg);
    expect(existsSync(collectionFocusPath())).toBe(true);
    const back = loadCollectionFocusConfig();
    expect(back.targetScans).toBe(7);
    expect(back.corpusFloor).toBe(42);
  });

  it("stays local — beside the user settings, never in the repository", () => {
    // It is derived from one commander's journal. The owner's standing rule is that the app ships
    // statistics rather than his rows, and this file is his rows' shadow.
    saveCollectionFocusConfig(DEFAULT_COLLECTION_FOCUS);
    expect(collectionFocusPath().startsWith(home)).toBe(true);
    expect(readFileSync(collectionFocusPath(), "utf8")).toContain("targetScans");
  });

  it("falls back to the defaults when the file is unreadable", () => {
    // A malformed local file is not worth a failed snapshot; the marker is a convenience.
    expect(loadCollectionFocusConfig().targetScans).toBe(DEFAULT_COLLECTION_FOCUS.targetScans);
  });
});
