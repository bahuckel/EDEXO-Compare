/**
 * Drop IDs, metadata, ring geometry, landable flags, etc. from habitat scoring, deck chips,
 * modal detail, and encyclopedia profile tables — keep physics / habitat science only.
 */

const NOISE = [
  /**
   * Axial tilt varies essentially at random between bodies and has no bearing on where a species
   * grows, but the scorer was treating it as evidence: across the 76 shipped profiles it carried a
   * mean concentration of 0.382, comparable to real habitat terms. A parameter that differs on every
   * body cannot distinguish one species from another.
   *
   * Only the *comparison* is dropped. `buildBodyScanExomasteryDetail` builds the body's own orbital
   * readout directly and still reports the tilt as a fact about the planet.
   */
  /\baxial[_ -]?tilt\b/i,
  /\brings?\b/i,
  /\bsystemaddress\b/i,
  /\bsystem_address\b/i,
  /\bid64\b/i,
  /\bbodyid\b/i,
  /\bparentbodyid\b/i,
  /\bstellarbodyid\b/i,
  /\bmarketid\b/i,
  /\bedsystemsaddress\b/i,
  /\bbody\.id\b/i,
  /\bcommander\b/i,
  /\bcmdr\b/i,
  /\btimestamp\b/i,
  /\brecordedat\b/i,
  /\bupdatedat\b/i,
  /\bdate\b/i,
  /\bgameversion\b/i,
  /\bfileheader\b/i,
  /\blandable\b/i,
  /\bislandable\b/i,
  /(\.|^)name$/i,
  /\bbody\.name\b/i,
  /\bsystemname\b/i,
];

export function shouldOmitExomasterySciencePath(path: string): boolean {
  const p = path.trim();
  if (!p) return true;
  const norm = p.toLowerCase().replace(/\\/g, "/");
  for (const re of NOISE) {
    if (re.test(norm)) return true;
  }
  return false;
}

/** EDSM / Spansh-style spreadsheet headers — same intent as {@link shouldOmitExomasterySciencePath}. */
export function shouldOmitDataColumnKey(key: string): boolean {
  const k = key.trim();
  if (!k) return true;
  const norm = k.toLowerCase();
  const compact = norm.replace(/\s+/g, "");
  if (shouldOmitExomasterySciencePath(k)) return true;
  if (/ring/.test(norm)) return true;
  if (/systemaddress|id64|bodyid|parentbodyid|marketid|edsystemsaddress/.test(compact)) return true;
  if (
    norm === "body name" ||
    norm === "body" ||
    norm === "star system" ||
    norm === "system" ||
    norm === "system name"
  )
    return true;
  if (/commander|\bcmdr\b/.test(norm)) return true;
  if (/landable/.test(compact)) return true;
  if (/updated|timestamp|recorded|utc/.test(compact)) return true;
  return false;
}

/** Reference deck score → 100% on absolute “match deck” bar (linear, capped at 100). Tunable. */
export const DECK_SCORE_FULL_SCALE = 24;

export function deckAbsolutePercentFromScore(score: number): number {
  if (!(score > 0)) return 0;
  return Math.round(Math.max(0, Math.min(100, (score / DECK_SCORE_FULL_SCALE) * 100)) * 10) / 10;
}
