/**
 * C3 — where a profile's numbers came from, so a change can be attributed.
 *
 * The point, in the backlog's own words: *"it is the difference between 'the numbers changed' and
 * 'the numbers changed **because the input changed**'."* Without it, a diff in a shipped profile is
 * unattributable — you cannot tell a corpus that grew from a builder that was edited, and §46 is the
 * worked example of why that matters: packing the archives changed the last digit of a great many
 * means, purely because the samples arrived in a different order. Nothing about the data had moved.
 *
 * So each profile carries a hash of the bodies that produced it, plus the three counts that describe
 * how those bodies were arrived at.
 *
 * ## What the hash covers, and why it is the whole record
 *
 * The **entire EDSM body record**, canonicalised, not just the fields the builder currently reads.
 * Hashing only the read fields would answer the narrower question "would this produce the same
 * numbers", which sounds better and is a maintenance trap: the hash would have to be kept in step
 * with the builder's field list forever, and would silently stop covering anything newly read. The
 * whole record answers "is this the same input", which is the question C3 actually asks, and a body
 * EDSM has revised genuinely *is* a different input.
 *
 * ## Order must not matter
 *
 * Bodies are sorted by a stable key before hashing, and object keys are emitted in sorted order.
 * §46 changed the sample iteration order and moved float summation in the last digit; the hash has
 * to say "same input" across that, or it reports noise instead of news.
 */
import { createHash } from "node:crypto";

/**
 * The counts that make de-duplication visible.
 *
 * Read together they tell the whole story of how many raw lines became how many observations:
 * `csvRows` \u2265 `occurrences` \u2265 `bodies`, where the first gap is duplicate rows collapsed by the
 * store's `UNIQUE(system_id, norm_body)` and the second is sightings whose body EDSM has no record
 * of (§45.2 measured 599 of those across the corpus).
 */
export interface ProfileProvenanceCounts {
  /** CSV lines imported for this species, before de-duplication. */
  csvRows: number;
  /** Unique (system, body) pairs the index holds for it. */
  occurrences: number;
  /** Of those, the ones that hydrated to an EDSM record and fed the numbers. */
  bodies: number;
}

export interface ProfileProvenance extends ProfileProvenanceCounts {
  /** SHA-256 over the canonicalised body records, order-independent. */
  inputHash: string;
}

/** Deterministic JSON: object keys sorted at every depth, arrays left in their given order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/**
 * A body's sort key. EDSM's `id` is a small safe integer and unique; the name is the fallback for a
 * record that somehow lacks one, and the canonical form itself is the last resort so that two
 * otherwise identical anonymous bodies still order deterministically.
 */
function sortKey(body: Record<string, unknown>, canonicalForm: string): string {
  const id = body.id;
  if (typeof id === "number" && Number.isFinite(id)) return `0:${String(id).padStart(20, "0")}`;
  const name = body.name;
  if (typeof name === "string" && name.trim()) return `1:${name}`;
  return `2:${canonicalForm}`;
}

/** SHA-256 of the bodies that fed a build, independent of the order they were read in. */
export function hashProfileInput(bodies: readonly unknown[]): string {
  const forms = bodies
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
    .map((b) => {
      const form = canonical(b);
      return { key: sortKey(b, form), form };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const h = createHash("sha256");
  for (const { form } of forms) {
    h.update(form);
    h.update("\n");
  }
  return h.digest("hex");
}
