export const JOURNAL_HISTORY_PRESETS = [
  "all",
  "1m",
  "6m",
  "1y",
  "2y",
  "3y",
  "4y",
  "5y",
] as const;

export type JournalHistoryPreset = (typeof JOURNAL_HISTORY_PRESETS)[number];

const ALLOWED = new Set<string>(JOURNAL_HISTORY_PRESETS);

export function isJournalHistoryPreset(raw: unknown): raw is JournalHistoryPreset {
  return typeof raw === "string" && ALLOWED.has(raw);
}

/**
 * Accepts API / persisted JSON values; invalid strings fall back to `all` unless `fallback` is set.
 */
export function parseJournalHistoryPreset(
  raw: unknown,
  fallback: JournalHistoryPreset = "all",
): JournalHistoryPreset {
  if (typeof raw !== "string" || !ALLOWED.has(raw)) return fallback;
  return raw as JournalHistoryPreset;
}

/** Inclusive lower bound on journal file “start” time (UTC ms). `null` = merge every log in the folder. */
export function journalHistoryCutoffUtcMs(
  preset: JournalHistoryPreset,
  nowMs: number = Date.now(),
): number | null {
  if (preset === "all") return null;
  const d = new Date(nowMs);
  if (preset === "1m") {
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.getTime();
  }
  if (preset === "6m") {
    d.setUTCMonth(d.getUTCMonth() - 6);
    return d.getTime();
  }
  const m = /^([1-5])y$/.exec(preset);
  if (m) {
    const n = Number(m[1]);
    d.setUTCFullYear(d.getUTCFullYear() - n);
    return d.getTime();
  }
  return null;
}

export function journalHistoryWindowPresetChoices(): Exclude<JournalHistoryPreset, "all">[] {
  return ["1m", "6m", "1y", "2y", "3y", "4y", "5y"];
}

export function journalHistoryPresetLabel(preset: JournalHistoryPreset): string {
  switch (preset) {
    case "all":
      return "All journal logs";
    case "1m":
      return "Last 1 month";
    case "6m":
      return "Last 6 months";
    case "1y":
      return "Last 1 year";
    case "2y":
      return "Last 2 years";
    case "3y":
      return "Last 3 years";
    case "4y":
      return "Last 4 years";
    case "5y":
      return "Last 5 years";
    default:
      return preset;
  }
}
