/**
 * Per-species EDSM sample rows (CSV or JSON) as the Encyclopedia's exomastery table reads them. Split out of exomasteryEdsmEncyclopedia.ts (code review D, 2026-09-27).
 */
import {
  FeederStarSummary,
  resolveFeederHostSummaryForBody,
  syntheticStarTypeFromFeederSummary,
} from "../shared/feederStarHost.js";
import { journalStarPrimarySpectralLetter } from "../shared/genusStarColorSoft.js";
import type { SpeciesEntry } from "../shared/types.js";
import {
  exomasteryProfileCandidateFilenames,
  exomasterySpeciesLabelMatchesEntry,
  speciesSlug,
} from "./exomasteryProfile.js";
import { getSpeciesDataDir } from "./paths.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export { AU_METERS } from "../shared/journalPhysics.js";

const SKIP_HEADER_RE = /^(body_?id|system_?address|systemaddress|edsm_?id|^id$|market_?id|sqlite)/i;

export function shouldSkipColumn(key: string): boolean {
  const k = key.trim().toLowerCase().replace(/\s+/g, "_");
  if (SKIP_HEADER_RE.test(k)) return true;
  if (k === "bodyid" || k === "systemid") return true;
  return false;
}

/** CSV row with optional quoted fields */
function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelimiter(headerLine: string): string {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semis = (headerLine.match(/;/g) ?? []).length;
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  if (tabs >= semis && tabs >= commas && tabs > 0) return "\t";
  if (semis > commas) return ";";
  return ",";
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === ",") return parseCSVLine(line);
  return line.split(delimiter).map((s) => s.trim().replace(/^"|"$/g, ""));
}

function parseCSV(text: string): Record<string, string>[] {
  const t = text.replace(/^\uFEFF/, "").trim();
  if (!t) return [];
  const lines = t.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const delimiter = detectDelimiter(lines[0]!);
  const headers = splitDelimitedLine(lines[0]!, delimiter);
  const rows: Record<string, string>[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitDelimitedLine(lines[li]!, delimiter);
    if (cells.every((c) => !c)) continue;
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h.trim()] = cells[i] ?? "";
    });
    rows.push(o);
  }
  return rows;
}

function tryJsonPlanetArrays(raw: Record<string, unknown>): Record<string, unknown>[] | null {
  const keys = [
    "edsmPlanets",
    "edsmSamples",
    "edsmRows",
    "planetRows",
    "exportedPlanets",
    "planets",
    "samples",
    "bodies",
    "rows",
    "records",
    "data",
    "export",
  ];
  for (const k of keys) {
    const a = raw[k];
    if (Array.isArray(a) && a.length > 0) {
      const first = a[0];
      if (first && typeof first === "object") return a as Record<string, unknown>[];
    }
  }
  return null;
}

function deepTryJsonPlanetArrays(raw: Record<string, unknown>, depth = 0): Record<string, unknown>[] | null {
  if (depth > 6) return null;
  const direct = tryJsonPlanetArrays(raw);
  if (direct) return direct;
  for (const v of Object.values(raw)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const hit = deepTryJsonPlanetArrays(v as Record<string, unknown>, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function objectRowToStringRecord(o: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) out[k] = "";
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
    else if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v)) out[k] = JSON.stringify(v);
    else if (typeof v === "object") out[k] = JSON.stringify(v);
    else out[k] = String(v);
  }
  return out;
}

/** Planet-row exports from standalone JSON (not feeder numeric rollups). */
function extractEdsmRowsFromJson(parsed: unknown): Record<string, string>[] | null {
  if (Array.isArray(parsed) && parsed.length > 0) {
    const first = parsed[0];
    if (first && typeof first === "object") {
      return (parsed as Record<string, unknown>[]).map(objectRowToStringRecord);
    }
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const raw = parsed as Record<string, unknown>;
    const arr = deepTryJsonPlanetArrays(raw);
    if (arr && arr.length > 0) return arr.map(objectRowToStringRecord);
  }
  return null;
}

