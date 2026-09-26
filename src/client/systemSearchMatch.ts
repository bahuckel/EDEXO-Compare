/**
 * A pasted **body** name in the system search (owner's test, 2026-09-26).
 *
 * He copied one of his own bodies, "Flyai Flyuae XJ-A d5 A 2", into the search. The journal filter
 * matched system names containing the text, so nothing matched; Spansh answered with the system
 * itself first, but that hit was hidden because the journals already know the system; what was left
 * were its neighbours — XJ-A d4, d7, d11 — with no signals. Picking the first showed nothing.
 *
 * So a query that *starts with* a system's name followed by a space is that system, and the rest is
 * the body to open once its bodies are in.
 */

/**
 * `""` when the query is exactly the system's name, the body part when it is the system's name
 * followed by a body designation, null otherwise. Case-insensitive.
 */
export function bodyPartOfQuery(query: string, systemName: string): string | null {
  const q = query.trim().toLowerCase();
  const sys = systemName.trim().toLowerCase();
  if (!q || !sys) return null;
  if (q === sys) return "";
  if (q.startsWith(`${sys} `)) return query.trim().slice(sys.length).trim();
  return null;
}

/** Systems the query names (as system or body owner) first, then the rest in their given order. */
export function ownerFirst<T extends { starSystem: string }>(rows: T[], query: string): T[] {
  const owns = rows.filter((r) => bodyPartOfQuery(query, r.starSystem) !== null);
  if (owns.length === 0) return rows;
  return [...owns, ...rows.filter((r) => bodyPartOfQuery(query, r.starSystem) === null)];
}
