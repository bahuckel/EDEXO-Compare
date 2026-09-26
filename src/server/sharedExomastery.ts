/**
 * Exomastery and codex files: export, back up, share and merge (owner, 2026-09-26 — BACKLOG §S).
 *
 * "Your exomastery" is the on-foot catalog (`edexo-foot-scanned.json`): one entry per species
 * confirmed on a body, with that body's conditions. It is what makes the app learn — a body that
 * closely matches a confirmed one gets that species suggested (`augmentMatchesWithFootCatalog`).
 * "Your codex" is the per-region, per-colour record behind [CODEX] (`GameStateStore.codexRegionLogged`).
 *
 * Both can be downloaded as a file — to keep through a Windows reinstall, or to hand to other
 * commanders — and any number of such files dropped into `shared-exomastery\` beside the user data
 * are merged in:
 *
 * - **Other commanders' finds count exactly like your own** for learned candidates (his call), and a
 *   find on the very body you are looking at is shown as logged by them.
 * - **Your own files** (same commander `FID` as your journal) are a backup: they bring back finds and
 *   codex entries your journals no longer hold.
 * - **Other commanders' codex files** do not change your [CODEX] marks — that is your codex tab.
 * - The same species on the same body from several files is one find, with every commander who
 *   reported it; when their recorded conditions disagree, the one most of them agree on is kept.
 * - A shared find that breaks one of the species' own gates is reported under the mail icon, so a
 *   wrong row (or a gate that is wrong) gets looked at rather than silently believed.
 *
 * The folder is read lazily and cached on its listing (name, size, time), so dropping in or
 * removing a file takes effect on the next snapshot without a restart.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExoDataAlertDTO, FootScannedEntry, PlanetScan, SpeciesDatabase } from "../shared/types.js";
import { APP_VERSION } from "./appVersion.js";
import { resolveUserSettingsJsonPath } from "./paths.js";

export const EXOMASTERY_FILE_KIND = "edexo-exomastery";
export const CODEX_FILE_KIND = "edexo-codex";
export const SHARED_FORMAT_VERSION = 1;

export interface SharedCommander {
  name: string | null;
  /**
   * A one-way hash of Frontier's commander id ({@link commanderIdHash}), never the id itself: a file
   * handed to strangers should not carry an account identifier, and the hash still tells your own
   * backup from anyone else's.
   */
  fid: string | null;
}

/** `sha256("edexo:" + FID)`, first 16 hex characters — stable per commander, not reversible. */
export function commanderIdHash(fid: string | null | undefined): string | null {
  if (!fid || !fid.trim()) return null;
  return createHash("sha256").update(`edexo:${fid.trim()}`).digest("hex").slice(0, 16);
}

export interface ExomasteryExportFile {
  kind: typeof EXOMASTERY_FILE_KIND;
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  commander: SharedCommander;
  entries: FootScannedEntry[];
}

export interface CodexExportEntry {
  region: string;
  species: string;
  /** "" for a species with a single variant (Bark Mounds). */
  colour: string;
}

export interface CodexExportFile {
  kind: typeof CODEX_FILE_KIND;
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  commander: SharedCommander;
  entries: CodexExportEntry[];
}

/** One file in the shared folder, as the launcher lists it. */
export interface SharedFileSummary {
  file: string;
  kind: "exomastery" | "codex" | null;
  commander: string | null;
  fid: string | null;
  entries: number;
  /** Why the file was not used; absent when it was. */
  skipped?: string;
}

/** A find from the shared folder, merged across files. */
export interface SharedFind {
  entry: FootScannedEntry;
  commanders: SharedCommander[];
}

export interface SharedExomastery {
  signature: string;
  files: SharedFileSummary[];
  /** Merged finds by catalog id (`systemAddress:bodyId:species…`). */
  finds: Map<string, SharedFind>;
  /** Codex keys (`region|species|colour` + `region|species|*`) per commander FID. */
  codexByFid: Map<string, Set<string>>;
}

export function sharedExomasteryDir(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "shared-exomastery");
}

/**
 * Rows that must never leave the machine: an early test run wrote `Test Sector …` rows into the
 * owner's real catalog (found 2026-09-26). No real system is called that.
 */
function isTestLeftover(e: FootScannedEntry): boolean {
  return /^Test( Sector\b|$)/.test((e.starSystem ?? "").trim());
}

export function buildExomasteryExport(
  entries: readonly FootScannedEntry[],
  commander: SharedCommander,
  now = new Date(),
): ExomasteryExportFile {
  return {
    kind: EXOMASTERY_FILE_KIND,
    formatVersion: SHARED_FORMAT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    commander,
    entries: entries.filter((e) => !isTestLeftover(e)),
  };
}

