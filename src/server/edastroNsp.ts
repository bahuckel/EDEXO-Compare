/**
 * Notable stellar phenomena near the commander, from EDAstro's codex file.
 *
 * The POI catalogue knows about thirty NSPs; the game has tens of thousands. EDAstro publishes the
 * codex as one file, `codex-data.csv` — every logged codex entry with the system and its coordinates
 * (855 MB, 4.9 million rows on 2026-09-29). There is no NSP-only file and no "entries near me" query,
 * so this is an **opt-in download the commander starts**, with the size said on the button (owner,
 * 2026-09-30, "a"). The file is read as it streams and never stored: only the phenomena are kept, a
 * few megabytes, and the next refresh asks with the ETag first so an unchanged file costs nothing.
 *
 * ### Which rows are phenomena
 *
 * By codex id, never by name — the name column is sometimes localised (a Russian row turned up in
 * the survey). Measured on a 120,000-row sample and the owner's own journal:
 * - `codex_ent_gas_clds_*`   Lagrange clouds and storms (his "Proto-Lagrange Cloud" is `_light`)
 * - `codex_ent_small_org_*`  molluscs, squids and the other small space-borne life
 * - `codex_ent_l_*`          the large ones: trees, metallic / ice / silicate crystals
 * - `codex_ent_s_*`          pods (Peduncle, Aster, Chalice …)
 * - `codex_ent_spoi_*`       mineral spheres, Stolon pods, Gyre trees, Void hearts
 * (The same families the bundled EDSM codex lists under "biological" that are not plants.)
 *
 * Also kept, apart from the phenomena: `codex_ent_green_*`, green gas giant reports (owner,
 * 2026-09-30: "add them"). The file has no body column, so a report says which system has a green
 * gas giant of which class, not which body (shared/greenGasGiant.ts, `edastroReport`).
 * Surface biology, geology, Guardian and Thargoid sites are left out.
 *
 * Same rule as the carrier and POI lists: the file lands on the commander's machine from EDAstro
 * directly; nothing of it is in this repository or the installer.
 */
import { K10_CODEX_ID } from "../shared/greenGasGiant.js";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveUserSettingsJsonPath } from "./paths.js";
import { splitCsvLine } from "./edastroCarriers.js";
import { APP_USER_AGENT } from "./appVersion.js";

export const NSP_URL = "https://edastro.com/mapcharts/files/codex-data.csv";
/** What the button says; the real figure comes from the server's Content-Length once it starts. */
export const NSP_SOURCE_SIZE_LABEL = "855 MB";
/** The codex file is rebuilt weekly; asking more often than daily wastes nobody's time but EDAstro's. */
export const NSP_FETCH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const NSP_ID = /^codex_ent_(gas_clds|small_org|l_|s_|spoi|green_)/i;
/** Green gas giant reports ride in the same file but are not phenomena. */
const GREEN_ID = /^codex_ent_green_/;

/** One phenomenon type logged in one system. */
export interface NspRecord {
  id: string;
  /** English name when the file gave one, else the family ("Lagrange cloud"). */
  name: string;
  system: string;
  systemAddress: number | null;
  x: number;
  y: number;
  z: number;
}

/** Bumped whenever the rows kept change: an older file is fetched again in full, not "unchanged". */
const NSP_FILTER_VERSION = 3;

interface NspFile {
  formatVersion: 1;
  /** Which {@link NSP_ID} the rows were picked with (absent = 1: before pods and spheres). */
  filterVersion?: number;
  fetchedAtMs: number;
  etag: string | null;
  sourceBytes: number | null;
  /** [id, name, system, address, x, y, z] — short, because there are tens of thousands. */
  rows: [string, string, string, number | null, number, number, number][];
}

export interface NspStatusDTO {
  haveData: boolean;
  rowCount: number;
  systemCount: number;
  fetchedAtMs: number | null;
  running: boolean;
  bytesDone: number;
  bytesTotal: number | null;
  error: string | null;
  cooldownMsRemaining: number;
  sizeLabel: string;
}

