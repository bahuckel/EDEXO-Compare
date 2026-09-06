/**
 * JSON parsing that does not destroy 64-bit identifiers.
 *
 * Elite's `id64` is a 64-bit integer. `JSON.parse` turns every number into a float64, which carries
 * 53 bits of mantissa, so any value above 2^53 comes back rounded — and rounded is what the feeder
 * then wrote to disk. Sampling 300 cached system files found 8,149 of 8,595 `id64` values (94.8 %)
 * beyond 2^53, every one of them already damaged: `36029979779502910` and `324260355931214660` sit
 * on disk today with their trailing digits replaced by zeros. No amount of reprocessing recovers
 * them, because the loss happened before the bytes were written.
 *
 * The fix is to capture the digits as text *before* the parser ever sees them. A pre-pass rewrites
 * `"id64": 828662410047907001` into `"id64": "828662410047907001"`, and the parser then treats it
 * as a string, which it copies verbatim.
 *
 * A `JSON.parse` reviver cannot do this: by the time a reviver runs, the value it is handed is
 * already the rounded float. The source text is the only place the digits still exist.
 *
 * The rule this module enforces (INCLUDE-BODY-IDS §2.4): **an id64 must never pass through a
 * JavaScript `number`.** Parse and compare as `bigint`, serialise as `string`.
 *
 * Note the rule is about the *value's path*, not about storage. SQLite's INTEGER is 64-bit and
 * exact, and a Python ingest reads one back byte-exact because Python integers are arbitrary
 * precision — the corruption above is a JavaScript problem, not a property of the data or of any
 * database. What matters is every boundary a JS `number` could be created at: `JSON.parse`,
 * `res.json()`, and `sql.js`'s default `.get()`. See `feederDb.ts` for why this codebase stores
 * TEXT anyway, and why a galaxy-scale store should not.
 */

/**
 * Field names whose numeric values must survive as digits.
 *
 * The `*Id64` entries are also matched by suffix (see {@link ID64_SUFFIX}), so a field the exporter
 * adds later is covered without this list being updated. They are still named here because the list
 * is what the pre-pass documents, and because `SystemAddress` — the journal's spelling — has no
 * suffix to match on.
 */
export const ID64_FIELDS = [
  "id64",
  "systemId64",
  "bodyId64",
  "hostStarBodyId64",
  "ringId64",
  "SystemAddress",
] as const;

/**
 * Any field whose name ends in `Id64` carries a 64-bit identifier.
 *
 * This is the handover contract with the Spansh ingest: id64-class fields are named `id64` or end in
 * `Id64`, and everything else is below 2^53 by construction. Matching the suffix rather than a fixed
 * list means a new id column cannot silently arrive unquoted and be rounded on the way in.
 */
const ID64_SUFFIX = /Id64$/;

/**
 * The largest integer a float64 represents exactly. A value above this may already be wrong; a
 * value at or below it is safe to have travelled through a `number`.
 */
export const MAX_SAFE_ID = 9007199254740991n;

/**
 * Every `"name": <integer>` pair in the text, whatever the name.
 *
 * Filtering by name in the replacer rather than building a regex per field keeps this to one pass
 * and means no field name is ever interpolated into a pattern.
 */
const NAMED_INTEGER = /"([A-Za-z0-9_]+)"(\s*:\s*)(-?\d+)(?=\s*[,}\]])/g;

/**
 * Quote the numeric values of the named fields, so a later `JSON.parse` keeps their digits.
 *
 * Only a bare integer is rewritten. A value that is already a string, or null, or an object, is
 * left exactly as it is, which makes this safe to run twice over the same text.
 */
export function quoteBigIntFields(text: string, fields: readonly string[] = ID64_FIELDS): string {
  const wanted = new Set(fields);
  return text.replace(NAMED_INTEGER, (match, name: string, sep: string, digits: string) =>
    wanted.has(name) || ID64_SUFFIX.test(name) ? `"${name}"${sep}"${digits}"` : match,
  );
}

