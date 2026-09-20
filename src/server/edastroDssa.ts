/**
 * The Deep Space Support Array — EDAstro's `DSSAdeployments.csv`.
 *
 * 101 carriers that commanders deliberately parked across the galaxy as a service network, curated
 * by hand rather than inferred from traffic. 12 KB, rebuilt daily, and on every measure the better
 * data of the two files this app reads:
 *
 * ```
 * DSSA sighting age                median  6 days   p75 14d
 * deep-space Vista Genomics        median 35 days   p75 165d
 * rows whose carrier has drifted from its deployment system:  0 of 101
 * status values in the whole file: "Carrier Operational" x101
 * ```
 *
 * People visit them, so people report them. That is the whole reason they stay fresh, and it is why
 * the panel treats a DSSA row as the strongest answer it can give in the black.
 *
 * Of the 101, **67 sell Vista Genomics**, 97 Universal Cartographics and 88 refuel — so two thirds
 * of the network can take a full sample bag off a commander 30,000 ly from the bubble.
 *
 * ### It has no coordinates
 *
 * The file names systems and nothing else, so distance comes from joining on `Callsign` against
 * `fleetcarriers.csv`, which does carry them. Measured 2026-09-20: **101 of 101 join, all with
 * coordinates, and the two files disagree about the system on zero rows.** A row that ever fails to
 * join is still listed — it just cannot be ranked — because dropping a curated deep-space service
 * carrier for want of a coordinate is a worse answer than showing it without a distance.
 */
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveUserSettingsJsonPath } from "./paths.js";
import { EDASTRO_USER_AGENT, parseEdastroDate, splitCsvLine } from "./edastroCarriers.js";

const DSSA_URL = "https://edastro.com/mapcharts/files/DSSAdeployments.csv";

export function resolveDssaCachePath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-compare-dssa.csv");
}

export interface DssaRecord {
  callsign: string;
  /** The network's own name for it, e.g. "DSSA Sleeper Service". */
  name: string;
  commander: string;
  /** "Carrier Operational" on all 101 today. Kept because the column exists to say otherwise. */
  status: string;
  /** Where it was deployed to sit. Differs from the sighting on 0 of 101, which is the point of DSSA. */
  deploymentSystem: string;
  lastSeenSystem: string;
  lastSeenMs: number | null;
}

export function parseDssaCsv(text: string): DssaRecord[] {
  const lines = text.split(/\r?\n/);
  const header = lines[0];
  if (!header) return [];
  const cols = splitCsvLine(header).map((c) => c.trim());
  const at = (name: string) => cols.indexOf(name);
  const iCall = at("Callsign");
  const iName = at("Name");
  const iCmdr = at("Commander");
  const iStatus = at("Status");
  const iDeploy = at("DeploymentLocation");
  const iSeen = at("LastSeenLocation");
  const iDate = at("LastSeenDate");
  if (iCall < 0 || iName < 0) return [];

  const out: DssaRecord[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const f = splitCsvLine(line);
    const callsign = (f[iCall] ?? "").trim();
    if (!callsign) continue;
    out.push({
      callsign,
      name: (f[iName] ?? "").trim(),
      commander: (f[iCmdr] ?? "").trim(),
      status: (f[iStatus] ?? "").trim(),
      deploymentSystem: (f[iDeploy] ?? "").trim(),
      lastSeenSystem: (f[iSeen] ?? "").trim(),
      lastSeenMs: parseEdastroDate(f[iDate]),
    });
  }
  return out;
}

let memo: { mtimeMs: number; byCallsign: Map<string, DssaRecord> } | null = null;

/** The network keyed by callsign, which is how it joins to the carrier file. Empty if never fetched. */
export function readDssaByCallsign(): Map<string, DssaRecord> {
  const path = resolveDssaCachePath();
  let stat;
  try {
    stat = statSync(path);
  } catch {
    memo = null;
    return new Map();
  }
  if (memo && memo.mtimeMs === stat.mtimeMs) return memo.byCallsign;
  try {
    const rows = parseDssaCsv(readFileSync(path, "utf8"));
    const byCallsign = new Map(rows.map((r) => [r.callsign, r]));
    memo = { mtimeMs: stat.mtimeMs, byCallsign };
    return byCallsign;
  } catch {
    memo = null;
    return new Map();
  }
}

export function resetDssaMemo(): void {
  memo = null;
}

export function haveDssaData(): boolean {
  return existsSync(resolveDssaCachePath());
}

/**
 * Download the deployment list.
 *
 * Called alongside the carrier fetch rather than from a button of its own: 12 KB on the back of a
 * 21 MB download is not worth a second press, and the list is useless without the coordinates that
 * download carries. A failure here is not fatal — the carrier list still works, the DSSA filter just
 * has nothing to offer.
 */
export async function fetchDssaData(): Promise<{ ok: boolean; count?: number; error?: string }> {
  let res: Response;
  try {
    res = await fetch(DSSA_URL, {
      headers: { Accept: "text/csv,*/*", "User-Agent": EDASTRO_USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "DSSA request failed." };
  }
  if (!res.ok) return { ok: false, error: `EDAstro replied ${res.status} for the DSSA list.` };

  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "DSSA download failed." };
  }

  const rows = parseDssaCsv(text);
  // An error page parses to nothing. Keeping the previous good list beats replacing it with HTML.
  if (rows.length === 0) return { ok: false, error: "EDAstro returned no usable DSSA rows." };

  const path = resolveDssaCachePath();
  try {
    const tmp = `${path}.part`;
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, path);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the DSSA list." };
  }
  resetDssaMemo();
  return { ok: true, count: rows.length };
}
