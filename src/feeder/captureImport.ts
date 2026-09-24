/**
 * Species sightings from an EDDN bio-collector export, into the feeder corpus.
 *
 * The corpus grows from Spansh route exports and nothing else, while the collector keeps what EDDN
 * says was actually scanned: `ScanOrganic` Log/Sample and organic codex entries, each on a body the
 * same export describes in full. The 2026-09-24 export held 2,268 such species rows on 1,010 bodies,
 * none of which could reach a profile.
 *
 *   npm run feeder -- import-capture <eddn-bio-*.jsonl>            what it would add (dry run)
 *   npm run feeder -- import-capture <eddn-bio-*.jsonl> --apply    add it, then `feeder -- rebuild`
 *
 * ## What counts as a sighting
 *
 * `ScanOrganic` **Log** and **Sample** (Analyse is not authoritative — it can fire at another body
 * once the commander has flown off), and codex entries in the Biology category. Names come from the
 * export's `name` field, which the collector derives from the codex token with the game's own table
 * since its name repair (collector schema `CODEX_NAMES_VERSION` 2).
 *
 * ## How a body enters a profile
 *
 * The profile builder reads per-species sample packs: one record per body, holding an EDSM-shaped
 * system snapshot and the body. The export's bodies already use EDSM/Spansh field names, so each
 * system is written once to `raw/systems/eddn__<slug>.json` — its own prefix, never over an EDSM
 * cache — and each new (species, body) pair gets a `body_<hash>.json` pack, exactly as the hydrator
 * would have written it. A body the species' pack already holds is left alone: this import adds, it
 * never replaces.
 *
 * Only EDSM's own body fields are kept (see `EDSM_BODY_FIELDS`), and two are re-spelled so both
 * sources land on the same profile keys: materials (`iron` → `Iron`) and atmosphere gases
 * (`CarbonDioxide` → `Carbon dioxide`). Solid composition, gravity (g), pressure (atm), radius (km)
 * and orbits already match EDSM's units.
 *
 * Sightings go into the store with claim origin `eddn`, which `upsertSightingRow` will never let
 * overwrite a first-hand (`journal`) or an earlier named origin.
 */
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { genusFromLandmark } from "./csvImport.js";
import { extractPlanetContext } from "./edsm.js";
import { speciesFileSlug } from "./flatten.js";
import { rawPlanetsDir, rawSystemsDir } from "./paths.js";
import { bodySampleName, readSamplesByIdentity, bodyIdentityKey } from "./samplePacks.js";
import type { FeederContext } from "./pipeline.js";

type Json = Record<string, unknown>;

export interface CaptureSighting {
  systemName: string;
  bodyName: string;
  /** The label as the collector names it, before it is matched to the corpus. */
  captureName: string;
}

export interface ParsedCapture {
  systems: Map<string, { name: string; coords: { x: number; y: number; z: number } | null; bodies: Json[] }>;
  sightings: CaptureSighting[];
  bodies: number;
}

const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Read an export: its systems with every body, and the species confirmed on each planet. */
export function parseCaptureExport(text: string): ParsedCapture {
  const systems: ParsedCapture["systems"] = new Map();
  const sightings: CaptureSighting[] = [];
  const bodyRows: Json[] = [];
  let bodies = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as Json;
    if (o.kind === "system" && typeof o.id64 === "string" && typeof o.name === "string") {
      const c = isObj(o.coords) ? (o.coords as { x: number; y: number; z: number }) : null;
      systems.set(o.id64, { name: o.name, coords: c, bodies: [] });
    } else if (o.kind === "body") {
      bodies++;
      bodyRows.push(o);
    }
  }
  for (const b of bodyRows) {
    const sys = systems.get(String(b.systemId64));
    if (!sys) continue;
    sys.bodies.push(b);
    if (b.type !== "Planet" || typeof b.name !== "string") continue;
    const names = new Set<string>();
    const organics = isObj(b.signals) && Array.isArray((b.signals as Json).organics) ? ((b.signals as Json).organics as Json[]) : [];
    for (const x of organics) {
      if ((x.scanType === "Log" || x.scanType === "Sample") && typeof x.name === "string" && x.name.trim()) names.add(x.name.trim());
    }
    for (const c of Array.isArray(b.codex) ? (b.codex as Json[]) : []) {
      if (typeof c.category === "string" && /Biology/.test(c.category) && typeof c.name === "string" && c.name.trim()) {
        names.add(c.name.trim());
      }
    }
    for (const n of names) sightings.push({ systemName: sys.name, bodyName: b.name, captureName: n });
  }
  return { systems, sightings, bodies };
}

