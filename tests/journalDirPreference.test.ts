/**
 * The journal folder, remembered across updates.
 *
 * It used to be written to `<projectRoot>/edexo-compare-paths.json`, and a packaged app's project
 * root is the install tree — so every update threw the preference away and sent the app back to
 * Saved Games, where it would find nothing and look broken. Almost nobody sets this, and the people
 * who do are exactly the ones who cannot fall back to the default.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_JOURNAL_DIR,
  PATHS_FILE,
  loadPersistedJournalDir,
  persistJournalDirPreference,
  resolveInitialJournalDir,
} from "../src/server/journalDirPreference.js";
import { resolveJournalPathsPath } from "../src/server/paths.js";

let userDir = "";
let projectRoot = "";
let priorUserData: string | undefined;
let priorJournalEnv: string | undefined;

const writePrefs = (file: string, journalDir: string) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify({ journalDir }), "utf8");
};

beforeEach(() => {
  userDir = mkdtempSync(join(tmpdir(), "edexo-jdir-user-"));
  projectRoot = mkdtempSync(join(tmpdir(), "edexo-jdir-root-"));
  priorUserData = process.env.EDEXO_USER_DATA_DIR;
  priorJournalEnv = process.env.ED_JOURNAL_DIR;
  process.env.EDEXO_USER_DATA_DIR = userDir;
  delete process.env.ED_JOURNAL_DIR;

  // The same guard the on-foot catalog tests carry: these cases write a preference file wherever
  // the resolver points, so a resolver aimed somewhere real would edit a live install.
  if (!resolveJournalPathsPath().startsWith(userDir)) {
    throw new Error(`refusing to run: resolveJournalPathsPath() is outside ${userDir}`);
  }
});

afterEach(() => {
  if (priorUserData === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = priorUserData;
  if (priorJournalEnv === undefined) delete process.env.ED_JOURNAL_DIR;
  else process.env.ED_JOURNAL_DIR = priorJournalEnv;
  rmSync(userDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("where the preference is written", () => {
  it("writes beside the user settings, never into the install tree", () => {
    /*
      THE ONE THAT MATTERS. A write back under the project root is the whole bug: it survives until
      the next update and then vanishes, which looks like the app forgetting rather than like a
      packaging decision.
    */
    persistJournalDirPreference("D:\\Elite\\Journals");
    expect(existsSync(resolveJournalPathsPath())).toBe(true);
    expect(existsSync(join(projectRoot, PATHS_FILE)), "nothing lands in the install tree").toBe(false);
    const saved = JSON.parse(readFileSync(resolveJournalPathsPath(), "utf8")) as { journalDir: string };
    expect(saved.journalDir).toContain("Journals");
  });

  it("reads back what it wrote", () => {
    persistJournalDirPreference("D:\\Elite\\Journals");
    expect(loadPersistedJournalDir(projectRoot)).toContain("Journals");
  });
});

describe("an answer given before the move", () => {
  it("is still honoured, so an update does not send them back to Saved Games", () => {
    writePrefs(join(projectRoot, PATHS_FILE), "E:\\Old\\Journals");
    expect(loadPersistedJournalDir(projectRoot)).toContain("Old");
  });

  it("loses to the current location when both exist", () => {
    writePrefs(join(projectRoot, PATHS_FILE), "E:\\Old\\Journals");
    persistJournalDirPreference("F:\\New\\Journals");
    expect(loadPersistedJournalDir(projectRoot)).toContain("New");
  });

  it("is not rewritten in place — the next save moves it for good", () => {
    writePrefs(join(projectRoot, PATHS_FILE), "E:\\Old\\Journals");
    persistJournalDirPreference("F:\\New\\Journals");
    const stale = JSON.parse(readFileSync(join(projectRoot, PATHS_FILE), "utf8")) as { journalDir: string };
    expect(stale.journalDir, "the old file is left alone, and no longer consulted").toContain("Old");
  });
});

describe("what wins", () => {
  it("puts ED_JOURNAL_DIR above everything, which is what makes an isolated test run possible", () => {
    writePrefs(join(projectRoot, PATHS_FILE), "E:\\Old\\Journals");
    persistJournalDirPreference("F:\\New\\Journals");
    process.env.ED_JOURNAL_DIR = "G:\\Cold\\Test";
    expect(resolveInitialJournalDir(projectRoot)).toContain("Cold");
  });

  it("falls back to the platform default when nothing has been set", () => {
    expect(resolveInitialJournalDir(projectRoot)).toBe(DEFAULT_JOURNAL_DIR);
  });

  it("treats a corrupt preference as no preference rather than as an error", () => {
    // A hand-edited or half-written file must not stop the app starting.
    writeFileSync(resolveJournalPathsPath(), "{ not json", "utf8");
    expect(resolveInitialJournalDir(projectRoot)).toBe(DEFAULT_JOURNAL_DIR);
  });
});
