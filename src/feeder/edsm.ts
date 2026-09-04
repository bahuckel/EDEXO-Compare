import { formatFullSpectralNotation } from "./spectralNotation.js";

const EDSM_BODIES = "https://www.edsm.net/api-system-v1/bodies";
/** Batch endpoint: many `systemName[]` per request, and it carries the coordinates the bodies one omits. */
const EDSM_SYSTEMS = "https://www.edsm.net/api-v1/systems";

const EDSM_MIN_GAP_MS = 1100;
let edsmGateChain: Promise<void> = Promise.resolve();
let lastEdsmComplete = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Serialize EDSM HTTP calls app-wide (~1 req/s polite, shared with CSV fetch). */
export function withEdsmGate<T>(fn: () => Promise<T>): Promise<T> {
  const run = edsmGateChain.then(async () => {
    const gap = Math.max(0, EDSM_MIN_GAP_MS - (Date.now() - lastEdsmComplete));
    await sleep(gap);
    try {
      return await fn();
    } finally {
      lastEdsmComplete = Date.now();
    }
  });
  edsmGateChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

const EDSM_UA = "ExomasteryFeeder/0.1 (EDSM API; research)";

/** Raised after 429 → wait 60s → retry → wait 300s → retry still fails. */
export class EdsmRateLimitExhaustedError extends Error {
  readonly code = "EDSM_RATE_LIMIT_EXHAUSTED";
  constructor(
    message: string,
    readonly systemName: string,
  ) {
    super(message);
    this.name = "EdsmRateLimitExhaustedError";
  }
}

export function isEdsmRateLimitExhausted(e: unknown): e is EdsmRateLimitExhaustedError {
  return e instanceof EdsmRateLimitExhaustedError;
}

export type FetchEdsmBodiesOpts = {
  /** Called immediately before sleeping for a 429 backoff (wait seconds). */
  onBackoff?: (waitSec: number, attemptAfterThisWait: 1 | 2) => void;
};

function parseRetryAfterSec(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const n = Number(h);
  if (Number.isFinite(n) && n >= 0) return Math.min(Math.floor(n), 3600);
  const d = Date.parse(h);
  if (Number.isFinite(d)) return Math.min(Math.max(0, Math.ceil((d - Date.now()) / 1000)), 3600);
  return undefined;
}

async function fetchEdsmBodiesUrlWithRetries(u: URL, opts?: FetchEdsmBodiesOpts): Promise<unknown> {
  const systemHint = u.searchParams.get("systemName") ?? "(system)";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(u.toString(), {
      headers: { Accept: "application/json", "User-Agent": EDSM_UA },
    });
    if (res.ok) return res.json();

    if (res.status === 429) {
      if (attempt >= 2) {
        throw new EdsmRateLimitExhaustedError(
          `EDSM still returned HTTP 429 after 1 min and 5 min waits — stop and use "Download EDSM data" to continue later (${systemHint}).`,
          systemHint,
        );
      }
      const retryAfter = parseRetryAfterSec(res);
      const baseMs = attempt === 0 ? 60_000 : 300_000;
      const waitMs = retryAfter != null ? Math.max(baseMs, retryAfter * 1000) : baseMs;
      const waitSec = Math.ceil(waitMs / 1000);
      opts?.onBackoff?.(waitSec, attempt === 0 ? 1 : 2);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`EDSM HTTP ${res.status} for ${u}`);
  }
  throw new Error(`EDSM unreachable state for ${u}`);
}

/** Fetch full EDSM system payload (all bodies). Caller should wrap with {@link withEdsmGate} unless batching delays elsewhere. */
export async function fetchEdsmSystemBodies(
  systemName: string,
  opts?: FetchEdsmBodiesOpts,
): Promise<unknown> {
  const u = new URL(EDSM_BODIES);
  u.searchParams.set("systemName", systemName);
  u.searchParams.set("showPrimaryStar", "1");
  u.searchParams.set("showCoordinates", "1");
  u.searchParams.set("showId", "1");
  return fetchEdsmBodiesUrlWithRetries(u, opts);
}

export interface EdsmBody {
  id?: number;
  name?: string;
  type?: string;
  subType?: string;
  bodies?: EdsmBody[];
  [key: string]: unknown;
}

function flattenBodies(root: EdsmBody | undefined, out: EdsmBody[]) {
  if (!root) return;
  out.push(root);
  const kids = root.bodies;
  if (Array.isArray(kids)) for (const c of kids) flattenBodies(c as EdsmBody, out);
}

/** EDSM nests some children under `bodies`; flatten to a list. */
export function listAllEdsmBodies(systemJson: unknown): EdsmBody[] {
  const root = systemJson as Record<string, unknown>;
  const main = root?.bodies;
  const out: EdsmBody[] = [];
  if (Array.isArray(main)) {
    for (const b of main) flattenBodies(b as EdsmBody, out);
  }
  return out;
}