/** `CarbonDioxide` → `Carbon dioxide`, as EDSM writes a gas. */
export function edsmGasName(journalName: string): string {
  const words = journalName.replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(" ");
}

/**
 * The fields an EDSM body carries — measured over 601 cached EDSM systems, 13,559 bodies.
 *
 * Only these pass. The profile builder flattens every numeric field it finds into a parameter, and
 * the capture carries more than EDSM does — scan positions (`signals.organics[n].lat`), codex entry
 * ids, mining signals, `meanAnomaly`, `ascendingNode`. The first import let them through and they
 * became 56 histogram parameters that mean nothing about where a plant grows.
 */
const EDSM_BODY_FIELDS = new Set([
  "id", "id64", "bodyId", "name", "discovery", "type", "subType", "parents", "distanceToArrival",
  "isLandable", "gravity", "earthMasses", "radius", "surfaceTemperature", "surfacePressure",
  "volcanismType", "atmosphereType", "atmosphereComposition", "solidComposition", "terraformingState",
  "orbitalPeriod", "semiMajorAxis", "orbitalEccentricity", "orbitalInclination", "argOfPeriapsis",
  "rotationalPeriod", "rotationalPeriodTidallyLocked", "axialTilt", "materials", "rings", "belts",
  "reserveLevel", "updateTime", "isMainStar", "age", "absoluteMagnitude", "solarMasses", "solarRadius",
  "luminosity", "spectralClass", "isScoopable",
]);

/** A capture body as EDSM would have sent it: EDSM's fields only, in EDSM's spelling. */
export function toEdsmBody(b: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(b)) {
    if (EDSM_BODY_FIELDS.has(k) && v !== null && v !== undefined) out[k] = v;
  }
  // The collector's name for EDSM's `isMainStar`.
  if (typeof b.mainStar === "boolean") out.isMainStar = b.mainStar;
  if (isObj(b.materials)) {
    out.materials = Object.fromEntries(
      Object.entries(b.materials).map(([k, v]) => [k ? k[0]!.toUpperCase() + k.slice(1).toLowerCase() : k, v]),
    );
  }
  if (isObj(b.atmosphereComposition)) {
    out.atmosphereComposition = Object.fromEntries(
      Object.entries(b.atmosphereComposition).map(([k, v]) => [edsmGasName(k), v]),
    );
  }
  return out;
}

/**
 * Match a capture name to the corpus label for the same species.
 *
 * Spansh and the collector order words differently for some species ("Albidum Sinuous Tubers" /
 * "Sinuous Tubers Albidum"), so the key is the set of words, not the string.
 */
export function labelResolver(labels: Iterable<string>): (name: string) => string | null {
  const key = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
  const byKey = new Map<string, string>();
  for (const l of labels) byKey.set(key(l), l);
  return (name) => byKey.get(key(name)) ?? null;
}

export interface CaptureImportReport {
  bodies: number;
  sightings: number;
  unmatchedNames: Map<string, number>;
  /** Species label → sightings the corpus did not have yet. */
  newBySpecies: Map<string, number>;
  alreadyKnown: number;
  packsWritten: number;
  systemFilesWritten: number;
  backup: string | null;
}

