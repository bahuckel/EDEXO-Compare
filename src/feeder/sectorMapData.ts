/**
 * Turning the stores into sector-map evidence — INCLUDE-BODY-IDS Phase 10, step 2.
 *
 * The aggregation itself is pure and lives in `shared/sectorAggregate.ts`. This is the adapter: it
 * knows which store column means which kind of evidence, and nothing else.
 *
 * ## What each source can and cannot say
 *
 * | source | strongest kind | why not stronger |
 * |---|---|---|
 * | corpus sightings | `confirmed` | it *is* a species identification, from Spansh's exobiology export |
 * | EDDN, genus list present | `genus` | `SAASignalsFound` names the genus, never the species |
 * | EDDN, signal count only | `signal` | the FSS counts, it does not identify |
 * | the matcher | `predicted` | **not built here** — see below |
 *
 * `predicted` is deliberately absent. It would mean running the matcher across bodies the app has
 * never seen, which needs the Spansh export loaded at scale; today the importer is update-only and
 * has matched 182 bodies. Emitting a `predicted` count from the 10,371 corpus bodies would be
 * near-meaningless — those are the bodies we already have *confirmed* answers for. It arrives with
 * the export, and until then the map draws three kinds honestly rather than four kinds badly.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  aggregateBySector,
  markerKind,
  type BodyEvidence,
  type SectorAggregateEntry,
} from "../shared/sectorAggregate.js";
import { sectorCellFromCoords, sectorCellKey, type SectorCell } from "../shared/sectorName.js";
import type {
  SectorMapFile,
  SectorSystem,
  SectorSystemBody,
  SectorSystemsFile,
} from "../shared/sectorMapFile.js";
import type { FeederStore } from "./feederDb.js";

/**
 * Genus keys arrive from EDDN in the game's internal form. Stripping the wrapper gives a token that
 * reads, and that lines up with the corpus's genus column — `$Codex_Ent_Bacterial_Genus_Name;`
 * becomes `bacterial`.
 *
 * It is **not** a species name and must not be presented as one. §23.4 is the standing warning about
 * what a naming mismatch costs, which is why this returns a normalised key rather than a label.
 */
export function genusKeyFromCodex(codexGenus: string): string {
  const m = /^\$Codex_Ent_(.+?)(?:_Genus)?_Name;$/i.exec(codexGenus.trim());
  return (m?.[1] ?? codexGenus.trim()).toLowerCase();
}

/** The corpus's species label, as a taxon key. */
export function taxonFromSpeciesLabel(label: string): string {
  return label.trim().toLowerCase();
}

export interface SectorMapBuild {
  entries: SectorAggregateEntry[];
  sources: { confirmed: number; genus: number; signal: number };
}

/** Read both stores and aggregate. Everything is in memory already; this is a fold, not a query plan. */
export function buildSectorMapData(store: FeederStore): SectorMapBuild {
  const evidence: BodyEvidence[] = [];
  let confirmed = 0;
  let genus = 0;
  let signal = 0;

  for (const s of store.sightingPositions()) {
    evidence.push({
      x: s.x,
      y: s.y,
      z: s.z,
      bodyKey: s.bodyKey,
      taxon: taxonFromSpeciesLabel(s.speciesLabel),
      kind: "confirmed",
    });
    confirmed += 1;
  }

  for (const b of store.eddnBodyPositions()) {
    if (b.genuses.length > 0) {
      for (const g of b.genuses) {
        evidence.push({ x: b.x, y: b.y, z: b.z, bodyKey: b.bodyKey, taxon: genusKeyFromCodex(g), kind: "genus" });
        genus += 1;
      }
      continue;
    }
    // A signal with no genus says "something is here" and nothing about what. It is recorded against
    // a wildcard taxon so the map can show "biology, unidentified" without pretending to a species.
    if ((b.bioSignalCount ?? 0) > 0) {
      evidence.push({ x: b.x, y: b.y, z: b.z, bodyKey: b.bodyKey, taxon: "*", kind: "signal" });
      signal += 1;
    }
  }

  return { entries: aggregateBySector(evidence), sources: { confirmed, genus, signal } };
}

/** Where the shipped aggregate lives — the app reads this, never the feeder store. */
export function sectorMapPath(projectRoot: string): string {
  return join(projectRoot, "data", "exomastery", "sector-map.json");
}

/**
 * Sector names for the cells we actually draw.
 *
 * The full catalogue is 11,649 cells, and shipping all of it would be redistributing somebody
 * else's compiled dataset for rows the app will never show. Only the cells that carry evidence get
 * a name — 104 today — which keeps the file small, keeps the provenance narrow, and grows exactly as
 * the data does.
 *
 * The names themselves are the game's own procedural sector names; the catalogue is the mapping from
 * grid cell to name, and it is credited in the file it produces.
 */