export function resolveNspCachePath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-compare-nsp.json");
}

/** The family, for a row whose name is missing or not in English. */
export function nspFamilyLabel(id: string): string {
  const s = id.toLowerCase();
  if (s.startsWith("codex_ent_gas_clds")) return /storm/.test(s) ? "Lagrange storm cloud" : "Lagrange cloud";
  if (s.includes("moll")) return "Space mollusc";
  if (s.includes("squid")) return "Space squid";
  if (s.startsWith("codex_ent_small_org")) return "Space-borne life";
  if (s.includes("metcry")) return "Metallic crystals";
  if (s.includes("iccry")) return "Ice crystals";
  if (s.includes("qtzcry")) return "Silicate crystals";
  if (s.includes("_cry")) return "Crystals";
  if (s.startsWith("codex_ent_spoi_ball")) return "Mineral spheres";
  if (s.startsWith("codex_ent_spoi")) return "Space-borne life";
  if (s.includes("seed") && s.includes("pln")) return "Space-borne tree";
  if (s.includes("seed")) return "Space-borne pod";
  return "Notable stellar phenomenon";
}

/** Latin letters, digits and a little punctuation: an English codex name. */
const ENGLISH = /^[A-Za-z0-9 '\-().]+$/;

/** Keep the phenomena from one CSV line, given the header's column positions. Exported for tests. */
export function parseNspLine(
  line: string,
  col: { name: number; id: number; system: number; x: number; y: number; z: number; addr: number },
): NspRecord | null {
  if (!/codex_ent_(gas_clds|small_org|l_|s_|spoi|green_)/i.test(line)) return null;
  const f = splitCsvLine(line);
  const id = (f[col.id] ?? "").trim().toLowerCase();
  if (!NSP_ID.test(id)) return null;
  const x = Number(f[col.x]);
  const y = Number(f[col.y]);
  const z = Number(f[col.z]);
  if (![x, y, z].every(Number.isFinite) || (f[col.x] ?? "").trim() === "") return null;
  const rawName = (f[col.name] ?? "").trim();
  const addrN = Number(f[col.addr]);
  return {
    id,
    name: rawName && ENGLISH.test(rawName) ? rawName : nspFamilyLabel(id),
    system: (f[col.system] ?? "").trim(),
    systemAddress: Number.isFinite(addrN) && addrN > 0 ? addrN : null,
    x,
    y,
    z,
  };
}

export function nspColumns(header: string) {
  const cols = splitCsvLine(header).map((c) => c.trim().toLowerCase());
  const at = (pred: (c: string) => boolean) => cols.findIndex(pred);
  return {
    name: at((c) => c === "codex entry"),
    id: at((c) => c === "codex id"),
    system: at((c) => c === "system"),
    x: at((c) => c === "x"),
    y: at((c) => c === "y"),
    z: at((c) => c === "z"),
    addr: at((c) => c.includes("id64") || c.includes("system address")),
  };
}

type NspRow = NspFile["rows"][number];
let memo: { mtimeMs: number; file: NspFile; systems: number; nsp: NspRow[]; green: NspRow[] } | null = null;

function loadFile(): { file: NspFile; systems: number; nsp: NspRow[]; green: NspRow[] } | null {
  const p = resolveNspCachePath();
  let st;
  try {
    st = statSync(p);
  } catch {
    memo = null;
    return null;
  }
  if (memo && memo.mtimeMs === st.mtimeMs) return memo;
  try {
    const file = JSON.parse(readFileSync(p, "utf8")) as NspFile;
    if (!Array.isArray(file.rows)) return null;
    const nsp: NspRow[] = [];
    const green: NspRow[] = [];
    for (const r of file.rows) (GREEN_ID.test(r[0]) ? green : nsp).push(r);
    const systems = new Set(nsp.map((r) => r[3] ?? r[2])).size;
    memo = { mtimeMs: st.mtimeMs, file, systems, nsp, green };
    return memo;
  } catch {
    memo = null;
    return null;
  }
}

export function resetNspMemo(): void {
  memo = null;
}

const job = { running: false, bytesDone: 0, bytesTotal: null as number | null, error: null as string | null };

export function readNspStatus(nowMs: number = Date.now()): NspStatusDTO {
  const f = loadFile();
  const since = f ? nowMs - f.file.fetchedAtMs : Number.POSITIVE_INFINITY;
  return {
    haveData: f != null,
    rowCount: f?.nsp.length ?? 0,
    systemCount: f?.systems ?? 0,
    fetchedAtMs: f?.file.fetchedAtMs ?? null,
    running: job.running,
    bytesDone: job.bytesDone,
    bytesTotal: job.bytesTotal,
    error: job.error,
    cooldownMsRemaining: Number.isFinite(since) ? Math.max(0, NSP_FETCH_COOLDOWN_MS - since) : 0,
    sizeLabel: NSP_SOURCE_SIZE_LABEL,
  };
}

/**
 * Start the download in the background; the status says how far it got. One at a time, and not
 * within a day of the last, unless forced.
 */
export function startNspDownload(opts: { force?: boolean; fetchImpl?: typeof fetch } = {}): NspStatusDTO {
  const st = readNspStatus();
  if (job.running) return st;
  if (!opts.force && st.haveData && st.cooldownMsRemaining > 0) return st;
  job.running = true;
  job.bytesDone = 0;
  job.bytesTotal = null;
  job.error = null;
  void downloadNsp(opts.fetchImpl ?? fetch)
    .catch((e) => {
      job.error = e instanceof Error ? e.message : String(e);
    })
    .finally(() => {
      job.running = false;
    });
  return readNspStatus();
}

async function downloadNsp(fetchImpl: typeof fetch): Promise<void> {
  const prev = loadFile()?.file ?? null;
  const headers: Record<string, string> = { "User-Agent": APP_USER_AGENT };
  if (prev?.etag && prev.filterVersion === NSP_FILTER_VERSION) headers["If-None-Match"] = prev.etag;
  const res = await fetchImpl(NSP_URL, { headers });
  if (res.status === 304 && prev) {
    // Unchanged: keep the rows, restart the clock.
    writeNspFile({ ...prev, fetchedAtMs: Date.now() });
    return;
  }
  if (!res.ok || !res.body) throw new Error(`EDAstro answered ${res.status}`);
  const len = Number(res.headers.get("content-length"));
  job.bytesTotal = Number.isFinite(len) && len > 0 ? len : null;

  const seen = new Set<string>();
  const rows: NspFile["rows"] = [];
  let col: ReturnType<typeof nspColumns> | null = null;
  let rest = "";
  const decoder = new TextDecoder();
  const take = (line: string) => {
    if (!col) {
      col = nspColumns(line);
      if (col.id < 0 || col.x < 0) throw new Error("codex-data.csv changed shape (no Codex ID / X column)");
      return;
    }
    const r = parseNspLine(line, col);
    if (!r) return;
    const key = `${r.id}@${r.systemAddress ?? r.system}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push([r.id, r.name, r.system, r.systemAddress, r.x, r.y, r.z]);
  };
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    job.bytesDone += value.byteLength;
    const text = rest + decoder.decode(value, { stream: true });
    const lines = text.split("\n");
    rest = lines.pop() ?? "";
    for (const l of lines) take(l.replace(/\r$/, ""));
  }
  rest += decoder.decode();
  if (rest.trim()) take(rest.replace(/\r$/, ""));
  if (!col) throw new Error("codex-data.csv was empty");
  writeNspFile({
    formatVersion: 1,
    filterVersion: NSP_FILTER_VERSION,
    fetchedAtMs: Date.now(),
    etag: res.headers.get("etag"),
    sourceBytes: job.bytesDone,
    rows,
  });
}

function writeNspFile(file: NspFile): void {
  const p = resolveNspCachePath();
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(file), "utf8");
  renameSync(tmp, p);
  memo = null;
}

/** Phenomena within the radius, grouped by system, nearest system first. */
export function nearbyNsp(
  origin: { x: number; y: number; z: number },
  radiusLy: number,
): { system: string; systemAddress: number | null; distanceLy: number; names: string[] }[] {
  const f = loadFile();
  if (!f) return [];
  const bySys = new Map<string, { system: string; systemAddress: number | null; distanceLy: number; names: string[] }>();
  const r2 = radiusLy * radiusLy;
  for (const [, name, system, addr, x, y, z] of f.nsp) {
    const d2 = (x - origin.x) ** 2 + (y - origin.y) ** 2 + (z - origin.z) ** 2;
    if (d2 > r2) continue;
    const key = String(addr ?? system);
    const g = bySys.get(key);
    if (g) {
      if (!g.names.includes(name)) g.names.push(name);
    } else bySys.set(key, { system, systemAddress: addr, distanceLy: Math.sqrt(d2), names: [name] });
  }
  return [...bySys.values()].sort((a, b) => a.distanceLy - b.distanceLy);
}

/** Every system with a phenomenon, with the phenomena's names (the galaxy map's layer). */
export function nspBySystem(): { system: string; x: number; y: number; z: number; names: string[] }[] {
  const f = loadFile();
  if (!f) return [];
  const by = new Map<string, { system: string; x: number; y: number; z: number; names: string[] }>();
  for (const [, name, system, addr, x, y, z] of f.nsp) {
    const k = String(addr ?? system);
    const g = by.get(k);
    if (g) {
      if (!g.names.includes(name)) g.names.push(name);
    } else by.set(k, { system, x, y, z, names: [name] });
  }
  return [...by.values()];
}

/**
 * Systems with a K10-Type Anomaly in EDAstro's codex file — an NSP that only spawns around green gas
 * giants (shared/greenGasGiant.ts). Kept per file version; empty until the file is downloaded.
 */
let k10Memo: { file: NspFile; addrs: Set<number> } | null = null;
export function nspK10Systems(): ReadonlySet<number> {
  const f = loadFile();
  if (!f) return new Set();
  if (k10Memo?.file === f.file) return k10Memo.addrs;
  const addrs = new Set<number>();
  for (const [id, , , addr] of f.nsp) if (id === K10_CODEX_ID && typeof addr === "number") addrs.add(addr);
  k10Memo = { file: f.file, addrs };
  return addrs;
}

/** A green gas giant report in EDAstro's codex file: which system, which codex class, where. */
export interface EdastroGreenReport {
  system: string;
  systemAddress: number | null;
  codexIds: string[];
  x: number;
  y: number;
  z: number;
}

let greenMemo: { file: NspFile; list: EdastroGreenReport[]; byAddr: Map<number, EdastroGreenReport> } | null = null;
function greenReports() {
  const f = loadFile();
  if (!f) return null;
  if (greenMemo?.file === f.file) return greenMemo;
  const by = new Map<string, EdastroGreenReport>();
  for (const [id, , system, addr, x, y, z] of f.green) {
    const k = String(addr ?? system.toLowerCase());
    const g = by.get(k);
    if (g) {
      if (!g.codexIds.includes(id)) g.codexIds.push(id);
    } else by.set(k, { system, systemAddress: addr, codexIds: [id], x, y, z });
  }
  const list = [...by.values()];
  const byAddr = new Map<number, EdastroGreenReport>();
  for (const g of list) if (g.systemAddress != null) byAddr.set(g.systemAddress, g);
  greenMemo = { file: f.file, list, byAddr };
  return greenMemo;
}

/** Every system EDAstro has a green gas giant codex report for (empty until the file is downloaded). */
export function edastroGreenReports(): readonly EdastroGreenReport[] {
  return greenReports()?.list ?? [];
}

/** The green codex ids EDAstro has for one system, by address. */
export function edastroGreenFor(systemAddress: number): readonly string[] {
  return greenReports()?.byAddr.get(systemAddress)?.codexIds ?? [];
}

/** For tests: whether a cache file is present. */
export function hasNspCache(): boolean {
  return existsSync(resolveNspCachePath());
}