export function buildCodexExport(
  keys: ReadonlySet<string>,
  commander: SharedCommander,
  now = new Date(),
): CodexExportFile {
  const entries: CodexExportEntry[] = [];
  for (const k of keys) {
    const [region, species, colour] = k.split("|");
    if (!region || !species || colour === undefined || colour === "*") continue;
    entries.push({ region, species, colour });
  }
  entries.sort((a, b) =>
    `${a.region}|${a.species}|${a.colour}`.localeCompare(`${b.region}|${b.species}|${b.colour}`),
  );
  return {
    kind: CODEX_FILE_KIND,
    formatVersion: SHARED_FORMAT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    commander,
    entries,
  };
}

/** `EDEXO-exomastery-FALrenica-2026-09-26.json` — the commander can rename it before sending. */
export function exportFileName(
  kind: "exomastery" | "codex",
  commanderName: string | null,
  now = new Date(),
): string {
  const who =
    (commanderName ?? "commander")
      .replace(/[^A-Za-z0-9 _-]+/g, "")
      .trim()
      .replace(/ +/g, "_") || "commander";
  return `EDEXO-${kind}-${who}-${now.toISOString().slice(0, 10)}.json`;
}

/* ------------------------------------------------------------------------------------ reading */

function isFootEntry(v: unknown): v is FootScannedEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.systemAddress === "number" &&
    typeof o.bodyId === "number" &&
    typeof o.planetClass === "string" &&
    typeof o.atmosphereNorm === "string" &&
    typeof o.genusLocalised === "string" &&
    typeof o.speciesLocalised === "string" &&
    typeof o.tempMidK === "number"
  );
}

function commanderOf(raw: unknown): SharedCommander {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : null,
    fid: typeof o.fid === "string" && o.fid.trim() ? o.fid.trim() : null,
  };
}

/** The conditions a find was recorded with, for comparing duplicates. */
function conditionsKey(e: FootScannedEntry): string {
  return [
    e.planetClass,
    e.atmosphereNorm,
    e.surfacePressure,
    e.surfaceTemperatureK,
    e.surfaceGravityMs2,
  ].join("|");
}

function listingSignature(dir: string): { signature: string; names: string[] } {
  let names: string[] = [];
  try {
    names = readdirSync(dir)
      .filter((n) => /\.json$/i.test(n))
      .sort();
  } catch {
    return { signature: "none", names: [] };
  }
  const parts = names.map((n) => {
    try {
      const st = statSync(join(dir, n));
      return `${n}:${st.size}:${st.mtimeMs}`;
    } catch {
      return `${n}:?`;
    }
  });
  return { signature: parts.join(","), names };
}

let cache: SharedExomastery | null = null;
let cacheDir: string | null = null;
let checkedAt = 0;
/**
 * How often the folder listing is looked at. Every body computed asks, many times over; a file
 * dropped into the folder shows up within this long, which is instant to a person.
 */
const RECHECK_MS = 2000;

