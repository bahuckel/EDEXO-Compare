/**
 * Free-text search over the carrier list.
 *
 * Searches everything the panel puts on screen — callsign, name, system, region, and the commander
 * who runs it if it is a DSSA carrier. Coverage in the 2026-09-19 file, across 90,077 unique
 * carriers, is what makes this worth having rather than a gesture:
 *
 * ```
 * name    88,372 (98.1 %)      system  90,069      region  90,077 (100 %)
 * ```
 *
 * Two decisions that are not obvious:
 *
 * **Terms are ANDed, and may match different fields.** "dssa colonia" should find a network carrier
 * near Colonia, not every carrier matching either word. Requiring all terms is the only reading that
 * makes a second word narrow the list, which is what typing one more word is for.
 *
 * **Callsigns match with or without the hyphen.** A commander reading `T9J-L2N` off a screen types
 * it either way, and 2,406 of the callsigns in the file are not in the `XXX-XXX` shape at all
 * (`0040`, `01AI`), so the format cannot be assumed on either side.
 */

/** What the matcher needs. A subset of `CarrierRowDTO`, so the server row satisfies it as-is. */
export interface CarrierSearchable {
  callsign: string;
  name: string;
  system: string;
  region: string;
  dssa?: { commander: string } | null;
}

/** Strip anything that is not a letter or digit, for the hyphen-insensitive callsign compare. */
function squash(text: string): string {
  return text.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/**
 * Split a raw query into terms.
 *
 * Whitespace-separated, lowercased, empties dropped. A query of only spaces yields no terms, which
 * every row then matches — the right answer for an empty search box.
 */
export function parseCarrierQuery(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Does every term appear somewhere in these fields?
 *
 * The general form, used by the carrier list and the POI catalogue alike. `identifier` is the one
 * field also compared with its separators stripped — a callsign for a carrier — because that is the
 * kind of value people read off a screen and retype without the punctuation.
 */
export function textMatchesQuery(
  fields: readonly (string | null | undefined)[],
  terms: readonly string[],
  identifier?: string | null,
): boolean {
  if (terms.length === 0) return true;
  const haystack = fields
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ")
    .toLowerCase();
  // Built once per row rather than per term: a 90,000-row scan runs this for every keystroke.
  const squashedIdentifier = identifier ? squash(identifier) : "";

  for (const term of terms) {
    if (haystack.includes(term)) continue;
    // "t9jl2n" should find T9J-L2N. The three-character floor stops a one- or two-letter query from
    // matching a large share of all callsigns, which would read as an unfiltered list.
    const squashedTerm = squash(term);
    if (squashedTerm.length >= 3 && squashedIdentifier.includes(squashedTerm)) continue;
    return false;
  }
  return true;
}

/** Does this carrier match every term, each in any field? */
export function carrierMatchesQuery(row: CarrierSearchable, terms: readonly string[]): boolean {
  return textMatchesQuery(
    [row.callsign, row.name, row.system, row.region, row.dssa?.commander],
    terms,
    row.callsign,
  );
}