function enrichRowsWithFeederStarSummaries(
  rows: Record<string, string>[],
  rootMeta: Record<string, unknown>,
): void {
  const raw = rootMeta.starSummaries;
  if (!Array.isArray(raw) || raw.length === 0) return;
  const summaries: FeederStarSummary[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    if (!name.trim()) continue;
    summaries.push({
      name,
      subType: typeof o.subType === "string" ? o.subType : undefined,
      spectralClass: typeof o.spectralClass === "string" ? o.spectralClass : undefined,
      starType: typeof o.starType === "string" ? o.starType : undefined,
      subclass: typeof o.subclass === "number" ? o.subclass : undefined,
      luminosity: typeof o.luminosity === "string" ? o.luminosity : undefined,
      fullSpectralNotation: typeof o.fullSpectralNotation === "string" ? o.fullSpectralNotation : undefined,
    });
  }
  if (!summaries.length) return;
  for (const row of rows) {
    const body = row["BodyName"] || row["Body"] || row["Planet"] || row["bodyName"] || row["Body Name"] || "";
    const sys =
      row["StarSystem"] || row["Star system"] || row["System"] || row["system"] || row["SystemName"] || "";
    if (!body.trim()) continue;
    const hit = resolveFeederHostSummaryForBody(body, sys.trim(), summaries);
    if (!hit) continue;
    const syn = syntheticStarTypeFromFeederSummary(hit);
    const letterRaw = syn || hit.subType || "";
    const letter = journalStarPrimarySpectralLetter(letterRaw.trim() ? letterRaw : "—");
    row["Host spectral (sample file)"] = syn.trim() || "";
    row["Host class letter (sample file)"] = letter === "—" ? "" : letter;
  }
}

function finalizeLoadedEdsmRows(
  parsedRoot: unknown,
  rows: Record<string, string>[] | null,
): Record<string, string>[] | null {
  if (!rows?.length) return rows;
  if (parsedRoot && typeof parsedRoot === "object" && !Array.isArray(parsedRoot)) {
    enrichRowsWithFeederStarSummaries(rows, parsedRoot as Record<string, unknown>);
  }
  return rows;
}

/** `species_foo_exomastery` → `species_foo` for sibling `species_foo_edsm.csv`. */
function stripExomasteryJsonStem(stem: string): string {
  return stem.replace(/_exomastery_profile$/i, "").replace(/_exomastery$/i, "");
}

/** Slugs that may prefix an `*_edsm.csv` for this species. */
function collectEdsmCsvPrefixCandidates(entry: SpeciesEntry): Set<string> {
  const s = new Set<string>();
  const add = (raw: string) => {
    const x = speciesSlug(raw);
    if (x) s.add(x);
  };
  add(entry.displayName);
  add(`${entry.genus} ${entry.displayName}`);
  add(entry.id.replace(/__+/g, "_"));
  add(entry.id.replace(/__+/g, " "));
  for (const name of exomasteryProfileCandidateFilenames(entry)) {
    const stem = name.replace(/\.json$/i, "");
    s.add(stem);
    const stripped = stripExomasteryJsonStem(stem);
    if (stripped) s.add(stripped);
  }
  return s;
}

