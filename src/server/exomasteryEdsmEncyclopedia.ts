import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  BodyExoState,
  EncyclopediaExomasteryFieldDTO,
  EncyclopediaExomasteryFocusBodyDTO,
  EncyclopediaExomasteryPlanetDTO,
  EncyclopediaExomasteryPlanetsResponseDTO,
  EncyclopediaExomasterySectionDTO,
  ExplorationScanRecord,
  ExomasteryStatDistributionDTO,
  PlanetScan,
  SpeciesEntry,
} from "../shared/types.js";
import { journalPressureToAtm, journalSurfaceGravityToG } from "../shared/journalPhysics.js";
import {
  exomasteryAtmosphereTypeCompareKey,
  exomasteryCompositionRollupDisplay,
  exomasteryPathTailLower,
  exomasteryProfileCandidateFilenames,
  exomasteryRollupValueDisplay,
  exomasterySpeciesLabelMatchesEntry,
  buildExomasteryDetail,
  buildNumericDistributionDto,
  exomasteryHabitatQualityPercent,
  exomasteryObservationForProfilePath,
  feederProfileBodyCount,
  formatExomasteryNum,
  formatPathLabel,
  loadExomasteryProfile,
  speciesSlug,
  type ExomasteryNumericRollup,
  type ExomasteryProfileV1,
} from "./exomasteryProfile.js";
import { shortBodyLabel } from "../shared/systemMapLabels.js";
import { mergeScanForExomastery } from "./footScannedCatalog.js";
import { shouldOmitExomasterySciencePath, shouldOmitDataColumnKey } from "./exomasteryPathHygiene.js";
import { buildSpeciesMatchContext } from "./speciesMatchContext.js";
import { journalHostObservationFromSpeciesContext } from "./journalHostObservation.js";
import type { GameStateStore } from "./gameState.js";
import { getSpeciesDataDir } from "./paths.js";
import type { FeederStarSummary } from "../shared/feederStarHost.js";
import {
  resolveFeederHostSummaryForBody,
  syntheticStarTypeFromFeederSummary,
} from "../shared/feederStarHost.js";
import { journalStarPrimarySpectralLetter } from "../shared/genusStarColorSoft.js";

const AU_METERS = 149_597_870_700;

const SKIP_HEADER_RE = /^(body_?id|system_?address|systemaddress|edsm_?id|^id$|market_?id|sqlite)/i;

function shouldSkipColumn(key: string): boolean {
  const k = key.trim().toLowerCase().replace(/\s+/g, "_");
  if (SKIP_HEADER_RE.test(k)) return true;
  if (k === "bodyid" || k === "systemid") return true;
  return false;
}