export function readSectorNames(
  catalogueCsvPath: string,
  wanted: ReadonlySet<string>,
): { names: Record<string, string>; catalogueCells: number } {
  const names: Record<string, string> = {};
  let catalogueCells = 0;
  let text: string;
  try {
    text = readFileSync(catalogueCsvPath, "utf8");
  } catch {
    return { names, catalogueCells };
  }
  for (const line of text.split("\n").slice(1)) {
    const c = line.split(",");
    if (c.length < 17) continue;
    const name = (c[0] ?? "").trim().replace(/^"|"$/g, "");
    const [ix, iy, iz] = [c[14], c[15], c[16]].map((v) => (v ?? "").trim());
    if (!name || !ix || !iy || !iz) continue;
    catalogueCells += 1;
    const key = `${ix}:${iy}:${iz}`;
    if (wanted.has(key)) names[key] = name;
  }
  return { names, catalogueCells };
}

/**
 * Write the aggregate the app draws.
 *
 * Markers are grouped by cell so the client can draw a sector without walking every taxon, and the
 * per-taxon detail rides along for the tooltip and the species filter.
 */
export function writeSectorMapFile(
  projectRoot: string,
  build: SectorMapBuild,
  catalogueCsvPath: string,
): { path: string; bytes: number; file: SectorMapFile } {
  const cells = new Map<string, { cell: SectorCell; taxa: Record<string, number[]> }>();
  for (const e of build.entries) {
    let row = cells.get(e.cellKey);
    if (!row) {
      row = { cell: e.cell, taxa: {} };
      cells.set(e.cellKey, row);
    }
    // [confirmed, genus, signal, predicted] — an array rather than an object, because this repeats
    // thousands of times and the key names would be most of the file.
    row.taxa[e.taxon] = [e.counts.confirmed, e.counts.genus, e.counts.signal, e.counts.predicted];
  }

  const { names, catalogueCells } = readSectorNames(catalogueCsvPath, new Set(cells.keys()));

  const file: SectorMapFile = {
    generatedAt: new Date().toISOString(),
    /**
     * Said in the file itself, because a map read without it is a map of the galaxy rather than a
     * map of where commanders have flown (§10.6 rule 3).
     */
    note:
      "Counts describe what is KNOWN, not what exists. Density follows commander traffic — sectors " +
      "around Sol are saturated because that is where people fly. 'predicted' is absent until the " +
      "Spansh export is loaded at scale.",
    sectorNameSource: "edastro sector-list.csv, mapped by 1280 ly grid cell; names are the game's own",
    cells: [...cells.entries()].map(([key, row]) => ({
      key,
      x: row.cell.x,
      y: row.cell.y,
      z: row.cell.z,
      name: names[key] ?? null,
      taxa: row.taxa,
    })),
  };

  const path = sectorMapPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const json = JSON.stringify(file);
  writeFileSync(path, json + "\n", "utf8");
  return { path, bytes: json.length + 1, file };
}

/** Cells with no catalogue name, so the report can say so rather than the map showing blanks. */
export function unnamedCells(file: SectorMapFile): string[] {
  return file.cells.filter((c) => !c.name).map((c) => c.key);
}

/** The strongest evidence in a cell across every taxon — the colour of the sector marker itself. */
export function cellMarkerKind(taxa: Record<string, number[]>): string | null {
  let confirmed = 0;
  let genus = 0;
  let signal = 0;
  let predicted = 0;
  for (const v of Object.values(taxa)) {
    confirmed += v[0] ?? 0;
    genus += v[1] ?? 0;
    signal += v[2] ?? 0;
    predicted += v[3] ?? 0;
  }
  return markerKind({ confirmed, genus, signal, predicted, bodies: confirmed + genus + signal + predicted });
}

export function sectorSystemsPath(projectRoot: string): string {
  return join(projectRoot, "data", "exomastery", "sector-systems.json");
}

/**
 * Build the per-sector system rows for the drill-down.
 *
 * Same evidence rules as the galaxy view — one body counted once at its strongest kind — but folded
 * to `(system, taxon)` instead of `(cell, taxon)`. The two files therefore agree by construction:
 * summing a sector's systems gives the sector's counts.
 */
