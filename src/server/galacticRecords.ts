/**
 * Galactic records — the largest and smallest radius EDAstro knows for each star type and planet
 * class (guild tester report, 2026-09-30: "compare discoveries vs the galactic records").
 *
 * EDAstro publishes its records as pages, not files. Two of them carry every type's radius records at
 * once: `records/radius.html` (planets, km) and `records/solarRadius.html` (stars, solar radii),
 * about 1.3 MB together. An opt-in download the commander starts, at most weekly; the rows are kept
 * beside the user settings in metres, keyed like the app's own records (`star:K`, `planet:Water
 * world`). Some of EDAstro's minimums are placeholders from bad reports (a 6,371 km "gas giant"), so
 * the app calls them EDAstro's records, not facts.
 */
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveUserSettingsJsonPath } from "./paths.js";
import { APP_USER_AGENT } from "./appVersion.js";

const BASE = "https://edastro.com/records/";
const PAGES = [
  { page: "radius.html", subject: "planet" as const, toMetres: 1000 },
  { page: "solarRadius.html", subject: "star" as const, toMetres: 695_700_000 },
];
export const GALACTIC_RECORDS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const GALACTIC_RECORDS_SIZE_LABEL = "1.3 MB";

export interface GalacticRecord {
  /** `star:K`, `planet:Water world` — the key of the app's own records. */
  key: string;
  label: string;
  largest: { radius: number; body: string };
  smallest: { radius: number; body: string };
}

interface RecordsFile {
  formatVersion: 1;
  fetchedAtMs: number;
  records: GalacticRecord[];
}

export function resolveGalacticRecordsPath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-compare-galactic-records.json");
}

const PLANETS: Record<string, string> = {
  "Ammonia world": "Ammonia world",
  "Class I gas giant": "Sudarsky class I gas giant",
  "Class II gas giant": "Sudarsky class II gas giant",
  "Class III gas giant": "Sudarsky class III gas giant",
  "Class IV gas giant": "Sudarsky class IV gas giant",
  "Class V gas giant": "Sudarsky class V gas giant",
  "Earth-like world": "Earthlike body",
  "Gas giant with ammonia-based life": "Gas giant with ammonia based life",
  "Gas giant with water-based life": "Gas giant with water based life",
  "Helium gas giant": "Helium gas giant",
  "Helium-rich gas giant": "Helium rich gas giant",
  "High metal content world": "High metal content body",
  "Icy body": "Icy body",
  "Metal-rich body": "Metal rich body",
  "Rocky Ice world": "Rocky ice body",
  "Rocky body": "Rocky body",
  "Water giant": "Water giant",
  "Water world": "Water world",
};

const STARS: Record<string, string> = {
  "Black Hole": "H",
  "Supermassive Black Hole": "SupermassiveBlackHole",
  "Neutron Star": "N",
  "T Tauri Star": "TTS",
  "Herbig Ae/Be Star": "AeBe",
  "C Star": "C",
  "CJ Star": "CJ",
  "CN Star": "CN",
  "MS-type Star": "MS",
  "S-type Star": "S",
  "Wolf-Rayet Star": "W",
  "Wolf-Rayet C Star": "WC",
  "Wolf-Rayet N Star": "WN",
  "Wolf-Rayet NC Star": "WNC",
  "Wolf-Rayet O Star": "WO",
};

const GIANTS: Record<string, string> = {
  "A (Blue-White super giant) Star": "A_BlueWhiteSuperGiant",
  "B (Blue-White super giant) Star": "B_BlueWhiteSuperGiant",
  "F (White super giant) Star": "F_WhiteSuperGiant",
  "G (White-Yellow super giant) Star": "G_WhiteSuperGiant",
  "K (Yellow-Orange giant) Star": "K_OrangeGiant",
  "M (Red giant) Star": "M_RedGiant",
  "M (Red super giant) Star": "M_RedSuperGiant",
};

/** EDAstro's type label → the app's record key, or null for the ones the app does not track. */
export function recordKeyFor(label: string, subject: "star" | "planet"): string | null {
  if (subject === "planet") return PLANETS[label] ? `planet:${PLANETS[label]}` : null;
  if (STARS[label]) return `star:${STARS[label]}`;
  if (GIANTS[label]) return `star:${GIANTS[label]}`;
  const wd = /^White Dwarf \(([A-Z]+)\) Star$/.exec(label);
  if (wd) return `star:${wd[1]}`;
  const ms = /^([OBAFGKMLTY]) \([^)]*\) Star$/.exec(label);
  if (ms && !/giant/i.test(label)) return `star:${ms[1]}`;
  return null;
}

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8209;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const num = (s: string) => Number(s.replace(/[, ]|km/g, ""));

