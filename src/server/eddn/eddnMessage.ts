/**
 * Turning an EDDN frame into something the corpus can store — INCLUDE-BODY-IDS Phase 4.
 *
 * Pure and synchronous on purpose: the transport is tested against the live relay, and everything
 * that decides *meaning* is tested against captured bytes. A stream consumer whose parsing can only
 * be exercised by connecting to the internet is a consumer nobody can debug.
 *
 * ## What is kept, and why so little
 *
 * EDDN carries the whole galaxy's traffic — commodity listings, outfitting, docking, navroutes. At
 * the observed rate of roughly 25 messages a second, storing everything would grow an index without
 * bound for data the app will never ask about. So the filter is narrow and stated once:
 *
 * - **A body enters the index only through evidence of biology** — a `$SAA_SignalType_Biological;`
 *   count, or a genus list. Nothing else creates a row.
 * - **Everything else only updates a body already in it.** A `Scan` carrying `WasFootfalled` is
 *   valuable, but a Scan is emitted for every body in the galaxy and most of them will never grow
 *   anything. Update-only keeps the same discipline the Spansh importer uses.
 *
 * ## Identity
 *
 * `SystemAddress` is in `ID64_FIELDS`, so the payload is parsed with `parseJsonPreservingIds` and
 * the address arrives as a **string of digits** rather than a float64. Corpus system addresses top
 * out around 4.9 × 10^14 today and would survive `JSON.parse`, but relying on that is relying on
 * nobody ever visiting a far enough sector — and this is a firehose from everybody.
 */
import { inflateSync } from "node:zlib";
import { parseJsonPreservingIds, toId64String } from "../../feeder/bigIntJson.js";

export const BIOLOGICAL_SIGNAL = "$SAA_SignalType_Biological;";

export interface EddnEnvelope {
  $schemaRef?: string;
  header?: { gatewayTimestamp?: string; softwareName?: string };
  message?: Record<string, unknown>;
}

/** Inflate and parse one EDDN frame. Returns null for anything unreadable — a firehose has noise. */
export function decodeEddnFrame(raw: Buffer): EddnEnvelope | null {
  try {
    return parseJsonPreservingIds<EddnEnvelope>(inflateSync(raw).toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * One body's worth of news.
 *
 * Every field is optional except the identity, because a message says one or two things and staying
 * silent about the rest is the point — an absent `footfall` is not `false`.
 */
export interface BodyObservation {
  systemId64: string;
  bodyId: number;
  systemName: string | null;
  bodyName: string | null;
  coords: { x: number; y: number; z: number } | null;
  /** Present only when the message actually counted biological signals. */
  bioSignalCount: number | null;
  /** Named genera, which only ever arrive post-DSS. */
  genuses: string[] | null;
  footfall: boolean | null;
  mapped: boolean | null;
  /** The moment the observation describes — the game's timestamp, not the gateway's. */
  seenAt: string;
  /** Whether this message may create a row, or may only update one. */
  createsRow: boolean;
}

function readSignals(message: Record<string, unknown>): { bio: number | null } {
  const signals = message.Signals;
  if (!Array.isArray(signals)) return { bio: null };
  for (const s of signals) {
    if (!s || typeof s !== "object") continue;
    const row = s as { Type?: unknown; Count?: unknown };
    if (row.Type === BIOLOGICAL_SIGNAL && typeof row.Count === "number") return { bio: row.Count };
  }
  return { bio: null };
}

function readGenuses(message: Record<string, unknown>): string[] | null {
  const g = message.Genuses;
  if (!Array.isArray(g)) return null;
  const out: string[] = [];
  for (const item of g) {
    if (item && typeof item === "object") {
      const genus = (item as { Genus?: unknown }).Genus;
      if (typeof genus === "string" && genus.trim()) out.push(genus.trim());
    }
  }
  return out.length > 0 ? out : null;
}

function readCoords(message: Record<string, unknown>): { x: number; y: number; z: number } | null {
  const p = message.StarPos;
  if (!Array.isArray(p) || p.length < 3) return null;
  const [x, y, z] = p;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/**
 * Extract what one envelope says about one body, or null when it says nothing we store.
 *
 * The four message kinds the plan lists, in the order their value arrives:
 *
 * | schema / event | gives | may create a row |
 * |---|---|---|
 * | `fssbodysignals/1` | biological signal count | yes, when biological |
 * | `journal/1` `SAASignalsFound` | count **and** named genera — proof of a DSS | yes, when biological |
 * | `journal/1` `Scan` | `WasFootfalled`, `WasMapped`, coordinates | no — update only |
 * | `journal/1` `CodexEntry` | species presence and novelty | not yet; see below |
 *
 * `CodexEntry` is deliberately not handled. It names a *species*, which needs a table of its own and
 * a mapping from the codex's internal names — and §23.4 is the standing warning about what a naming
 * mismatch costs. It is worth doing and it is not worth doing badly in the same change as the
 * transport.
 */
export function extractBodyObservation(env: EddnEnvelope): BodyObservation | null {
  const ref = String(env.$schemaRef ?? "");
  const message = env.message;
  if (!message || typeof message !== "object") return null;

  const isFssBodySignals = ref.includes("/fssbodysignals/");
  const isJournal = ref.includes("/journal/");
  if (!isFssBodySignals && !isJournal) return null;

  const event = String(message.event ?? "");
  if (isJournal && event !== "Scan" && event !== "SAASignalsFound") return null;

  const systemId64 = toId64String(message.SystemAddress);
  const bodyId = message.BodyID;
  if (!systemId64 || typeof bodyId !== "number" || !Number.isSafeInteger(bodyId)) return null;

  const seenAt = str(message.timestamp) ?? str(env.header?.gatewayTimestamp);
  if (!seenAt) return null;

  const { bio } = readSignals(message);
  const genuses = readGenuses(message);

  // A `Scan` is emitted for every body in the galaxy; most will never grow anything. It may enrich a
  // body we already care about, never introduce one.
  const isScan = isJournal && event === "Scan";
  const hasBiologyEvidence = (bio !== null && bio > 0) || genuses !== null;
  if (!isScan && !hasBiologyEvidence) return null;

  return {
    systemId64,
    bodyId,
    systemName: str(message.StarSystem) ?? str(message.SystemName),
    bodyName: str(message.BodyName),
    coords: readCoords(message),
    bioSignalCount: bio,
    genuses,
    // Genera are proof of a DSS in their own right (§8.9), whatever `WasMapped` says.
    mapped: bool(message.WasMapped) ?? (genuses !== null ? true : null),
    footfall: bool(message.WasFootfalled),
    seenAt,
    createsRow: !isScan && hasBiologyEvidence,
  };
}
