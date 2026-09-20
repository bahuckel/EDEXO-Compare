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

/** Does this carrier match every term, each in any field? */
export function carrierMatchesQuery(row: CarrierSearchable, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = [row.callsign, row.name, row.system, row.region, row.dssa?.commander ?? ""]
    .filter((s) => s.length > 0)
    .join(" ")
    .toLowerCase();
  // Built once per row rather than per term: a 90,000-row scan runs this for every keystroke.
  const squashedCallsign = squash(row.callsign);

  for (const term of terms) {
    if (haystack.includes(term)) continue;
    // "t9jl2n" should find T9J-L2N. Only worth trying when the term has no separators of its own,
    // so an ordinary word does not get mangled into a false match against a callsign.
    const squashedTerm = squash(term);
    if (squashedTerm.length >= 3 && squashedCallsign.includes(squashedTerm)) continue;
    return false;
  }
  return true;
}
