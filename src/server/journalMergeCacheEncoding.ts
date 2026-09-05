/**
 * On-disk encoding for the journal merge cache.
 *
 * The in-memory payload is written verbatim by `JSON.stringify`, which produced a 20.8 MB file for
 * a 244-log history. 88% of that was the `bodies` array, and most of *that* was repetition rather
 * than data:
 *
 *   - every body repeated its own map key inside the record;
 *   - every `scan` repeated `BodyName` / `BodyID` / `StarSystem` / `SystemAddress`, all of which the
 *     parent body record already carries;
 *   - `materials` and `atmosphereComposition` were arrays of `{ "Name": …, "Percent": … }`, so the
 *     two key names were written ~175,000 times (1.95 MB of pure key text);
 *   - fields at their default (`null`, `[]`, `false`) were written for every body even though the
 *     loader would reconstruct exactly those defaults.
 *
 * This module encodes those away and restores them on load. **Every rule is omit-if-redundant**:
 * a value is dropped only when the decoder can prove what it was — for example `BodyName` is kept
 * whenever it differs from the parent body's name, which it does for 172 of 14,518 scans here.
 * Numbers are never rounded and no field is dropped for being "unimportant", so a decoded payload
 * is deep-equal to the one that was encoded.
 *
 * Result on the reference history: **20.8 MB → 15.1 MB (27% smaller)**, same data. The file is
 * then written through the v8+gzip container in journalMergeCache.ts, landing at ~3 MB.
 */
import type { BodyExoState, PlanetScan } from "../shared/types.js";
import type { JournalMergeCachePayload } from "./gameState.js";

/**
 * Bumped when the encoding changes; a mismatch makes the loader rebuild from the journals.
 *
 * 3 adds `soldExplorationScans`. The bump is the point: a cache written by an older build dropped
 * those rows on the way in, and only a rebuild from the logs can bring the physics back.
 *
 * 4 adds `codexLoggedSpecies`, for the same reason — `CodexEntry` lines were read and discarded by
 * every build before this one, so the set can only be filled by replaying the journals. A stale cache
 * would leave the codex badge silent rather than wrong, but silent is indistinguishable from "you
 * have logged everything", which is a lie by omission on a screen built for codex hunters.
 */
export const JOURNAL_MERGE_CACHE_ENCODING = 4;

/** `2023-10-04T01:51:41Z` — the only shape the store writes; anything else is left as a string. */
const ISO_SECONDS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

type CompositionPairs = { Name?: string; Percent?: number }[];

export type EncodedJournalMergeCacheFile = {
  enc: typeof JOURNAL_MERGE_CACHE_ENCODING;
  payload: JournalMergeCachePayload;
};

function encodeIso(iso: string): string | number {
  if (!ISO_SECONDS_UTC.test(iso)) return iso;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : iso;
}

function decodeIso(v: string | number): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  return `${new Date(v * 1000).toISOString().slice(0, 19)}Z`;
}

/**
 * `[{Name, Percent}]` → `{name: percent}`. Returns the input untouched when an element carries
 * anything beyond those two keys, or when a name repeats — the decoder tells the two apart by type.
 */
function encodeCompositionPairs(arr: CompositionPairs): CompositionPairs | Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const m of arr) {
    if (!m || typeof m !== "object") return arr;
    const keys = Object.keys(m);
    if (keys.some((k) => k !== "Name" && k !== "Percent")) return arr;
    const name = m.Name;
    if (typeof name !== "string" || name === "" || name in out) return arr;
    out[name] = typeof m.Percent === "number" ? m.Percent : null;
  }
  return out;
}

function decodeCompositionPairs(v: unknown): CompositionPairs | undefined {
  if (Array.isArray(v)) return v as CompositionPairs;
  if (!v || typeof v !== "object") return undefined;
  const out: CompositionPairs = [];
  for (const [Name, Percent] of Object.entries(v as Record<string, number | null>)) {
    out.push(Percent === null ? { Name } : { Name, Percent });
  }
  return out;
}

