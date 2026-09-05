/**
 * The one place a tool reads the journal merge cache.
 *
 * Five scripts each had their own copy of "join the path, check it exists, sniff for gzip,
 * deserialize, decode, complain on a version mismatch" — and none of them said **which file** they
 * had read. That was survivable while there was one cache. There were two (§47): the packaged app
 * wrote `%APPDATA%\edexo-compare\.edexo-cache` and every probe read
 * `%LOCALAPPDATA%\ED Exo Compare\.edexo-cache`, so a measurement could silently describe a corpus
 * hours older than the one the commander had just flown.
 *
 * §47 removed the second location. Printing the path and its age stays anyway, because the cheapest
 * defence against measuring the wrong thing is saying out loud what was measured.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import v8 from "node:v8";
import { gunzipSync } from "node:zlib";
import { decodeJournalMergeCache } from "../src/server/journalMergeCacheEncoding.js";
import type { JournalMergeCachePayload } from "../src/server/gameState.js";
import { resolveJournalMergeCacheRoot } from "../src/server/paths.js";

export function journalMergeCachePath(): string {
  return path.join(resolveJournalMergeCacheRoot(), "journal-merge.payload.v8gz");
}

function ageOf(file: string): string {
  try {
    const { mtime, size } = statSync(file);
    const minutes = Math.max(0, Math.round((Date.now() - mtime.getTime()) / 60000));
    const age =
      minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${(minutes / 60).toFixed(1)} h` : `${(minutes / 1440).toFixed(1)} d`;
    return `${(size / 1e6).toFixed(1)} MB, written ${age} ago`;
  } catch {
    return "size unknown";
  }
}

/**
 * Load the cache every probe measures against, or exit with the reason.
 *
 * Exits rather than throws: these are one-shot CLI tools, and a stack trace over "run the app once"
 * helps nobody.
 */
export function loadJournalMergeCacheForTool(quiet = false): JournalMergeCachePayload {
  const payloadPath = journalMergeCachePath();
  if (!existsSync(payloadPath)) {
    console.error(`No journal merge cache at ${payloadPath}. Run the app once to build it.`);
    process.exit(1);
  }
  if (!quiet) console.log(`cache  ${payloadPath}  (${ageOf(payloadPath)})`);

  const raw = readFileSync(payloadPath);
  const doc =
    raw[0] === 0x1f && raw[1] === 0x8b ? v8.deserialize(gunzipSync(raw)) : JSON.parse(raw.toString("utf8"));
  const payload = decodeJournalMergeCache(doc);
  if (!payload) {
    console.error(`Cache at ${payloadPath} is not in the current encoding; delete it and let the app rebuild.`);
    process.exit(1);
  }
  return payload;
}
