import { spectralKeysFromJournalStarType } from "./starSpectralKeys.js";
import type { SpeciesEntry } from "./types.js";

export type GenusStarColorSoftTone = "green" | "red" | "yellow";

/** Codex stellar morph vs host star — UI can show {@link supportedSpectralList} and {@link hostSpectralSummary} separately. */
export type GenusStarColorSoftPack = {
  show: boolean;
  tone: GenusStarColorSoftTone;
  /** Comma-separated spectral keys from genus JSON (colour-variant rows). */
  supportedSpectralList: string;
  /** Short host class from journal (e.g. `M`, `TTS`) or em dash when unknown. */
  hostSpectralSummary: string;
  /**
   * @deprecated Prefer {@link supportedSpectralList} + {@link hostSpectralSummary} in UI.
   * Kept for spawn-condition cards that use a single line.
   */
  line: string;
};

export function journalStarPrimarySpectralLetter(parentStarType: string): string {
  const keys = spectralKeysFromJournalStarType(parentStarType.trim());
  if (!keys.length) return "—";
  if (keys.includes("TTS")) return "TTS";
  const k = keys[0]!;
  return k.length <= 3 ? k : k.charAt(0);
}

/**
 * Genus meta colour-variant fit vs resolved journal host `StarType`.
 * Soft only — matcher still hard-rejects spectral keys mapped to JSON `null` when class parses.
 */
export function formatGenusStarColorSoftOneLine(
  entry: SpeciesEntry,
  parentStarType: string | undefined | null,
): GenusStarColorSoftPack {
  const preferred = entry.genusStarColorPreferredSpectralClasses;
  if (!preferred?.length) {
    return { show: false, tone: "yellow", supportedSpectralList: "", hostSpectralSummary: "", line: "" };
  }

  const nulls = entry.genusStarColorNullSpectralClasses ?? [];
  const hostRaw = parentStarType?.trim() ?? "";

  const listedHits = (specK: string, listed: readonly string[]) => {
    const u = specK.toUpperCase();
    const set = new Set(listed.map((x) => x.toUpperCase()));
    if (set.has(u)) return true;
    return u.length > 1 && set.has(u.charAt(0));
  };

  const supported = preferred.join(", ");
  if (!hostRaw) {
    const hostSpectralSummary = "—";
    return {
      show: true,
      tone: "yellow",
      supportedSpectralList: supported,
      hostSpectralSummary,
      line: `Supported: ${supported}. Host star: ${hostSpectralSummary}`,
    };
  }

  const specKeys = spectralKeysFromJournalStarType(hostRaw);
  if (!specKeys.length) {
    const hostSpectralSummary = "—";
    return {
      show: true,
      tone: "yellow",
      supportedSpectralList: supported,
      hostSpectralSummary,
      line: `Supported: ${supported}. Host star: ${hostSpectralSummary}`,
    };
  }

  const hitsNull = specKeys.some((k) => listedHits(k, nulls));
  const hitsPreferred = specKeys.some((k) => listedHits(k, preferred));
  const tone: GenusStarColorSoftTone = hitsNull || !hitsPreferred ? "red" : "green";
  const hostLetter = journalStarPrimarySpectralLetter(hostRaw);

  return {
    show: true,
    tone,
    supportedSpectralList: supported,
    hostSpectralSummary: hostLetter,
    line: `Supported: ${supported}. Host star: ${hostLetter}`,
  };
}