function encodeScan(scan: PlanetScan, body: BodyExoState): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(scan as unknown as Record<string, unknown>) };
  // Only drop an identity field when it matches the parent record the decoder will read it from.
  if (out.BodyName === body.bodyName) delete out.BodyName;
  if (out.BodyID === body.bodyId) delete out.BodyID;
  if (out.StarSystem === body.starSystem) delete out.StarSystem;
  if (out.SystemAddress === body.systemAddress) delete out.SystemAddress;
  for (const field of ["materials", "atmosphereComposition"] as const) {
    const arr = out[field];
    if (Array.isArray(arr)) out[field] = encodeCompositionPairs(arr as CompositionPairs);
  }
  return out;
}

/** Mutates in place: the object graph comes straight from `JSON.parse` and is not shared. */
function decodeScan(raw: Record<string, unknown>, body: Record<string, unknown>): PlanetScan {
  if (!("BodyName" in raw)) raw.BodyName = body.bodyName;
  if (!("BodyID" in raw)) raw.BodyID = body.bodyId;
  if (!("StarSystem" in raw)) raw.StarSystem = body.starSystem;
  if (!("SystemAddress" in raw)) raw.SystemAddress = body.systemAddress;
  for (const field of ["materials", "atmosphereComposition"] as const) {
    if (field in raw && !Array.isArray(raw[field])) {
      const decoded = decodeCompositionPairs(raw[field]);
      if (decoded) raw[field] = decoded;
    }
  }
  return raw as unknown as PlanetScan;
}

/** Fields whose default the decoder restores, so they need not be written at all. */
const BODY_DEFAULTS = {
  biologicalSignals: null,
  genusHints: null,
  signalHints: null,
  scan: null,
  dssComplete: false,
  organicGenusLocks: [] as unknown[],
  confirmedVariants: [] as unknown[],
} as const;

const BODY_DEFAULT_FIELDS = Object.keys(BODY_DEFAULTS) as (keyof typeof BODY_DEFAULTS)[];

function isDefaultValue(field: keyof typeof BODY_DEFAULTS, value: unknown): boolean {
  const def = BODY_DEFAULTS[field];
  if (Array.isArray(def)) return Array.isArray(value) && value.length === 0;
  return value === def;
}

function encodeBody(key: string, body: BodyExoState): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(body as unknown as Record<string, unknown>) };
  if (out.key === key) delete out.key;
  const scan = out.scan;
  if (scan && typeof scan === "object") out.scan = encodeScan(scan as PlanetScan, body);
  for (const field of BODY_DEFAULT_FIELDS) {
    if (field in out && isDefaultValue(field, out[field])) delete out[field];
  }
  if (typeof out.updatedAt === "string") out.updatedAt = encodeIso(out.updatedAt);
  return out;
}

/** Mutates in place; see {@link decodeScan}. Avoids ~30k object copies on a 15 MB cache. */
function decodeBody(key: string, raw: Record<string, unknown>): BodyExoState {
  if (!("key" in raw)) raw.key = key;
  for (const field of BODY_DEFAULT_FIELDS) {
    if (!(field in raw)) {
      const def = BODY_DEFAULTS[field];
      raw[field] = Array.isArray(def) ? [] : def;
    }
  }
  if (raw.scan && typeof raw.scan === "object")
    raw.scan = decodeScan(raw.scan as Record<string, unknown>, raw);
  if (typeof raw.updatedAt === "number") raw.updatedAt = decodeIso(raw.updatedAt);
  return raw as unknown as BodyExoState;
}

export function encodeJournalMergeCache(payload: JournalMergeCachePayload): EncodedJournalMergeCacheFile {
  return {
    enc: JOURNAL_MERGE_CACHE_ENCODING,
    payload: {
      ...payload,
      bodies: payload.bodies.map(([key, body]) => [key, encodeBody(key, body) as unknown as BodyExoState]),
    },
  };
}

/** Returns null when the file is not this encoding, so the caller rebuilds from the journals. */
export function decodeJournalMergeCache(doc: unknown): JournalMergeCachePayload | null {
  if (!doc || typeof doc !== "object") return null;
  const file = doc as Partial<EncodedJournalMergeCacheFile>;
  if (file.enc !== JOURNAL_MERGE_CACHE_ENCODING || !file.payload) return null;
  const payload = file.payload;
  if (!Array.isArray(payload.bodies)) return null;
  for (const entry of payload.bodies) {
    entry[1] = decodeBody(entry[0], entry[1] as unknown as Record<string, unknown>);
  }
  return payload;
}
