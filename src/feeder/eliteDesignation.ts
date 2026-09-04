/** Body designation suffix after star system prefix — mirrored from ED Exo Compare `eliteDesignation.ts`. */

export type ParsedDesignation = {
  starLetters: string;
  major: number;
  moon?: string;
};

/** Parse short label after system prefix (e.g. "A 6", "6 c", "6"). */
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

/** Fallback: parse `{letters} maj moon` tail from full `BodyName` when CSV system prefix mismatches EDSM. */
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