/** Read and merge the shared folder, cached on its listing. Creates the folder so it can be opened. */
export function loadSharedExomastery(dirArg?: string): SharedExomastery {
  // Checked before the path is even worked out: resolving it touches the disk too.
  if (cache && (dirArg === undefined || cacheDir === dirArg) && Date.now() - checkedAt < RECHECK_MS) {
    return cache;
  }
  const dir = dirArg ?? sharedExomasteryDir();
  checkedAt = Date.now();
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* read-only location: nothing to share */
  }
  const { signature, names } = listingSignature(dir);
  if (cache && cacheDir === dir && cache.signature === signature) return cache;

  const files: SharedFileSummary[] = [];
  const grouped = new Map<
    string,
    { byConditions: Map<string, FootScannedEntry[]>; commanders: SharedCommander[] }
  >();
  const codexByFid = new Map<string, Set<string>>();

  for (const file of names) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), "utf8").replace(/^\uFEFF/, ""));
    } catch {
      files.push({
        file,
        kind: null,
        commander: null,
        fid: null,
        entries: 0,
        skipped: "not a JSON file the app can read",
      });
      continue;
    }
    const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const who = commanderOf(o.commander);
    if (o.kind !== EXOMASTERY_FILE_KIND && o.kind !== CODEX_FILE_KIND) {
      files.push({
        file,
        kind: null,
        commander: who.name,
        fid: who.fid,
        entries: 0,
        skipped: "not an EDEXO exomastery or codex file",
      });
      continue;
    }
    const kind = o.kind === EXOMASTERY_FILE_KIND ? "exomastery" : "codex";
    if (o.formatVersion !== SHARED_FORMAT_VERSION) {
      files.push({
        file,
        kind,
        commander: who.name,
        fid: who.fid,
        entries: 0,
        skipped: `format ${String(o.formatVersion)} — made by a different version of the app`,
      });
      continue;
    }
    const list = Array.isArray(o.entries) ? o.entries : [];
    if (kind === "exomastery") {
      let used = 0;
      for (const e of list) {
        if (!isFootEntry(e) || isTestLeftover(e)) continue;
        used++;
        const g = grouped.get(e.id) ?? {
          byConditions: new Map<string, FootScannedEntry[]>(),
          commanders: [] as SharedCommander[],
        };
        const ck = conditionsKey(e);
        g.byConditions.set(ck, [...(g.byConditions.get(ck) ?? []), e]);
        if (!g.commanders.some((c) => c.fid === who.fid && c.name === who.name)) g.commanders.push(who);
        grouped.set(e.id, g);
      }
      files.push({ file, kind, commander: who.name, fid: who.fid, entries: used });
    } else {
      const set = codexByFid.get(who.fid ?? `name:${who.name ?? file}`) ?? new Set<string>();
      let used = 0;
      for (const e of list) {
        const r = e && typeof e === "object" ? (e as Record<string, unknown>) : null;
        if (
          !r ||
          typeof r.region !== "string" ||
          typeof r.species !== "string" ||
          typeof r.colour !== "string"
        )
          continue;
        set.add(`${r.region}|${r.species}|${r.colour}`);
        set.add(`${r.region}|${r.species}|*`);
        used++;
      }
      codexByFid.set(who.fid ?? `name:${who.name ?? file}`, set);
      files.push({ file, kind, commander: who.name, fid: who.fid, entries: used });
    }
  }

  const finds = new Map<string, SharedFind>();
  for (const [id, g] of grouped) {
    // The conditions most reports agree on; ties go to the most recent record.
    const best = [...g.byConditions.values()].sort(
      (a, b) =>
        b.length - a.length ||
        Math.max(...b.map((e) => Date.parse(e.recordedAt) || 0)) -
          Math.max(...a.map((e) => Date.parse(e.recordedAt) || 0)),
    )[0]!;
    finds.set(id, { entry: best[0]!, commanders: g.commanders });
  }

  cache = { signature, files, finds, codexByFid };
  cacheDir = dir;
  return cache;
}

export function clearSharedExomasteryCache(): void {
  cache = null;
  cacheDir = null;
  checkedAt = 0;
}

/* ------------------------------------------------------------------------- whose data is whose */

let own: SharedCommander = { name: null, fid: null };

/** The commander the journals belong to — set by the snapshot, read by the catalog consumers. */
export function setOwnCommander(c: SharedCommander): void {
  own = c;
}

export function ownCommander(): SharedCommander {
  return own;
}

export function isOwnCommander(c: SharedCommander): boolean {
  if (own.fid && c.fid) return own.fid === c.fid;
  return !!own.name && !!c.name && own.name.toLowerCase() === c.name.toLowerCase() && !c.fid;
}

/** Finds from the shared folder, with whether each is (also) one of your own backups. */
export interface OwnedFind {
  find: SharedFind;
  own: boolean;
  others: SharedCommander[];
}

let ownedMemo: { key: string; list: OwnedFind[]; byBody: Map<string, OwnedFind[]> } | null = null;

/**
 * Worked out once per folder change and per commander: every body computed reads this, and at a
 * couple of hundred commanders it is ~100,000 finds.
 */
function owned(s: SharedExomastery): { list: OwnedFind[]; byBody: Map<string, OwnedFind[]> } {
  const key = `${s.signature}#${own.fid ?? ""}#${own.name ?? ""}`;
  if (ownedMemo?.key === key) return ownedMemo;
  const list: OwnedFind[] = [];
  const byBody = new Map<string, OwnedFind[]>();
  for (const find of s.finds.values()) {
    const others = find.commanders.filter((c) => !isOwnCommander(c));
    const row = { find, own: others.length < find.commanders.length, others };
    list.push(row);
    const bk = `${find.entry.systemAddress}:${find.entry.bodyId}`;
    byBody.set(bk, [...(byBody.get(bk) ?? []), row]);
  }
  ownedMemo = { key, list, byBody };
  return ownedMemo;
}

export function sharedFindsWithOwnership(s: SharedExomastery = loadSharedExomastery()): OwnedFind[] {
  return owned(s).list;
}

