/**
 * Write a generated JSON file only when its content changed (review F-F7).
 *
 * Every profile regeneration rewrote every `exomastery/*.json` because each carries the time it was
 * generated: 1,967 file changes in thirty commits, most of them only the stamp, which made the data
 * commits unreadable. A file whose content is the same apart from its top-level stamps is left as it
 * is, old stamp and all — the stamp then says when the content last changed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const STAMP_KEYS = ["generatedAt", "builtAt"] as const;

function withoutStamps(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const o = { ...(v as Record<string, unknown>) };
  for (const k of STAMP_KEYS) delete o[k];
  return o;
}

/** True when `text` (JSON) says the same as the file at `path`, top-level stamps aside. */
export function sameApartFromStamps(path: string, text: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const before = JSON.stringify(withoutStamps(JSON.parse(readFileSync(path, "utf8"))));
    const after = JSON.stringify(withoutStamps(JSON.parse(text)));
    return before === after;
  } catch {
    return false;
  }
}

/** Write `text` unless the file already says the same apart from its stamps. True when written. */
export function writeJsonIfChanged(path: string, text: string): boolean {
  if (sameApartFromStamps(path, text)) return false;
  writeFileSync(path, text, "utf8");
  return true;
}