export function buildSectorSystems(store: FeederStore): SectorSystemsFile {
  /** `systemKey` → the system, and per taxon the set of bodies at each evidence kind. */
  type Acc = {
    name: string;
    x: number;
    y: number;
    z: number;
    taxa: Map<string, { confirmed: Set<string>; genus: Set<string>; signal: Set<string> }>;
    /** bodyKey → what is known about that body, for the step-5 list. */
    bodies: Map<string, { name: string; species: Set<string>; genuses: Set<string>; signal: number }>;
  };
  const systems = new Map<string, Acc>();

  const bucket = (acc: Acc, taxon: string) => {
    let b = acc.taxa.get(taxon);
    if (!b) {
      b = { confirmed: new Set(), genus: new Set(), signal: new Set() };
      acc.taxa.set(taxon, b);
    }
    return b;
  };

  for (const r of store.sightingSystems()) {
    let acc = systems.get(r.systemKey);
    if (!acc) {
      acc = { name: r.systemName, x: r.x, y: r.y, z: r.z, taxa: new Map(), bodies: new Map() };
      systems.set(r.systemKey, acc);
    }
    const taxon = taxonFromSpeciesLabel(r.speciesLabel);
    bucket(acc, taxon).confirmed.add(r.bodyKey);
    let body = acc.bodies.get(r.bodyKey);
    if (!body) {
      body = { name: r.bodyName, species: new Set(), genuses: new Set(), signal: 0 };
      acc.bodies.set(r.bodyKey, body);
    }
    body.species.add(taxon);
  }

  for (const b of store.eddnBodyPositions()) {
    const systemKey = b.bodyKey.split(":")[0] ?? b.bodyKey;
    let acc = systems.get(systemKey);
    if (!acc) {
      // EDDN carries the system name on the body row; the register is the only source for systems
      // the corpus has never seen.
      acc = { name: systemKey, x: b.x, y: b.y, z: b.z, taxa: new Map(), bodies: new Map() };
      systems.set(systemKey, acc);
    }
    let body = acc.bodies.get(b.bodyKey);
    if (!body) {
      // EDDN gives a body name; the register keeps it, and it is the only name a system the corpus
      // has never seen will ever have.
      body = { name: b.bodyName ?? b.bodyKey, species: new Set(), genuses: new Set(), signal: 0 };
      acc.bodies.set(b.bodyKey, body);
    }
    if (b.genuses.length > 0) {
      for (const g of b.genuses) {
        const key = genusKeyFromCodex(g);
        bucket(acc, key).genus.add(b.bodyKey);
        body.genuses.add(key);
      }
    } else if ((b.bioSignalCount ?? 0) > 0) {
      bucket(acc, "*").signal.add(b.bodyKey);
      body.signal = b.bioSignalCount ?? 0;
    }
  }

  const cells: Record<string, SectorSystem[]> = {};
  for (const [key, acc] of systems) {
    const taxa: Record<string, number[]> = {};
    for (const [taxon, sets] of acc.taxa) {
      // A body already counted as confirmed must not also count as a genus hit or a signal — the
      // same collapse the galaxy view does, applied here so the two files cannot disagree.
      const confirmed = sets.confirmed.size;
      const genus = [...sets.genus].filter((b) => !sets.confirmed.has(b)).length;
      const signal = [...sets.signal].filter((b) => !sets.confirmed.has(b) && !sets.genus.has(b)).length;
      if (confirmed + genus + signal === 0) continue;
      taxa[taxon] = [confirmed, genus, signal, 0];
    }
    if (Object.keys(taxa).length === 0) continue;

    const bodies: SectorSystemBody[] = [...acc.bodies.values()]
      .map((b) => ({
        name: b.name,
        species: [...b.species].sort(),
        // A genus already settled to a species on this body adds nothing — drop it rather than show
        // "Bacterium" beside "Bacterium aurasus".
        genuses: [...b.genuses].filter((g) => ![...b.species].some((sp) => sp.startsWith(g))).sort(),
        signal: b.signal,
      }))
      .filter((b) => b.species.length > 0 || b.genuses.length > 0 || b.signal > 0)
      .sort((a, b) => b.species.length - a.species.length || a.name.localeCompare(b.name));

    const cellKey = sectorCellKey(sectorCellFromCoords(acc.x, acc.y, acc.z));
    (cells[cellKey] ??= []).push({ key, name: acc.name, x: acc.x, y: acc.y, z: acc.z, taxa, bodies });
  }

  // Densest first, so a truncated view still shows the systems worth flying to.
  for (const list of Object.values(cells)) {
    list.sort((a, b) => Object.keys(b.taxa).length - Object.keys(a.taxa).length || a.name.localeCompare(b.name));
  }

  return { generatedAt: new Date().toISOString(), cells };
}

export function writeSectorSystemsFile(
  projectRoot: string,
  file: SectorSystemsFile,
): { path: string; bytes: number; systems: number } {
  const path = sectorSystemsPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const json = JSON.stringify(file);
  writeFileSync(path, json + "\n", "utf8");
  return {
    path,
    bytes: json.length + 1,
    systems: Object.values(file.cells).reduce((n, l) => n + l.length, 0),
  };
}