/** `JSON.parse`, with the named identifier fields preserved as strings rather than rounded. */
export function parseJsonPreservingIds<T = unknown>(text: string, fields: readonly string[] = ID64_FIELDS): T {
  return JSON.parse(quoteBigIntFields(text, fields)) as T;
}

/**
 * Normalise whatever a source handed us into the canonical string form, or null when it is not an
 * identifier at all.
 *
 * A `number` input is accepted but is **already suspect** — it can only have come through a
 * float64, so above `MAX_SAFE_ID` its digits are not trustworthy. It is returned anyway, because a
 * damaged id is still a usable join hint until Phase 2 re-collects it, and `isTrustworthyId64` is
 * how a caller asks whether to believe it.
 */
export function toId64String(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return /^-?\d+$/.test(t) ? t : null;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // `String(n)`, not `BigInt(n).toString()`. For a damaged id these disagree, and the difference
    // matters: 828662410047907000 is stored in the JSON as those digits, but the float it parses to
    // has the exact value 828662410047906944. `BigInt` reports the float's true value and so
    // invents a third spelling that matches neither the file nor anything else that read it;
    // `String` reproduces exactly what is on disk, which is what a join against that text needs.
    // Above 1e21 JS switches to exponential notation, but no id64 reaches it — 2^64 is 1.8e19.
    return Number.isInteger(value) && Math.abs(value) < 1e21 ? String(value) : null;
  }
  return null;
}

/**
 * Whether an id64 can be believed.
 *
 * False for a value above 2^53 that arrived as a `number`, because that is precisely the case where
 * the rounding has already happened. A string of digits is trustworthy at any magnitude — it never
 * went through a float.
 */
export function isTrustworthyId64(value: unknown): boolean {
  if (typeof value === "string") return /^-?\d+$/.test(value.trim());
  if (typeof value === "bigint") return true;
  if (typeof value === "number") return Number.isSafeInteger(value);
  return false;
}

/**
 * A body's `id64` is not independent data — it is a function of its system and its in-system id.
 *
 *     bodyId64 == systemId64 + (bodyId << 55)
 *
 * Fable found this while building the Spansh ingest and reported it holding on all 770,214 bodies
 * of the one-day dump. Verified here independently, twice, against different data:
 *
 * - **17,830 bodies** re-sampled from the Spansh dump: holds, zero exceptions, max `bodyId` 140.
 * - **All 38,489 sightings in this corpus**, whose bodies came from **EDSM** rather than Spansh:
 *   every reconstruction agrees with the (damaged) float on disk to within float64 rounding. 100.0 %.
 *
 * The second one matters more than it looks. It means the body `id64` values §57 measured as
 * unrecoverable are **not lost at all** — they are recomputable from `systems.id64` and
 * `planets.body_id`, both of which Phases 1 and 2 restored intact. No dump and no network are needed
 * to repair them. It also means the field is redundant: `(systemId64, bodyId)` was always the whole
 * identity, which is why §2.1 made it the join key.
 *
 * Keep using it as a **check**, not just a shortcut. A rounded id64 breaks the equation while a
 * correct one satisfies it, so this catches a corrupted identifier that a digits-preserved parse
 * would wave through — for instance one that lost its digits upstream, before the file was written.
 */
export function bodyId64From(systemId64: string | bigint, bodyId: number | bigint): string {
  return (BigInt(systemId64) + (BigInt(bodyId) << 55n)).toString();
}

/** Whether a body's reported `id64` matches the identity above. */
export function bodyId64Matches(
  systemId64: string | bigint,
  bodyId: number | bigint,
  reportedId64: string | bigint,
): boolean {
  try {
    return BigInt(reportedId64).toString() === bodyId64From(systemId64, bodyId);
  } catch {
    return false;
  }
}