function deviationToTier(pct: number): EncyclopediaExomasteryFieldDTO["tier"] {
  if (pct < 1) return "blue";
  if (pct <= 5) return "green";
  if (pct <= 7.5) return "yellow";
  if (pct <= 10) return "orange";
  return "red";
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

function normalizeHeaderKey(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function isAtmosphereTypeColumn(label: string): boolean {
  const n = normalizeHeaderKey(label);
  return (
    (n.includes("atmosphere") || n.includes("atmo type")) &&
    !n.includes("composition") &&
    !n.includes("pressure") &&
    !n.includes("percent") &&
    !n.includes("%")
  );
}

function isPressureColumn(label: string): boolean {
  const n = normalizeHeaderKey(label);
  return n.includes("pressure") || n.includes("surf press");
}

function isGravityColumn(label: string): boolean {
  const n = normalizeHeaderKey(label);
  return n.includes("gravity") && !n.includes("tidal");
}

function isSemiMajorAxisColumn(label: string): boolean {
  const n = normalizeHeaderKey(label);
  return (n.includes("semi") && n.includes("major")) || n.includes("semimajor");
}

function isRadiusColumn(label: string): boolean {
  const n = normalizeHeaderKey(label);
  return n === "radius" || n.endsWith(" radius") || n.includes("body radius");
}

function isDistanceLsColumn(label: string): boolean {
  const n = normalizeHeaderKey(label);
  return n.includes("distance") && (n.includes("arrival") || n.includes("star"));
}

function normalizeCategoricalValue(header: string, val: string): string {
  const v = val.trim();
  if (!v) return "";
  if (isAtmosphereTypeColumn(header)) return exomasteryAtmosphereTypeCompareKey(v);
  return v.toLowerCase().trim();
}

function parseNumericCell(header: string, raw: string): number | null {
  const s = raw.trim().replace(/,/g, "").replace(/\s+/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (isPressureColumn(header)) return journalPressureToAtm(n);
  if (isGravityColumn(header)) {
    if (Math.abs(n) > 50) return journalSurfaceGravityToG(n);
    return n;
  }
  if (isSemiMajorAxisColumn(header) && Math.abs(n) > 1e8) return n / AU_METERS;
  return n;
}

function formatDisplayValue(header: string, raw: string): string {
  const num = parseNumericCell(header, raw);
  if (num != null && Number.isFinite(num)) {
    let suffix = "";
    if (isPressureColumn(header)) suffix = " atm";
    else if (isGravityColumn(header)) suffix = " g";
    else if (isSemiMajorAxisColumn(header)) suffix = " AU";
    else if (isRadiusColumn(header)) suffix = " m";
    else if (isDistanceLsColumn(header)) suffix = " LS";
    return `${formatExomasteryNum(num)}${suffix}`;
  }
  return raw.trim() || "—";
}

function collectColumnKeys(rows: Record<string, string>[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (shouldSkipColumn(k)) continue;
      set.add(k);
    }
  }
  return [...set]
    .filter((key) => rows.some((r) => (r[key] ?? "").trim()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function isNumericColumn(key: string, rows: Record<string, string>[]): boolean {
  let n = 0;
  let ok = 0;
  for (const r of rows) {
    const raw = r[key] ?? "";
    if (!raw.trim()) continue;
    n++;
    const p = parseNumericCell(key, raw);
    if (p != null && Number.isFinite(p)) ok++;
  }
  if (n === 0) return false;
  return ok / n >= 0.85;
}

function encyclopediaRollupDisplay(path: string, raw: number): { displayNumber: number; suffix: string } {
  const low = path.toLowerCase();
  if (
    low.includes(".materials.") ||
    (low.includes("materials") && low.includes("body")) ||
    (low.includes("atmosphere") && low.includes("composition")) ||
    (low.includes("solid") && low.includes("composition"))
  ) {
    return exomasteryCompositionRollupDisplay(raw);
  }
  return exomasteryRollupValueDisplay(path, raw);
}

const EXO_SECTION_ORDER = ["Atmosphere", "Crust & surface", "Orbit & location", "Miscellaneous"] as const;

function buildOrderedSections(
  fields: EncyclopediaExomasteryFieldDTO[],
  sectionFor: (f: EncyclopediaExomasteryFieldDTO) => string,
): EncyclopediaExomasterySectionDTO[] {
  const buckets = new Map<string, EncyclopediaExomasteryFieldDTO[]>();
  for (const f of fields) {
    const t = sectionFor(f);
    const arr = buckets.get(t) ?? [];
    arr.push(f);
    buckets.set(t, arr);
  }
  const seenTitles = new Set<string>();
  const out: EncyclopediaExomasterySectionDTO[] = [];
  for (const title of EXO_SECTION_ORDER) {
    const fs = buckets.get(title);
    if (fs?.length) {
      out.push({ title, fields: fs });
      seenTitles.add(title);
    }
  }
  for (const [title, fs] of buckets) {
    if (!seenTitles.has(title) && fs.length) out.push({ title, fields: fs });
  }
  return out;
}

function profilePathSection(path: string): string {
  const low = path.toLowerCase();
  if (/\bid64\b|systemid64|bodyid64/i.test(low)) {
    return "Miscellaneous";
  }
  if (
    /body_?id|system_?address|(^|[._])id($|[._])|edsm|market|sqlite/i.test(low) ||
    low.endsWith(".id") ||
    low.includes("sqlite")
  ) {
    return "Miscellaneous";
  }
  if (
    low.includes("atmospherecomposition") ||
    low.includes("atmosphere_composition") ||
    (low.includes("atmosphere") && low.includes("composition"))
  ) {
    return "Atmosphere";
  }
  if (
    low.includes("semimajor") ||
    low.includes("semi_major") ||
    low.includes("orbital") ||
    low.includes("eccentric") ||
    (low.includes("distance") && (low.includes("ls") || low.includes("star") || low.includes("arrival")))
  ) {
    return "Orbit & location";
  }
  if (low.includes("pressure") || (low.includes("atmosphere") && !low.includes("composition")))
    return "Atmosphere";
  if (
    low.includes("solidcomposition") ||
    low.includes("solid_composition") ||
    low.includes("materials") ||
    low.includes("volcanism") ||
    low.includes("gravity") ||
    low.includes("radius") ||
    low.includes("temperature") ||
    low.includes("temp") ||
    low.includes("landable") ||
    low.includes("terraform") ||
    low.includes("planetclass") ||
    low.includes("planet_class")
  ) {
    return "Crust & surface";
  }
  return "Crust & surface";
}

function edsmColumnSection(key: string): string {
  const n = normalizeHeaderKey(key);
  if (shouldSkipColumn(key)) return "Miscellaneous";
  if (isAtmosphereTypeColumn(key) || isPressureColumn(key)) return "Atmosphere";
  if (n.includes("atmosphere") && (n.includes("composition") || n.includes("%"))) return "Atmosphere";
  if (n.includes("material") || (n.includes("composition") && !n.includes("atmosphere")))
    return "Crust & surface";
  if (
    isGravityColumn(key) ||
    isRadiusColumn(key) ||
    n.includes("volcan") ||
    n.includes("terraform") ||
    n.includes("landable")
  )
    return "Crust & surface";
  if (n.includes("temp") && !n.includes("star")) return "Crust & surface";
  if (isSemiMajorAxisColumn(key) || isDistanceLsColumn(key) || n.includes("orbital"))
    return "Orbit & location";
  if (
    n.includes("(sample file)") ||
    (n.includes("host") && (n.includes("spectral") || n.includes("class")))
  ) {
    return "Star & system";
  }
  if (
    n.includes("star system") ||
    n === "starsystem" ||
    (n.includes("system") && (n.includes("name") || n.endsWith("system"))) ||
    (n.includes("body") && n.includes("name"))
  ) {
    return "Orbit & location";
  }
  if (n.includes("id") || n.includes("address")) return "Miscellaneous";
  return "Crust & surface";
}

function edsmNumericFieldDistribution(
  columnKey: string,
  cohortMin: number,
  cohortMax: number,
  cohortMean: number,
  current: number | null,
): ExomasteryStatDistributionDTO | null {
  if (!Number.isFinite(cohortMin) || !Number.isFinite(cohortMax) || !Number.isFinite(cohortMean)) return null;
  return {
    min: cohortMin,
    max: cohortMax,
    mode: cohortMean,
    current: current != null && Number.isFinite(current) ? current : null,
    displayPath: columnKey,
    minLabel: formatDisplayValue(columnKey, String(cohortMin)),
    maxLabel: formatDisplayValue(columnKey, String(cohortMax)),
  };
}

function buildProfileNumericField(
  labelPath: string,
  displayPath: string,
  r: ExomasteryNumericRollup,
  id: string,
  currentValue: number | null = null,
): EncyclopediaExomasteryFieldDTO {
  const modeRaw = r.mode ?? r.mean;
  const meanRaw = r.mean;
  const den = Math.max(Math.abs(meanRaw), 1e-12);
  const deviationPercent = (Math.abs(modeRaw - meanRaw) / den) * 100;

  const dMode = encyclopediaRollupDisplay(displayPath, modeRaw);
  const dMean = encyclopediaRollupDisplay(displayPath, meanRaw);
  const typicalDisplay = `${formatExomasteryNum(dMean.displayNumber)}${dMean.suffix}`;
  const modeDisplay = `${formatExomasteryNum(dMode.displayNumber)}${dMode.suffix}`;
  const valueDisplay = `mode ${modeDisplay} · μ ${typicalDisplay}`;
  const deviationDisplay = `${Math.round(deviationPercent * 10) / 10}%`;

  const dMin = encyclopediaRollupDisplay(displayPath, r.min);
  const dMax = encyclopediaRollupDisplay(displayPath, r.max);
  const ctxParts = [
    `min ${formatExomasteryNum(dMin.displayNumber)}${dMin.suffix} · max ${formatExomasteryNum(dMax.displayNumber)}${dMax.suffix}`,
    typeof r.count === "number" ? `n=${r.count}` : null,
    typeof r.modeCount === "number" ? `modeCount=${r.modeCount}` : null,
  ].filter(Boolean);

  const distribution = buildNumericDistributionDto(displayPath, r, currentValue);

  return {
    id,
    columnKey: labelPath,
    label: formatPathLabel(labelPath),
    valueDisplay,
    typicalDisplay,
    modeDisplay,
    deviationDisplay,
    tier: deviationToTier(deviationPercent),
    deviationPercent: Math.round(deviationPercent * 100) / 100,
    contextNote: ctxParts.join(" · "),
    distribution,
  };
}

function buildProfileCategoricalField(
  path: string,
  counts: Record<string, number>,
  id: string,
): EncyclopediaExomasteryFieldDTO {
  const entries = Object.entries(counts).filter(([, c]) => c > 0);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  let modeLabel = "";
  let modeC = -1;
  for (const [k, c] of entries) {
    if (c > modeC) {
      modeC = c;
      modeLabel = k;
    }
  }
  const k = Math.max(entries.length, 1);
  const uniform = 100 / k;
  const modeShare = total > 0 ? (modeC / total) * 100 : 0;
  const deviationPercent = uniform > 1e-9 ? (Math.abs(modeShare - uniform) / uniform) * 100 : 0;

  const deviationDisplay = `${Math.round(deviationPercent * 10) / 10}%`;
  const typicalDisplay = `${formatExomasteryNum(uniform)}% bucket`;
  const modeDisplay = `"${modeLabel}" (${formatExomasteryNum(modeShare)}%)`;

  return {
    id,
    columnKey: path,
    label: formatPathLabel(path),
    valueDisplay: `mode "${modeLabel}" (${formatExomasteryNum(modeShare)}%) · uniform ${formatExomasteryNum(uniform)}%`,
    typicalDisplay,
    modeDisplay,
    deviationDisplay,
    tier: deviationToTier(deviationPercent),
    deviationPercent: Math.round(deviationPercent * 100) / 100,
    contextNote: `total n=${total} · ${k} buckets`,
  };
}

function encyclopediaScanBodyKey(systemAddress: number, bodyId: number): string {
  return `${systemAddress}:${bodyId}`;
}

function encyclopediaResolveStarForBodyTab(b: BodyExoState, store: GameStateStore): string {
  const fromBody = b.starSystem?.trim();
  if (fromBody) return fromBody;
  const fromVisit = store.visitedSystems.get(b.systemAddress)?.trim();
  if (fromVisit) return fromVisit;
  return (store.currentSystem ?? "").trim();
}

function encyclopediaBodyTabLabel(b: BodyExoState, store: GameStateStore): string {
  const sk = encyclopediaScanBodyKey(b.systemAddress, b.bodyId);
  const rec = store.explorationScans.get(sk);
  const star = encyclopediaResolveStarForBodyTab(b, store);
  const fromRec = rec?.bodyName?.trim();
  const fromState = b.bodyName?.trim();
  const isGeneric = (s: string) => /^body\s+\d+$/i.test(s);
  let full = "";
  if (fromRec && !isGeneric(fromRec)) full = fromRec;
  else if (fromState && !isGeneric(fromState)) full = fromState;
  else if (fromRec) full = fromRec;
  else if (fromState) full = fromState;
  if (!full) return `Body ${b.bodyId}`;
  if (isGeneric(full)) return full;
  return shortBodyLabel(full, star);
}

/** Same habitat math as Candidate species → Similarity index; works for any species with a feeder profile. */
export function buildEncyclopediaFocusBodyMatch(
  store: GameStateStore,
  profile: ExomasteryProfileV1,
  focusBodyKey: string,
): EncyclopediaExomasteryFocusBodyDTO {
  const key = focusBodyKey.trim();
  const b = store.bodies.get(key);
  if (!b) {
    return {
      bodyKey: key,
      bodyTabLabel: key,
      starSystem: "—",
      planetClass: null,
      habitatMatchPercent: null,
      unavailableReason:
        "That body is not in the current system’s bio tab list — select a BODY on the main screen (or sync journals) before comparing in the Encyclopedia.",
      detail: null,
    };
  }
  const sk = encyclopediaScanBodyKey(b.systemAddress, b.bodyId);
  const explorationRec = store.explorationScans.get(sk) ?? null;
  const mergedScan = mergeScanForExomastery(b.scan, explorationRec);
  const tab = encyclopediaBodyTabLabel(b, store);
  const star = encyclopediaResolveStarForBodyTab(b, store);
  if (!mergedScan?.PlanetClass?.trim()) {
    return {
      bodyKey: key,
      bodyTabLabel: tab,
      starSystem: star,
      planetClass: null,
      habitatMatchPercent: null,
      unavailableReason:
        "No merged detailed planetary scan for this body yet — FSS / Detail Scan lines in the journal are required (class, materials, atmosphere).",
      detail: null,
    };
  }
  const speciesMatchCtx = buildSpeciesMatchContext(b, store);
  const journalHost = journalHostObservationFromSpeciesContext(speciesMatchCtx);
  const hq = exomasteryHabitatQualityPercent(profile, mergedScan, explorationRec ?? undefined, journalHost);
  const detail = buildExomasteryDetail(profile, mergedScan, explorationRec ?? undefined, journalHost);
  return {
    bodyKey: key,
    bodyTabLabel: tab,
    starSystem: star,
    planetClass: mergedScan.PlanetClass ?? null,
    habitatMatchPercent: hq,
    unavailableReason: null,
    detail,
  };
}

export function buildEncyclopediaExomasteryFromProfile(
  entry: SpeciesEntry,
  profile: ExomasteryProfileV1,
  fieldCtx?: {
    focusScan: PlanetScan | null;
    focusRec: ExplorationScanRecord | null;
  },
): EncyclopediaExomasteryPlanetsResponseDTO | null {
  const materialKeysLower = new Set(Object.keys(profile.materials).map((k) => k.toLowerCase()));
  const atmoKeysLower = new Set(Object.keys(profile.atmosphereComposition).map((k) => k.toLowerCase()));
  const solidKeysLower = new Set(Object.keys(profile.solidComposition ?? {}).map((k) => k.toLowerCase()));

  const fields: EncyclopediaExomasteryFieldDTO[] = [];
  let idx = 0;
  const nid = () => `exo-prof-${idx++}`;

  const obsVal = (displayPath: string): number | null => {
    if (!fieldCtx?.focusScan) return null;
    const o = exomasteryObservationForProfilePath(
      displayPath,
      fieldCtx.focusScan,
      fieldCtx.focusRec ?? undefined,
    );
    return o.known ? o.value : null;
  };

  for (const [path, r] of Object.entries(profile.numerics)) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    const tail = exomasteryPathTailLower(path);
    if (materialKeysLower.has(tail) || atmoKeysLower.has(tail) || solidKeysLower.has(tail)) continue;
    fields.push(buildProfileNumericField(path, path, r, nid(), obsVal(path)));
  }

  for (const [el, r] of Object.entries(profile.materials)) {
    const displayPath = el.includes(".") ? el : `body.materials.${el}`;
    if (shouldOmitExomasterySciencePath(displayPath)) continue;
    fields.push(buildProfileNumericField(el, displayPath, r, nid(), obsVal(displayPath)));
  }
  for (const [el, r] of Object.entries(profile.atmosphereComposition)) {
    const displayPath = el.includes(".") ? el : `body.atmosphereComposition.${el}`;
    if (shouldOmitExomasterySciencePath(displayPath)) continue;
    fields.push(buildProfileNumericField(el, displayPath, r, nid(), obsVal(displayPath)));
  }
  for (const [el, r] of Object.entries(profile.solidComposition ?? {})) {
    const displayPath = el.includes(".") ? el : `body.solidComposition.${el}`;
    if (shouldOmitExomasterySciencePath(displayPath)) continue;
    fields.push(buildProfileNumericField(el, displayPath, r, nid(), obsVal(displayPath)));
  }
  for (const [path, counts] of Object.entries(profile.categorical ?? {})) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    fields.push(buildProfileCategoricalField(path, counts, nid()));
  }

  if (fields.length === 0) return null;

  const sections = buildOrderedSections(fields, (f) => profilePathSection(f.columnKey));
  const flatFields = sections.flatMap((s) => s.fields);

  return {
    speciesEntryId: entry.id,
    displayName: entry.displayName,
    genusDataDir: entry.genusDataDir,
    sampleCount: feederProfileBodyCount(profile),
    source: "profile",
    planets: [
      {
        index: 0,
        title: "Feeder profile (mode vs mean)",
        sections,
        fields: flatFields,
      },
    ],
  };
}

export function buildEncyclopediaExomasteryPlanetsPayload(
  projectRoot: string,
  entry: SpeciesEntry,
  store?: GameStateStore | null,
  focusBodyKey?: string | null,
): EncyclopediaExomasteryPlanetsResponseDTO | null {
  const profile = loadExomasteryProfile(projectRoot, entry);
  if (profile) {
    let focusScan: PlanetScan | null = null;
    let focusRec: ExplorationScanRecord | null = null;
    if (store) {
      const fb = (focusBodyKey?.trim() || store.uiSelectedBodyKey || "").trim() || null;
      if (fb) {
        const b = store.bodies.get(fb);
        if (b) {
          const sk = encyclopediaScanBodyKey(b.systemAddress, b.bodyId);
          focusRec = store.explorationScans.get(sk) ?? null;
          focusScan = mergeScanForExomastery(b.scan, focusRec);
        }
      }
    }
    const fromProfile = buildEncyclopediaExomasteryFromProfile(entry, profile, {
      focusScan,
      focusRec,
    });
    if (fromProfile) {
      const fbKey = (focusBodyKey?.trim() || store?.uiSelectedBodyKey || "").trim() || null;
      if (store && fbKey) {
        fromProfile.focusBody = buildEncyclopediaFocusBodyMatch(store, profile, fbKey);
      }
      return fromProfile;
    }
  }

  const rawRows = loadEdsmPlanetStringRows(projectRoot, entry);
  if (rawRows.length < 1) return null;

  const keys = collectColumnKeys(rawRows).filter((k) => !shouldOmitDataColumnKey(k));
  const numericCols = new Set(keys.filter((k) => isNumericColumn(k, rawRows)));

  const colStats = new Map<
    string,
    | { kind: "num"; mean: number; min: number; max: number; sampleN: number }
    | { kind: "cat"; counts?: Map<string, number>; modeNorm?: string }
  >();

  for (const key of keys) {
    if (numericCols.has(key)) {
      const vals: number[] = [];
      for (const r of rawRows) {
        const p = parseNumericCell(key, r[key] ?? "");
        if (p != null && Number.isFinite(p)) vals.push(p);
      }
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const colMin = vals.length ? Math.min(...vals) : 0;
      const colMax = vals.length ? Math.max(...vals) : 0;
      colStats.set(key, { kind: "num", mean, min: colMin, max: colMax, sampleN: vals.length });
    } else {
      const counts = new Map<string, number>();
      for (const r of rawRows) {
        const raw = (r[key] ?? "").trim();
        if (!raw) continue;
        const nk = normalizeCategoricalValue(key, raw);
        counts.set(nk, (counts.get(nk) ?? 0) + 1);
      }
      let mode = "";
      let modeN = -1;
      for (const [k, c] of counts) {
        if (c > modeN) {
          modeN = c;
          mode = k;
        }
      }
      colStats.set(key, { kind: "cat", counts, modeNorm: mode });
    }
  }

  const planets: EncyclopediaExomasteryPlanetDTO[] = rawRows.map((row, index) => {
    const sys =
      row["StarSystem"] || row["Star system"] || row["System"] || row["system"] || row["SystemName"] || "";
    const body = row["BodyName"] || row["Body"] || row["Planet"] || row["bodyName"] || row["Body Name"] || "";
    const title =
      sys.trim() && body.trim()
        ? `${sys.trim()} · ${body.trim()}`
        : sys.trim() || body.trim() || `Row ${index + 1}`;

    let fi = 0;
    const fields: EncyclopediaExomasteryFieldDTO[] = [];
    for (const key of keys) {
      const rawVal = row[key] ?? "";
      const label = key.trim();
      const st = colStats.get(key)!;

      let tier: EncyclopediaExomasteryFieldDTO["tier"];
      let deviation: number;
      let contextNote: string;
      let typicalDisplay: string | undefined;
      let modeDisplay: string | undefined;
      let deviationDisplay: string;
      let distribution: EncyclopediaExomasteryFieldDTO["distribution"];

      if (st.kind === "num") {
        const p = parseNumericCell(key, rawVal);
        const mean = st.mean;
        typicalDisplay = Number.isFinite(mean) ? formatDisplayValue(key, String(mean)) : "—";
        modeDisplay =
          p != null && Number.isFinite(p) ? formatDisplayValue(key, rawVal) : rawVal.trim() || "—";
        if (p != null && Number.isFinite(p) && Number.isFinite(mean)) {
          const den = Math.max(Math.abs(mean), 1e-9);
          deviation = (Math.abs(p - mean) / den) * 100;
          contextNote = `Sample mean ${formatExomasteryNum(mean)} · n=${rawRows.length}`;
        } else {
          deviation = 0;
          contextNote = `Sample mean ${formatExomasteryNum(mean)}`;
        }
        tier = deviationToTier(deviation);
        deviationDisplay = `${Math.round(deviation * 10) / 10}%`;
        distribution =
          st.sampleN > 0
            ? edsmNumericFieldDistribution(
                key,
                st.min,
                st.max,
                mean,
                p != null && Number.isFinite(p) ? p : null,
              )
            : undefined;
      } else {
        distribution = undefined;
        const raw = rawVal.trim();
        if (!raw) {
          deviation = 0;
          tier = "blue";
          contextNote = "Empty in source";
          typicalDisplay = st.modeNorm ?? "—";
          modeDisplay = "—";
          deviationDisplay = "0%";
        } else {
          const nk = normalizeCategoricalValue(key, raw);
          typicalDisplay = `mode: ${st.modeNorm ?? "—"}`;
          modeDisplay = formatDisplayValue(key, rawVal);
          if (nk === (st.modeNorm ?? "")) {
            deviation = 0;
            tier = "blue";
            const fm = (st.counts?.get(nk) ?? 0) / rawRows.length;
            contextNote = `Mode (matches ${(fm * 100).toFixed(1)}% of bodies)`;
          } else {
            const f = (st.counts?.get(nk) ?? 0) / rawRows.length;
            deviation = 100 * (1 - f);
            contextNote = `This value: ${(f * 100).toFixed(1)}% of bodies · not mode`;
            tier = deviationToTier(deviation);
          }
          deviationDisplay = `${Math.round(deviation * 10) / 10}%`;
        }
      }

      fields.push({
        id: `exo-edsm-${index}-${fi++}`,
        columnKey: key,
        label,
        valueDisplay: formatDisplayValue(key, rawVal),
        typicalDisplay,
        modeDisplay,
        deviationDisplay,
        tier,
        deviationPercent: Math.round(deviation * 100) / 100,
        contextNote,
        distribution,
      });
    }
    const sections = buildOrderedSections(fields, (f) => edsmColumnSection(f.columnKey));
    const flatFields = sections.flatMap((s) => s.fields);
    return { index, title, sections, fields: flatFields };
  });

  return {
    speciesEntryId: entry.id,
    displayName: entry.displayName,
    genusDataDir: entry.genusDataDir,
    sampleCount: rawRows.length,
    source: "edsm",
    planets,
    focusBody: null,
  };
}
