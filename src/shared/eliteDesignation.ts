/**
 * Elite Dangerous bodydesignation after the star system prefix (FSS / map names).
 * Shared by server (exploration merge) and client (system map layout).
 */
export type ParsedDesignation = {
  /** Orbit-star letters, e.g. "A", "AB". Empty for numeric-only single-primary shorthand ("3", "3 c"). */
  starLetters: string;
  major: number;
  moon?: string;
};

/** Parse short label after system prefix (e.g. "A 6", "ABC 2 b", "3 c", "6", "Body 13"). */
export function parseShortDesignation(short: string): ParsedDesignation | null {
  const s = short.trim();
  if (!s) return null;

  let m = s.match(/^([A-Z]+)\s+(\d+)\s+([a-z])\s*$/i);
  if (m) {
    return { starLetters: m[1]!.toUpperCase(), major: parseInt(m[2]!, 10), moon: m[3]!.toLowerCase() };
  }
  m = s.match(/^([A-Z]+)\s+(\d+)\s*$/i);
  if (m) {
    return { starLetters: m[1]!.toUpperCase(), major: parseInt(m[2]!, 10) };
  }
  m = s.match(/^(\d+)\s+([a-z])\s*$/i);
  if (m) {
    return { starLetters: "", major: parseInt(m[1]!, 10), moon: m[2]!.toLowerCase() };
  }
  m = s.match(/^(\d+)\s*$/);
  if (m) {
    return { starLetters: "", major: parseInt(m[1]!, 10) };
  }
  m = s.match(/^body\s+(\d+)\s*$/i);
  if (m) {
    return { starLetters: "", major: parseInt(m[1]!, 10) };
  }
  return null;
}

/**
 * Parse designation from the **end** of the full journal `BodyName` when the known `StarSystem`
 * prefix does not match (procedural renames, mismatched `StarSystem` strings, duplicates) so we still
 * get `E 1`, `AB 2 c`, `12`, etc.
 */
export function parseDesignationTailFromFullBodyName(bodyName: string): ParsedDesignation | null {
  const s = bodyName.trim();
  if (!s) return null;
  let m = s.match(/([A-Z]{1,3})\s+(\d+)\s+([a-z])\s*$/i);
  if (m) {
    return { starLetters: m[1]!.toUpperCase(), major: parseInt(m[2]!, 10), moon: m[3]!.toLowerCase() };
  }
  m = s.match(/([A-Z]{1,3})\s+(\d+)\s*$/i);
  if (m) {
    return { starLetters: m[1]!.toUpperCase(), major: parseInt(m[2]!, 10) };
  }
  m = s.match(/(\d+)\s+([a-z])\s*$/i);
  if (m) {
    return { starLetters: "", major: parseInt(m[1]!, 10), moon: m[2]!.toLowerCase() };
  }
  m = s.match(/(\d+)\s*$/);
  if (m) {
    return { starLetters: "", major: parseInt(m[1]!, 10) };
  }
  return null;
}

/**
 * Sort map nodes / siblings by in-game designation (star letters, major, moon a…z), not journal `bodyId`.
 */
export function compareByParsedDesignationOrBodyId(
  shortA: string,
  shortB: string,
  bodyIdA: number,
  bodyIdB: number,
): number {
  const pa = parseShortDesignation(shortA);
  const pb = parseShortDesignation(shortB);
  if (pa && pb) {
    const sc = pa.starLetters.localeCompare(pb.starLetters, "en", { sensitivity: "base" });
    if (sc !== 0) return sc;
    if (pa.major !== pb.major) return pa.major - pb.major;
    const ma = pa.moon ?? "";
    const mb = pb.moon ?? "";
    if (ma !== mb) return ma.localeCompare(mb, "en", { sensitivity: "base" });
    return bodyIdA - bodyIdB;
  }
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  return bodyIdA - bodyIdB;
}