/*
  One records page → the per-type radius records it holds. Exported for tests.

  Each type is a table row: `<td class="recordname"><b>Water world</b><br/>(Radius)</td>`, then a
  "Highest:" and a "Lowest:" row, each with the value in a right-aligned cell and the body in the
  `recordlink` cell after it.
*/
export function parseRecordsPage(html: string, subject: "star" | "planet", toMetres: number): GalacticRecord[] {
  const out: GalacticRecord[] = [];
  const rows = html.split(/class="recordrow"/).slice(1);
  const valueOf = (chunk: string, which: "Highest" | "Lowest") => {
    const m = new RegExp(`${which}:</td>.*?<td align="right">([^<]+)</td>\\s*<td class="recordlink">(.*?)</td>`, "s").exec(chunk);
    if (!m) return null;
    const radius = num(text(m[1]!)) * toMetres;
    const body = text(m[2]!).replace(/^:\s*/, "");
    return Number.isFinite(radius) && radius > 0 && body ? { radius, body } : null;
  };
  for (const chunk of rows) {
    const h = /<td class="recordname"[^>]*>(.*?)<\/td>/s.exec(chunk);
    if (!h) continue;
    const head = text(h[1]!);
    const m = /^(.+?) \((?:Solar )?Radius\)$/.exec(head);
    if (!m || /\(as [^)]*\)|\(landable\)|ProcGen/.test(m[1]!)) continue;
    const key = recordKeyFor(m[1]!, subject);
    if (!key || out.some((r) => r.key === key)) continue;
    const largest = valueOf(chunk, "Highest");
    const smallest = valueOf(chunk, "Lowest");
    if (largest && smallest) out.push({ key, label: m[1]!, largest, smallest });
  }
  return out;
}

let memo: { mtimeMs: number; file: RecordsFile } | null = null;

function load(): RecordsFile | null {
  const p = resolveGalacticRecordsPath();
  let st;
  try {
    st = statSync(p);
  } catch {
    return null;
  }
  if (memo && memo.mtimeMs === st.mtimeMs) return memo.file;
  try {
    const file = JSON.parse(readFileSync(p, "utf8")) as RecordsFile;
    if (!Array.isArray(file.records)) return null;
    memo = { mtimeMs: st.mtimeMs, file };
    return file;
  } catch {
    return null;
  }
}

export function galacticRecords(): Map<string, GalacticRecord> {
  return new Map((load()?.records ?? []).map((r) => [r.key, r]));
}

export interface GalacticRecordsStatusDTO {
  haveData: boolean;
  count: number;
  fetchedAtMs: number | null;
  cooldownMsRemaining: number;
  sizeLabel: string;
}

export function readGalacticRecordsStatus(nowMs = Date.now()): GalacticRecordsStatusDTO {
  const f = load();
  return {
    haveData: f != null,
    count: f?.records.length ?? 0,
    fetchedAtMs: f?.fetchedAtMs ?? null,
    cooldownMsRemaining: f ? Math.max(0, GALACTIC_RECORDS_COOLDOWN_MS - (nowMs - f.fetchedAtMs)) : 0,
    sizeLabel: GALACTIC_RECORDS_SIZE_LABEL,
  };
}

/** Download both pages from EDAstro (the commander pressed the button). */
export async function fetchGalacticRecords(opts: { force?: boolean; fetchImpl?: typeof fetch } = {}): Promise<GalacticRecordsStatusDTO> {
  const st = readGalacticRecordsStatus();
  if (!opts.force && st.haveData && st.cooldownMsRemaining > 0) return st;
  const f = opts.fetchImpl ?? fetch;
  const records: GalacticRecord[] = [];
  for (const p of PAGES) {
    const res = await f(BASE + p.page, { headers: { "User-Agent": APP_USER_AGENT } });
    if (!res.ok) throw new Error(`EDAstro answered ${res.status} for ${p.page}`);
    records.push(...parseRecordsPage(await res.text(), p.subject, p.toMetres));
  }
  if (!records.length) throw new Error("EDAstro's records pages changed shape: nothing could be read.");
  const path = resolveGalacticRecordsPath();
  writeFileSync(`${path}.tmp`, JSON.stringify({ formatVersion: 1, fetchedAtMs: Date.now(), records } satisfies RecordsFile), "utf8");
  renameSync(`${path}.tmp`, path);
  memo = null;
  return readGalacticRecordsStatus();
}

export function hasGalacticRecords(): boolean {
  return existsSync(resolveGalacticRecordsPath());
}
