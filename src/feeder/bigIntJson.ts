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

/** Field names whose numeric values must survive as digits. */
export const ID64_FIELDS = ["id64", "systemId64", "bodyId64", "SystemAddress"] as const;

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
    wanted.has(name) ? `"${name}"${sep}"${digits}"` : match,
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
