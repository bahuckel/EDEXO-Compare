/**
 * The EDDN collector's codex ledger, when the commander runs one (owner, 2026-10-04, plan O-G: "only if
 * the user is running our EDDN ledger, auto-detected").
 *
 * [CODEX FIRST] knows what EDSM's nightly dump and EDAstro's file know; anything logged after the dump
 * is invisible to it. The collector (eddn-bio-collector, port 7121) records every codex entry players'
 * tools relay on EDDN, so its rows since the dump close that gap. Asked on start and every half hour
 * with one local GET; when nothing answers, nothing changes and nothing is shown.
 */
import { regionJoinKey } from "../shared/regionMap.js";
import { codexFirstDataDate, setEddnLedgerIds } from "./codexFirst.js";

export const EDDN_COLLECTOR_URL = "http://127.0.0.1:7121";

export interface EddnLedgerStatus {
  /** The collector answered on the last check. */
  found: boolean;
  /** Plant sightings it holds since `since`, the EDSM dump's date. */
  plantRows: number;
  since: string | null;
  checkedAt: string | null;
}

let status: EddnLedgerStatus = { found: false, plantRows: 0, since: null, checkedAt: null };

export function eddnLedgerStatus(): EddnLedgerStatus {
  return status;
}

/** `$Codex_Ent_Aleoids_01_A_Name;` → `codex_ent_aleoids_01_a`, EDSM's id for the same entry. */
export function ledgerTokenToCodexId(token: string): string {
  return token
    .trim()
    .toLowerCase()
    .replace(/^\$/, "")
    .replace(/_name;?$/, "");
}

/** The ledger's JSONL as `region|codexId` keys for its plant rows. */
export function parseLedger(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.startsWith('{"kind":"codex"')) continue;
    let r: { token?: string; region?: string; category?: string };
    try {
      r = JSON.parse(line) as typeof r;
    } catch {
      continue;
    }
    if (!r.token || !r.region || !/biolog/i.test(r.category ?? "")) continue;
    out.add(`${regionJoinKey(r.region)}|${ledgerTokenToCodexId(r.token)}`);
  }
  return out;
}

/**
 * Ask the collector for its plant rows since the EDSM dump. Quiet on every failure: a commander who
 * does not run the collector must never see a warning about it.
 */
export async function refreshEddnLedger(
  projectRoot: string,
  fetchImpl: typeof fetch = fetch,
  base = EDDN_COLLECTOR_URL,
): Promise<EddnLedgerStatus> {
  const since = codexFirstDataDate(projectRoot);
  const checkedAt = new Date().toISOString();
  try {
    const url = `${base}/api/export/codex${since ? `?since=${encodeURIComponent(since)}` : ""}`;
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (!text.startsWith('{"kind":"manifest"')) throw new Error("not a codex ledger");
    const ids = parseLedger(text);
    setEddnLedgerIds(ids);
    status = { found: true, plantRows: ids.size, since, checkedAt };
  } catch {
    if (status.found) setEddnLedgerIds(null);
    status = { found: false, plantRows: 0, since, checkedAt };
  }
  return status;
}

/** Check now and every half hour; the timer never keeps the process alive. */
export function startEddnLedgerWatch(projectRoot: string): () => void {
  void refreshEddnLedger(projectRoot);
  const t = setInterval(() => void refreshEddnLedger(projectRoot), 30 * 60 * 1000);
  if (typeof t.unref === "function") t.unref();
  return () => clearInterval(t);
}