/** The shared finds on one body — the provenance lookup, without walking every find. */
export function sharedFindsOnBody(
  systemAddress: number,
  bodyId: number,
  s: SharedExomastery = loadSharedExomastery(),
): OwnedFind[] {
  return owned(s).byBody.get(`${systemAddress}:${bodyId}`) ?? [];
}

/** Your own codex backup(s): keys to add to the journal-built record. */
export function ownCodexBackupKeys(s: SharedExomastery = loadSharedExomastery()): Set<string> {
  const out = new Set<string>();
  for (const [key, set] of s.codexByFid) {
    const fid = key.startsWith("name:") ? null : key;
    const name = key.startsWith("name:") ? key.slice(5) : null;
    if (isOwnCommander({ fid, name })) for (const k of set) out.add(k);
  }
  return out;
}

export function sharedSignature(): string {
  return `${loadSharedExomastery().signature}#${own.fid ?? own.name ?? ""}`;
}

/* ------------------------------------------------------------------------------ gate check */

/** The scan a find's recorded conditions describe — only the fields a find carries. */
export function scanFromFind(e: FootScannedEntry): PlanetScan {
  const t = e.surfaceTemperatureK ?? e.tempMidK;
  return {
    PlanetClass: e.planetClass,
    AtmosphereType: e.atmosphereNorm || "None",
    Atmosphere: e.atmosphereNorm ? e.atmosphereNorm : "",
    SurfaceTemperature: t,
    ...(typeof e.surfaceGravityMs2 === "number" ? { SurfaceGravity: e.surfaceGravityMs2 } : {}),
    ...(typeof e.surfacePressure === "number" ? { SurfacePressure: e.surfacePressure } : {}),
    Landable: true,
  } as PlanetScan;
}

/** Fields a find records; a gate on anything else cannot be judged from the file. */
const JUDGEABLE_FIELDS = new Set([
  "PlanetClass",
  "AtmosphereType",
  "SurfaceTemperature",
  "SurfaceGravity",
  "SurfacePressure",
]);

/**
 * Other commanders' finds that break one of their species' own hard gates, as mail-icon notices.
 * Passed in rather than imported, so this module stays free of the matcher's dependencies.
 */
export function sharedGateAlerts(
  db: SpeciesDatabase,
  resolveEntry: (e: FootScannedEntry, db: SpeciesDatabase) => SpeciesDatabase["species"][number] | null,
  check: (
    entry: SpeciesDatabase["species"][number],
    scan: PlanetScan,
    band: { minK: number; maxK: number },
    range: { tMin: number; tMax: number; tMid: number },
  ) => { ok: boolean; reasons: { field: string; detail: string; soft?: boolean }[] },
  s: SharedExomastery = loadSharedExomastery(),
): ExoDataAlertDTO[] {
  const out: ExoDataAlertDTO[] = [];
  for (const { find, others } of sharedFindsWithOwnership(s)) {
    if (others.length === 0) continue; // your own finds are checked from your journals already
    const e = find.entry;
    const entry = resolveEntry(e, db);
    if (!entry) continue;
    const scan = scanFromFind(e);
    const r = check(
      entry,
      scan,
      { minK: e.tempBandMinK, maxK: e.tempBandMaxK },
      { tMin: e.tempBandMinK, tMax: e.tempBandMaxK, tMid: e.tempMidK },
    );
    if (r.ok) continue;
    const broken = r.reasons.filter((x) => !x.soft && JUDGEABLE_FIELDS.has(x.field));
    if (broken.length === 0) continue;
    const who = others.map((c) => (c.name ? `CMDR ${c.name}` : "a commander")).join(", ");
    out.push({
      id: `shared-gate:${e.id}`,
      severity: "warning",
      detectionSource: "exomastery",
      title: `Shared find breaks a gate: ${e.speciesLocalised} on ${e.bodyName}`,
      detail:
        `${who} reported ${e.variantLocalised || e.speciesLocalised} on ${e.bodyName} (${e.planetClass}, ` +
        `${e.atmosphereNorm || "no atmosphere"}, ${Math.round(scan.SurfaceTemperature ?? 0)} K). ` +
        `The app's rules for this species say it cannot grow there: ${broken.map((x) => `${x.field} — ${x.detail}`).join("; ")}. ` +
        `Either the find is wrong or the rule is — worth a look. Shared files are in the shared-exomastery folder.`,
      speciesEntryId: entry.id,
      genusDataDir: entry.genusDataDir,
    });
  }
  return out;
}