function pickStarNumber(body: EdsmBody, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function summarizeEdsmStar(s: EdsmBody) {
  const spectralClass = typeof s.spectralClass === "string" ? s.spectralClass : undefined;
  const subType = typeof s.subType === "string" ? s.subType : undefined;
  const explicitType = typeof s.starType === "string" ? s.starType.trim() : "";
  let starType: string | undefined = explicitType || undefined;
  if (!starType && spectralClass) {
    const m = spectralClass.trim().match(/^([OBAFGKMNLTYWD])[A-Za-z]?(?=\s|\d|[(]|$)/i);
    if (m) starType = m[1]!.toUpperCase();
  }
  const subclass = pickStarNumber(s, ["subclass", "solarSubclass"]);
  const luminosityRaw =
    (typeof s.luminosity === "string" && s.luminosity.trim()) ||
    (typeof s.luminosityClass === "string" && s.luminosityClass.trim()) ||
    undefined;
  const fullSpectralNotation =
    formatFullSpectralNotation(starType, subclass ?? undefined, luminosityRaw) ??
    (spectralClass?.trim() || undefined) ??
    subType?.trim() ??
    null;

  return {
    name: typeof s.name === "string" ? s.name : "",
    subType,
    spectralClass,
    starType,
    subclass,
    luminosity: luminosityRaw,
    fullSpectralNotation,
    isScoopable: s.isScoopable as boolean | undefined,
  };
}

export function findEdsmBodyByName(systemJson: unknown, bodyName: string): EdsmBody | null {
  const want = bodyName.trim().toLowerCase();
  const all = listAllEdsmBodies(systemJson);
  for (const b of all) {
    const n = (b.name as string | undefined)?.trim().toLowerCase();
    if (n === want) return b;
  }
  for (const b of all) {
    const n = (b.name as string | undefined)?.trim().toLowerCase();
    if (n && (want.endsWith(n) || n.endsWith(want))) return b;
  }
  return null;
}

/** System summary + full target planet EDSM blob (no truncation). */
export function extractPlanetContext(systemJson: unknown, bodyName: string): Record<string, unknown> {
  const root = systemJson as Record<string, unknown>;
  const bodiesArr = root.bodies;
  const body = findEdsmBodyByName(systemJson, bodyName);
  const stars = Array.isArray(bodiesArr)
    ? listAllEdsmBodies(systemJson).filter((b) => (b.type as string)?.toLowerCase() === "star")
    : [];

  return {
    fetchedAt: new Date().toISOString(),
    systemName: root.name,
    systemId: root.id,
    coords: root.coords,
    starCount: stars.length,
    planetRecordsInSystem: Array.isArray(bodiesArr) ? listAllEdsmBodies(systemJson).length : 0,
    starSummaries: stars.map(summarizeEdsmStar),
    targetBodyName: bodyName,
    targetBody: body ?? null,
  };
}

export interface EdsmSystemCoords {
  name: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Galactic coordinates for a batch of systems.
 *
 * The bodies endpoint is asked for `showCoordinates` and does not return them, which is why 31,990
 * sample packs on disk carry `coords: null` and a region prior needs a second pass. This endpoint
 * does return them, and it takes many systems per request — 2,993 systems cost about sixty calls
 * rather than three thousand.
 *
 * Names that EDSM does not know are simply absent from the result; the caller decides what that
 * means. Batches are capped at 50 because the request is a GET and the names go in the query string.
 */
export const EDSM_COORDS_BATCH = 50;

export async function fetchEdsmSystemCoords(names: string[]): Promise<EdsmSystemCoords[]> {
  const wanted = names.map((n) => n.trim()).filter(Boolean);
  if (wanted.length === 0) return [];
  const u = new URL(EDSM_SYSTEMS);
  for (const n of wanted.slice(0, EDSM_COORDS_BATCH)) u.searchParams.append("systemName[]", n);
  u.searchParams.set("showCoordinates", "1");

  const res = await fetch(u.toString(), {
    headers: { Accept: "application/json", "User-Agent": EDSM_UA },
  });
  if (res.status === 429) {
    throw new EdsmRateLimitExhaustedError("EDSM returned HTTP 429 for a coordinate batch.", wanted[0]!);
  }
  if (!res.ok) throw new Error(`EDSM HTTP ${res.status} for a coordinate batch of ${wanted.length}`);

  return parseEdsmSystemCoords(await res.json());
}

/**
 * Coordinates out of an EDSM systems payload.
 *
 * Separate from the fetch so it can be tested without a network call, and because EDSM answers a
 * batch with only the systems it knows: a name it has never heard of is simply absent, which is a
 * fact about EDSM rather than an error.
 */
export function parseEdsmSystemCoords(parsed: unknown): EdsmSystemCoords[] {
  if (!Array.isArray(parsed)) return [];
  const out: EdsmSystemCoords[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const r = row as { name?: unknown; coords?: { x?: unknown; y?: unknown; z?: unknown } };
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const x = r.coords?.x;
    const y = r.coords?.y;
    const z = r.coords?.z;
    if (!name || typeof x !== "number" || typeof y !== "number" || typeof z !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    out.push({ name, x, y, z });
  }
  return out;
}