/** Add an export's sightings to the corpus. Dry run unless `apply`. */
export async function importCapture(
  ctx: FeederContext,
  file: string,
  opts: { apply: boolean; storePath?: string },
): Promise<CaptureImportReport> {
  const parsed = parseCaptureExport(readFileSync(file, "utf8"));
  const resolve = labelResolver(Object.keys(ctx.speciesIndex));
  const report: CaptureImportReport = {
    bodies: parsed.bodies,
    sightings: parsed.sightings.length,
    unmatchedNames: new Map(),
    newBySpecies: new Map(),
    alreadyKnown: 0,
    packsWritten: 0,
    systemFilesWritten: 0,
    backup: null,
  };

  // Which (species, body) pairs each species' packs already hold — read once per species.
  const known = new Map<string, Set<string>>();
  const packsOf = async (label: string): Promise<Set<string>> => {
    let s = known.get(label);
    if (!s) {
      s = new Set((await readSamplesByIdentity(join(rawPlanetsDir(), speciesFileSlug(label)))).keys());
      known.set(label, s);
    }
    return s;
  };

  const toAdd: { label: string; s: CaptureSighting }[] = [];
  for (const s of parsed.sightings) {
    const label = resolve(s.captureName);
    if (!label) {
      report.unmatchedNames.set(s.captureName, (report.unmatchedNames.get(s.captureName) ?? 0) + 1);
      continue;
    }
    const id = bodyIdentityKey(s.systemName, s.bodyName);
    const have = await packsOf(label);
    if (have.has(id)) {
      report.alreadyKnown++;
      continue;
    }
    have.add(id); // a body listed twice in one export is one sighting
    toAdd.push({ label, s });
    report.newBySpecies.set(label, (report.newBySpecies.get(label) ?? 0) + 1);
  }
  if (!opts.apply || toAdd.length === 0) return report;

  if (opts.storePath && existsSync(opts.storePath)) {
    report.backup = `${opts.storePath}.bak-precapture`;
    await copyFile(opts.storePath, report.backup);
  }

  // One EDSM-shaped system file per system that gains a sighting.
  const systemFile = new Map<string, { file: string; json: Json }>();
  await mkdir(rawSystemsDir(), { recursive: true });
  for (const { s } of toAdd) {
    if (systemFile.has(s.systemName)) continue;
    const sys = [...parsed.systems.values()].find((x) => x.name === s.systemName)!;
    const json: Json = { name: sys.name, coords: sys.coords, source: "eddn-bio-collector", bodies: sys.bodies.map(toEdsmBody) };
    const fileName = `eddn__${speciesFileSlug(sys.name)}.json`;
    await writeFile(join(rawSystemsDir(), fileName), JSON.stringify(json), "utf8");
    systemFile.set(s.systemName, { file: fileName, json });
    report.systemFilesWritten++;
  }

  for (const { label, s } of toAdd) {
    const dir = join(rawPlanetsDir(), speciesFileSlug(label));
    await mkdir(dir, { recursive: true });
    const sf = systemFile.get(s.systemName)!;
    const context = extractPlanetContext(sf.json, s.bodyName);
    await writeFile(
      join(dir, bodySampleName(s.systemName, s.bodyName)),
      JSON.stringify({ systemName: s.systemName, bodyName: s.bodyName, speciesLabel: label, systemCacheFile: sf.file, context }, null, 2),
      "utf8",
    );
    report.packsWritten++;
  }

  const bodyByKey = new Map<string, Json>();
  for (const sys of parsed.systems.values()) for (const b of sys.bodies) bodyByKey.set(bodyIdentityKey(sys.name, String(b.name)), b);
  ctx.store.applyEddnSightings(
    toAdd.map(({ label, s }) => {
      const b = bodyByKey.get(bodyIdentityKey(s.systemName, s.bodyName));
      return {
        systemName: s.systemName,
        bodyName: s.bodyName,
        bodySubtype: typeof b?.subType === "string" ? b.subType : "",
        distanceLs: typeof b?.distanceToArrival === "number" ? b.distanceToArrival : null,
        speciesLabel: label,
        genus: genusFromLandmark(label),
      };
    }),
  );
  ctx.store.setSystemCoords(
    [...new Set(toAdd.map(({ s }) => s.systemName))]
      .map((n) => [...parsed.systems.values()].find((x) => x.name === n)!)
      .filter((x) => x.coords)
      .map((x) => ({ name: x.name, ...x.coords! })),
  );
  ctx.store.setBodyIdentityByName(
    toAdd
      .map(({ s }) => bodyByKey.get(bodyIdentityKey(s.systemName, s.bodyName)))
      .filter((b): b is Json => !!b && typeof b.bodyId === "number")
      .map((b) => ({
        systemName: [...parsed.systems.values()].find((x) => x.bodies.includes(b))!.name,
        bodyName: String(b.name),
        bodyId: b.bodyId as number,
        bodyId64: typeof b.id64 === "string" ? b.id64 : null,
      })),
  );
  return report;
}

export function formatCaptureReport(r: CaptureImportReport, apply: boolean): string {
  const lines = [
    `bodies in export        ${r.bodies.toLocaleString()}`,
    `species sightings       ${r.sightings.toLocaleString()} (Log/Sample and organic codex entries)`,
    `already in the corpus   ${r.alreadyKnown.toLocaleString()}`,
    `new to the corpus       ${[...r.newBySpecies.values()].reduce((a, b) => a + b, 0).toLocaleString()} across ${r.newBySpecies.size} species`,
  ];
  if (r.unmatchedNames.size) {
    lines.push(`not in the corpus index ${[...r.unmatchedNames].map(([n, c]) => `${n} ×${c}`).join(", ")}`);
  }
  if (apply) {
    lines.push(`packs written           ${r.packsWritten.toLocaleString()} · system files ${r.systemFilesWritten.toLocaleString()}`);
    if (r.backup) lines.push(`store backed up to      ${r.backup}`);
  }
  lines.push("", "by species:");
  for (const [l, n] of [...r.newBySpecies].sort((a, b) => b[1] - a[1])) lines.push(`  ${String(n).padStart(4)}  ${l}`);
  return lines.join("\n");
}
