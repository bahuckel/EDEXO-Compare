/**
 * One carrier, looked up on Spansh — a second opinion on where it was last seen.
 *
 * EDAstro's bulk file and Spansh both ingest EDDN and resolve it differently, so neither is simply
 * better. Measured on 16 Vista Genomics carriers on 2026-09-20:
 *
 * ```
 * Spansh newer   9        EDAstro newer   3
 * same           3        not on Spansh   1
 * the two name a different system:  1
 * ```
 *
 * More than half the time Spansh knows something newer, sometimes by a lot — `T4W-0XN` reads
 * 2025-08-25 on EDAstro and 2026-07-06 here. And `H2Z-L5V` is the case this exists for: EDAstro has
 * it in *Cephei Sector BV-Y b4*, Spansh has it in **Asterope** two months later. It moved, and only
 * one of the two saw it.
 *
 * But EDAstro wins on 3 of 16, so this is offered as a **second opinion, never as a correction**.
 * The panel shows both dates and lets the commander decide; nothing overwrites the cached row.
 *
 * ### Why the callsign and not a market id
 *
 * `fleetcarriers.csv` carries no market id — only EDAstro's per-system API does — so the join is on
 * the callsign. Spansh's name filter is **fuzzy**: `K2Y-GKT` returns 39 rows, every `-GKT` suffix in
 * the galaxy. The exact, case-insensitive name match is what makes the answer trustworthy, and the
 * `Drake-Class Carrier` type filter keeps a station with a similar name out of it.
 */
import { APP_USER_AGENT } from "./appVersion.js";

const SPANSH_STATIONS_URL = "https://spansh.co.uk/api/stations/search";
const USER_AGENT = APP_USER_AGENT;

export interface SpanshCarrierFix {
  callsign: string;
  name: string;
  system: string;
  x: number | null;
  y: number | null;
  z: number | null;
  /** Spansh's own last-seen timestamp, ISO. Null when it does not carry one. */
  updatedAt: string | null;
  /** The game's market id — stable, unlike the fuzzy-matched name. Worth keeping for later. */
  marketId: number | null;
}

export type SpanshCarrierResult =
  | { ok: true; fix: SpanshCarrierFix }
  | { ok: false; notFound: true; error: string }
  | { ok: false; notFound?: false; error: string };

/** Callsigns are short and go into a JSON body, but a blank one would return the whole galaxy. */
export function isPlausibleCallsign(value: string): boolean {
  const s = value.trim();
  return s.length >= 3 && s.length <= 12 && /^[A-Za-z0-9-]+$/.test(s);
}

export async function lookupCarrierOnSpansh(callsignRaw: string): Promise<SpanshCarrierResult> {
  const callsign = callsignRaw.trim();
  if (!isPlausibleCallsign(callsign)) {
    return { ok: false, error: "That does not look like a carrier callsign." };
  }

  let res: Response;
  try {
    res = await fetch(SPANSH_STATIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({
        filters: { name: { value: callsign }, type: { value: ["Drake-Class Carrier"] } },
        // Twenty is comfortably more than the fuzzy matches a callsign attracts (39 was the worst
        // seen, but the exact match has always been among the first few), and keeps the reply small.
        size: 20,
        page: 0,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Spansh request failed (network or timeout).",
    };
  }
  if (!res.ok) return { ok: false, error: `Spansh replied ${res.status}.` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "Spansh returned something that is not JSON." };
  }
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return { ok: false, error: "Spansh returned no result list." };

  const wanted = callsign.toUpperCase();
  const hit = results.find((r) => {
    const name = (r as { name?: unknown })?.name;
    return typeof name === "string" && name.trim().toUpperCase() === wanted;
  }) as Record<string, unknown> | undefined;

  if (!hit) {
    // A real answer, not a failure: 1 of 16 sampled carriers is simply not in Spansh's station data.
    return { ok: false, notFound: true, error: "Spansh has no record of this carrier." };
  }

  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    ok: true,
    fix: {
      callsign,
      name: typeof hit.name === "string" ? hit.name : callsign,
      system: typeof hit.system_name === "string" ? hit.system_name : "",
      x: num(hit.system_x),
      y: num(hit.system_y),
      z: num(hit.system_z),
      updatedAt: typeof hit.updated_at === "string" ? hit.updated_at : null,
      marketId: num(hit.market_id),
    },
  };
}
