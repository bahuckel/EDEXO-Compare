import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearEdsmCredentialsCacheForTests,
  edsmCredentialsStatus,
  forgetEdsmCredentials,
  isPlausibleEdsmApiKey,
  readEdsmCredentials,
  saveEdsmCredentials,
} from "../src/server/edsmCredentials.js";
import { resolveEdsmCredentialsPath, resolveUserSettingsJsonPath } from "../src/server/paths.js";

let dir: string;
const saved = process.env.EDEXO_USER_DATA_DIR;
const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-edsm-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
  clearEdsmCredentialsCacheForTests();
});

afterEach(() => {
  if (saved === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = saved;
  clearEdsmCredentialsCacheForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe("isPlausibleEdsmApiKey", () => {
  it("accepts an EDSM-shaped key", () => {
    expect(isPlausibleEdsmApiKey(KEY)).toBe(true);
  });

  it("rejects the things people paste by mistake", () => {
    expect(isPlausibleEdsmApiKey("")).toBe(false);
    expect(isPlausibleEdsmApiKey("short")).toBe(false);
    expect(isPlausibleEdsmApiKey("https://www.edsm.net/en/settings/api")).toBe(false);
    expect(isPlausibleEdsmApiKey("my key with spaces in it and enough length")).toBe(false);
  });
});

describe("saveEdsmCredentials", () => {
  it("stores and reads back a key", () => {
    expect(saveEdsmCredentials("CMDR Test", KEY)).toEqual({ ok: true });
    expect(readEdsmCredentials()).toEqual({ commanderName: "CMDR Test", apiKey: KEY });
  });

  it("refuses an empty name or an implausible key", () => {
    expect(saveEdsmCredentials("", KEY).ok).toBe(false);
    expect(saveEdsmCredentials("CMDR Test", "nope").ok).toBe(false);
    expect(readEdsmCredentials()).toBeNull();
  });

  /**
   * §21 found the settings JSON is the file people paste into bug reports. The key must not be in
   * it, and this is the assertion that keeps it out.
   */
  it("keeps the key out of the settings file, in its own", () => {
    saveEdsmCredentials("CMDR Test", KEY);

    const credFile = resolveEdsmCredentialsPath();
    expect(existsSync(credFile)).toBe(true);
    expect(readFileSync(credFile, "utf8")).toContain(KEY);
    expect(path.basename(credFile)).not.toBe(path.basename(resolveUserSettingsJsonPath()));

    if (existsSync(resolveUserSettingsJsonPath())) {
      expect(readFileSync(resolveUserSettingsJsonPath(), "utf8")).not.toContain(KEY);
    }
  });
});

describe("edsmCredentialsStatus", () => {
  /** What the UI is allowed to know: enough to recognise the key, not enough to use it. */
  it("reports the last four characters and never the key", () => {
    saveEdsmCredentials("CMDR Test", KEY);
    const status = edsmCredentialsStatus();

    expect(status).toEqual({ commanderName: "CMDR Test", hasKey: true, keyHint: "5678" });
    expect(JSON.stringify(status)).not.toContain(KEY);
  });

  it("says nothing is stored when nothing is", () => {
    expect(edsmCredentialsStatus()).toEqual({ commanderName: null, hasKey: false, keyHint: null });
  });
});

describe("forgetEdsmCredentials", () => {
  it("deletes the file and the cached value", () => {
    saveEdsmCredentials("CMDR Test", KEY);
    forgetEdsmCredentials();

    expect(existsSync(resolveEdsmCredentialsPath())).toBe(false);
    expect(readEdsmCredentials()).toBeNull();
    expect(edsmCredentialsStatus().hasKey).toBe(false);
  });

  it("is safe to call with nothing stored", () => {
    expect(() => forgetEdsmCredentials()).not.toThrow();
  });
});
