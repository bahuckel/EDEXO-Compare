/**
 * Who took which photograph.
 *
 * The 97 images the project shipped with came from the ED-DSN community and are credited to ED-DSN
 * by link, which is the arrangement recorded in `NOTICE.md`. The owner is now photographing his own
 * and contributing them, and those are **not** ED-DSN's — attributing them there would be a false
 * credit, which is the one mistake this whole area of the project has been careful about.
 *
 * So a manifest, written by `scripts/import-my-photos.ts` and keyed by filename:
 * anything it does not name is ED-DSN's, which keeps the default correct for every existing image
 * and means the file only ever grows by the number of photographs actually contributed.
 *
 * A missing manifest is not an error. Every photo is then ED-DSN's, which is exactly what was true
 * before any of this existed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getSpeciesDataDir } from "./paths.js";

export interface PhotoContributor {
  name: string;
  url?: string;
  licence?: string;
}

interface CreditsFile {
  contributors?: Record<string, PhotoContributor>;
  byFile?: Record<string, string>;
}

let cached: CreditsFile | null | undefined;

export function photoCreditsPath(projectRoot: string): string {
  return path.join(getSpeciesDataDir(projectRoot), "photo-credits.json");
}

function load(projectRoot: string): CreditsFile | null {
  if (cached !== undefined) return cached;
  const file = photoCreditsPath(projectRoot);
  if (!existsSync(file)) {
    cached = null;
    return cached;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CreditsFile;
    cached = parsed?.byFile ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * The contributor for one photo file, or null when it is ED-DSN's.
 *
 * Null is the common answer and the default, so callers read it as "the standing credit applies"
 * rather than as "unknown".
 */
export function photoContributorFor(projectRoot: string, filename: string): PhotoContributor | null {
  const data = load(projectRoot);
  if (!data?.byFile) return null;
  const id = data.byFile[path.basename(filename)];
  if (!id) return null;
  return data.contributors?.[id] ?? null;
}

/** Test seam — the manifest is process-wide, so a test that swaps it must be able to put it back. */
export function setPhotoCreditsForTests(v: CreditsFile | null | undefined): void {
  cached = v;
}
