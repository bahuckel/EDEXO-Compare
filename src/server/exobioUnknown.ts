/**
 * Exobiology journal lines this app does not know yet, kept instead of dropped (review F-5.13).
 *
 * The Operations update (2026-06-30) brought the Nomad and the Mk II Biological Scanner; the journal
 * manual documents no new event for them yet. Whatever shape they take — a new `ScanType` on
 * `ScanOrganic`, or a new event name — the first such line in the commander's journals is kept here
 * with its fields, so the app can be taught it from a real line rather than a guess. Each new shape is
 * kept once (by event and scan type), at most {@link MAX_KEPT} in all, and said once on the console,
 * which puts it in Copy diagnostics.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { JournalLine } from "../shared/types.js";

/** The exobiology events the app handles. */
const KNOWN_EVENTS = new Set(["ScanOrganic", "SellOrganicData"]);
const KNOWN_SCAN_TYPES = new Set(["Log", "Sample", "Analyse"]);
/** Event names that look like exobiology (or the new ship-launched vessel). */
const EXOBIO_NAME = /organic|exobio|biolog|genetic|nomad|bioscan/i;
export const MAX_KEPT = 50;

/**
 * Why this line is kept: `event` or `event|ScanType`, or null for a line the app knows or that is not
 * about exobiology.
 */
export function unknownExobioKey(line: JournalLine): string | null {
  const event = typeof line.event === "string" ? line.event : "";
  if (!event) return null;
  if (event === "ScanOrganic") {
    const t = typeof line.ScanType === "string" ? line.ScanType : "";
    return KNOWN_SCAN_TYPES.has(t) ? null : `ScanOrganic|${t || "(none)"}`;
  }
  if (KNOWN_EVENTS.has(event)) return null;
  return EXOBIO_NAME.test(event) ? event : null;
}

export function createUnknownExobioLog(file: string, onNew: (key: string) => void = () => {}) {
  const seen = new Set<string>();
  try {
    if (existsSync(file)) {
      for (const l of readFileSync(file, "utf8").split("\n")) {
        if (!l.trim()) continue;
        try {
          const k = (JSON.parse(l) as { key?: unknown }).key;
          if (typeof k === "string") seen.add(k);
        } catch {
          /* a broken line: skip it */
        }
      }
    }
  } catch {
    /* unreadable: start empty */
  }
  return {
    /** Keep the line when it is a shape not seen before. True when it was kept. */
    offer(line: JournalLine): boolean {
      const key = unknownExobioKey(line);
      if (!key || seen.has(key) || seen.size >= MAX_KEPT) return false;
      seen.add(key);
      try {
        appendFileSync(file, JSON.stringify({ key, keptAt: new Date().toISOString(), line }) + "\n", "utf8");
      } catch {
        /* the app goes on without it */
      }
      onNew(key);
      return true;
    },
    keys(): string[] {
      return [...seen];
    },
  };
}