function tryReadCsvFile(csvPath: string): Record<string, string>[] | null {
  if (!existsSync(csvPath)) return null;
  try {
    const rows = parseCSV(readFileSync(csvPath, "utf8"));
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

/** Any `*_edsm.csv` in the genus folder or `exomastery/` whose name matches this species slugs. */
function tryReadEdsmCsvFromGenusDirs(
  genusDirs: string[],
  candidates: Set<string>,
): Record<string, string>[] | null {
  for (const genusDir of genusDirs) {
    let files: string[];
    try {
      files = readdirSync(genusDir);
    } catch {
      continue;
    }

    for (const f of files) {
      if (!/_edsm\.csv$/i.test(f) && !/-edsm\.csv$/i.test(f)) continue;

      let baseName = f.replace(/\.csv$/i, "");
      baseName = baseName.replace(/_edsm$/i, "").replace(/-edsm$/i, "");

      const keys = new Set<string>();
      for (const variant of [baseName, stripExomasteryJsonStem(baseName)]) {
        const x = speciesSlug(variant);
        if (x) keys.add(x);
      }

      let matched = false;
      for (const k of keys) {
        if (candidates.has(k)) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;

      const hit = tryReadCsvFile(join(genusDir, f));
      if (hit) return hit;
    }
  }

  return null;
}

export function loadEdsmPlanetStringRows(projectRoot: string, entry: SpeciesEntry): Record<string, string>[] {
  const base = join(getSpeciesDataDir(projectRoot), entry.genusDataDir);
  const exo = join(base, "exomastery");
  const csvStems = new Set<string>();
  const candidates = collectEdsmCsvPrefixCandidates(entry);

  for (const name of exomasteryProfileCandidateFilenames(entry)) {
    for (const dir of [base, exo]) {
      const p = join(dir, name);
      if (!existsSync(p)) continue;
      try {
        const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
        const rows = finalizeLoadedEdsmRows(parsed, extractEdsmRowsFromJson(parsed));
        if (rows && rows.length > 0) return rows;
      } catch {
        /* invalid JSON — still use this basename for CSV fallbacks */
      }
      csvStems.add(name.replace(/\.json$/i, ""));
    }
  }

  if (existsSync(exo)) {
    try {
      for (const f of readdirSync(exo)) {
        if (!f.toLowerCase().endsWith(".json")) continue;
        const p = join(exo, f);
        try {
          const j = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
          const label = typeof j.speciesLabel === "string" ? j.speciesLabel : undefined;
          const stem = f.replace(/\.json$/i, "");
          if (!exomasterySpeciesLabelMatchesEntry(entry, label, stem)) continue;
          const rows = finalizeLoadedEdsmRows(j, extractEdsmRowsFromJson(j));
          if (rows && rows.length > 0) return rows;
          csvStems.add(stem);
          const stripped = stripExomasteryJsonStem(stem);
          if (stripped) csvStems.add(stripped);
        } catch {
          continue;
        }
      }
    } catch {
      /* */
    }
  }

  for (const s of csvStems) {
    const stripped = stripExomasteryJsonStem(s);
    const stems = [...new Set([s, stripped].filter(Boolean) as string[])];
    for (const stem of stems) {
      const paths = [
        join(base, `${stem}_edsm.csv`),
        join(base, `${stem}-edsm.csv`),
        join(exo, `${stem}_edsm.csv`),
        join(exo, `${stem}-edsm.csv`),
      ];
      for (const csvPath of paths) {
        const hit = tryReadCsvFile(csvPath);
        if (hit) return hit;
      }
    }
  }

  const extraCsvNames = [
    `${speciesSlug(entry.displayName)}_edsm.csv`,
    `${speciesSlug(`${entry.genus} ${entry.displayName}`.trim())}_edsm.csv`,
    `${speciesSlug(entry.id.replace(/__+/g, "_"))}_edsm.csv`,
    `${entry.id.replace(/__+/g, "_")}_edsm.csv`,
  ];
  for (const f of extraCsvNames) {
    for (const dir of [base, exo]) {
      const hit = tryReadCsvFile(join(dir, f));
      if (hit) return hit;
    }
  }

  const scanned = tryReadEdsmCsvFromGenusDirs([base, exo], candidates);
  if (scanned) return scanned;

  return [];
}

export function countEdsmPlanetRows(projectRoot: string, entry: SpeciesEntry): number {
  return loadEdsmPlanetStringRows(projectRoot, entry).length;
}
