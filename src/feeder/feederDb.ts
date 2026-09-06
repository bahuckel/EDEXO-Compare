import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { genusFromLandmark, occurrenceKey, type SpeciesIndexEntry, type SpanshExoRow } from "./csvImport.js";
import { PROJECT_ROOT } from "./paths.js";

const SCHEMA_VER = 3;
const META_CUMULATIVE = "cumulative_csv_rows";
const META_SCHEMA = "schema_ver";

function wasmPath(file: string): string {
  return join(PROJECT_ROOT, "node_modules", "sql.js", "dist", file);
}

function runExec(db: Database, sql: string, params: SqlValue[] = []): void {
  const st = db.prepare(sql);
  st.bind(params);
  st.step();
  st.free();
}

function queryOne<T extends SqlValue[]>(db: Database, sql: string, params: SqlValue[]): T | undefined {
  const st = db.prepare(sql);
  st.bind(params);
  if (!st.step()) {
    st.free();
    return undefined;
  }
  const row = st.get() as T;
  st.free();
  return row;
}

function queryAll<T extends SqlValue[]>(db: Database, sql: string, params: SqlValue[]): T[] {
  const st = db.prepare(sql);
  st.bind(params);
  const out: T[] = [];
  while (st.step()) out.push(st.get() as T);
  st.free();
  return out;
}

function normSystem(s: string): string {
  return s.trim().toLowerCase();
}

function normBody(s: string): string {
  return s.trim().toLowerCase();
}

function normSpeciesLabel(s: string): string {
  return s.trim().toLowerCase();
}

function migrateSchema(db: Database): void {
  db.run("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      k TEXT PRIMARY KEY NOT NULL,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS species_line_counts (
      species_norm TEXT PRIMARY KEY NOT NULL,
      species_label TEXT NOT NULL,
      line_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS systems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      norm_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS planets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
      norm_body TEXT NOT NULL,
      display_body TEXT NOT NULL,
      body_subtype TEXT NOT NULL DEFAULT '',
      distance_ls REAL,
      UNIQUE(system_id, norm_body)
    );
    CREATE TABLE IF NOT EXISTS sightings (
      planet_id INTEGER NOT NULL REFERENCES planets(id) ON DELETE CASCADE,
      species_norm TEXT NOT NULL,
      genus TEXT NOT NULL,
      species_label TEXT NOT NULL,
      PRIMARY KEY (planet_id, species_norm)
    );
    CREATE INDEX IF NOT EXISTS idx_sightings_species_norm ON sightings(species_norm);
    CREATE INDEX IF NOT EXISTS idx_planets_system ON planets(system_id);
  `);
  db.run(`DROP TABLE IF EXISTS aedc_edsm_jobs;`);

  /**
   * Galactic coordinates, added in schema 2 for the region work.
   *
   * The bodies endpoint the corpus was built from does not return them — all 31,990 sample packs
   * carry `coords: null` — so they arrive later, from the batch systems endpoint, and a system
   * without them is normal rather than an error.
   */
  const systemCols = new Set(
    queryAll<SqlValue[]>(db, "PRAGMA table_info(systems)", []).map((r) => String(r[1])),
  );
  if (!systemCols.has("x")) db.run("ALTER TABLE systems ADD COLUMN x REAL");
  if (!systemCols.has("y")) db.run("ALTER TABLE systems ADD COLUMN y REAL");
  if (!systemCols.has("z")) db.run("ALTER TABLE systems ADD COLUMN z REAL");

  /**
   * Spansh's `Count` column, preserved verbatim and **not interpreted** (§54).
   *
   * The import has always parsed it and thrown it away. It is kept now for one reason: of the three
   * columns §9.4 queued, it is the only one that cannot be recovered from anywhere else once
   * discarded. `Value` duplicates `data/price-list.json`, which is the app's authority and stays
   * that way; `Jumps` is measured from whatever system the search was run in, so it describes the
   * query rather than the body. Both were left out deliberately.
   *
   * Nothing reads this column. Its meaning is unverified — §9.4 required checking it against a
   * fresh export and there is none on disk — so it is stored as the number Spansh wrote and nothing
   * is derived from it until somebody confirms what it counts.
   */
  const planetCols = new Set(
    queryAll<SqlValue[]>(db, "PRAGMA table_info(planets)", []).map((r) => String(r[1])),
  );
  if (!planetCols.has("spansh_count")) db.run("ALTER TABLE planets ADD COLUMN spansh_count INTEGER");

  /**
   * Stable body identity, schema 3 (INCLUDE-BODY-IDS §2.3).
   *
   * The corpus has always de-duplicated bodies by normalised **name** — `UNIQUE(system_id,
   * norm_body)` — which works until two sources spell the same body differently. §23.4 was already
   * bitten by that class of bug once, at a cost of 16 species rows. These columns carry the game's
   * own identity instead, so the join stops depending on rendering.
   *
   * The key is `(system_id, body_id)`: `body_id` is the in-system BodyID, which is exactly what the
   * journal reports and what `gameState.ts` already keys on as `${SystemAddress}:${bodyId}`. That
   * makes a corpus body and a journal body joinable with no string comparison anywhere in the path.
   *
   * `id64` columns are **TEXT, not INTEGER**. SQLite's INTEGER is 64-bit and would hold the value,
   * but `sql.js` hands it back to JavaScript as a `number`, which puts the float64 rounding straight
   * back — see `bigIntJson.ts`. TEXT is the only column type that survives this stack.
   *
   * Footfall and mapping are declared here but stay NULL until Phase 3 fills them from EDDN. All
   * three states are meaningful: NULL is "never observed", which is **not** the same as 0, and the
   * difference is what the high-value-target ladder is made of. A `false` is only true as of the
   * moment beside it, which is why each carries its own `_seen_at`.
   *
   * The identity UNIQUE INDEX from §2.3 is created **only when the data already satisfies it** —
   * see below. Creating it unconditionally would turn a corpus that needs the duplicate report into
   * one that cannot be opened to read the report.
   */
  if (!planetCols.has("body_id")) db.run("ALTER TABLE planets ADD COLUMN body_id INTEGER");
  if (!planetCols.has("body_id64")) db.run("ALTER TABLE planets ADD COLUMN body_id64 TEXT");
  if (!planetCols.has("edsm_id")) db.run("ALTER TABLE planets ADD COLUMN edsm_id INTEGER");
  if (!planetCols.has("is_footfalled")) db.run("ALTER TABLE planets ADD COLUMN is_footfalled INTEGER");
  if (!planetCols.has("footfall_source")) db.run("ALTER TABLE planets ADD COLUMN footfall_source TEXT");
  if (!planetCols.has("footfall_seen_at")) db.run("ALTER TABLE planets ADD COLUMN footfall_seen_at TEXT");
  if (!planetCols.has("is_mapped")) db.run("ALTER TABLE planets ADD COLUMN is_mapped INTEGER");
  if (!planetCols.has("mapped_source")) db.run("ALTER TABLE planets ADD COLUMN mapped_source TEXT");
  if (!planetCols.has("mapped_seen_at")) db.run("ALTER TABLE planets ADD COLUMN mapped_seen_at TEXT");
  if (!systemCols.has("id64")) db.run("ALTER TABLE systems ADD COLUMN id64 TEXT");
  if (!systemCols.has("edsm_id")) db.run("ALTER TABLE systems ADD COLUMN edsm_id INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_planets_body_id ON planets(system_id, body_id)");

  /**
   * The constraint that replaces name matching: one row per physical body.
   *
   * Partial, so the 476 rows the archives could not name — 319 never hydrated, 157 whose body EDSM
   * has no record of — do not all collide on NULL. Once it exists, a body arriving under a second
   * spelling is rejected by the store instead of quietly becoming a second row.
   *
   * Created only when the corpus already satisfies it. A `CREATE UNIQUE INDEX` over duplicate rows
   * throws, and throwing inside `migrateSchema` would make the store unopenable — including by the
   * `identity` command whose whole job is to list those duplicates so they can be resolved. So the
   * check runs first and the index simply waits. `UNIQUE(system_id, norm_body)` stays either way:
   * belt and braces, a body with no ID still cannot duplicate by name.
   */
  const identityDupes = queryOne<[number]>(
    db,
    `SELECT COUNT(*) FROM (SELECT 1 FROM planets WHERE body_id IS NOT NULL
       GROUP BY system_id, body_id HAVING COUNT(*) > 1)`,
    [],
  );
  if (Number(identityDupes?.[0] ?? 0) === 0) {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_planets_identity ON planets(system_id, body_id) WHERE body_id IS NOT NULL",
    );
  }
  runExec(db, "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [
    META_SCHEMA,
    String(SCHEMA_VER),
  ]);

  const row = queryOne<[string]>(db, "SELECT v FROM meta WHERE k = ?", [META_SCHEMA]);
  if (!row) {
    runExec(db, "INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)", [META_SCHEMA, String(SCHEMA_VER)]);
  }
}

export type FeederStoreStats = {
  uniqueSystems: number;
  uniquePlanets: number;
  /** Unique (planet, species) pairs — deduped sightings */
  uniqueSightings: number;
  speciesLabels: number;
  cumulativeCsvRowsImported: number;
  /** Systems whose galactic coordinates are known — the region work needs them and they arrive late. */
  systemsWithCoords: number;
};

export class FeederStore {
  constructor(
    private readonly dbPath: string,
    readonly db: Database,
  ) {
    migrateSchema(this.db);
  }

  /** Persist in-memory DB to disk (called after commits; optional extra flush after JSON-only workflows). */
  persist(): void {
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  private transaction<T>(fn: () => T): T {
    try {
      this.db.run("BEGIN;");
      const r = fn();
      this.db.run("COMMIT;");
      this.persist();
      return r;
    } catch (e) {
      try {
        this.db.run("ROLLBACK;");
      } catch {
        /* ignore */
      }
      throw e;
    }
  }

  close(): void {
    this.db.close();
  }

  getCumulativeCsvRows(): number {
    const row = queryOne<[string]>(this.db, "SELECT v FROM meta WHERE k = ?", [META_CUMULATIVE]);
    if (!row) return 0;
    const n = Number(row[0]);
    return Number.isFinite(n) ? n : 0;
  }

  private setCumulativeCsvRows(n: number): void {
    runExec(this.db, "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [
      META_CUMULATIVE,
      String(n),
    ]);
  }

  getStats(): FeederStoreStats {
    const rSys = queryOne<SqlValue[]>(this.db, "SELECT COUNT(*) AS c FROM systems", []);
    const rPl = queryOne<SqlValue[]>(this.db, "SELECT COUNT(*) AS c FROM planets", []);
    const rSi = queryOne<SqlValue[]>(this.db, "SELECT COUNT(*) AS c FROM sightings", []);
    const rSp = queryOne<SqlValue[]>(this.db, "SELECT COUNT(*) AS c FROM species_line_counts", []);
    const uniqueSystems = Number(rSys?.[0] ?? 0);
    const uniquePlanets = Number(rPl?.[0] ?? 0);
    const uniqueSightings = Number(rSi?.[0] ?? 0);
    const speciesLabels = Number(rSp?.[0] ?? 0);
    const rCoords = queryOne<SqlValue[]>(
      this.db,
      "SELECT COUNT(*) AS c FROM systems WHERE x IS NOT NULL AND y IS NOT NULL AND z IS NOT NULL",
      [],
    );
    return {
      uniqueSystems,
      uniquePlanets,
      uniqueSightings,
      speciesLabels,
      cumulativeCsvRowsImported: this.getCumulativeCsvRows(),
      systemsWithCoords: Number(rCoords?.[0] ?? 0),
    };
  }

  /** Read JSON file at path; returns true when data was imported into an empty DB. */
  tryMigrateFromIndexJsonFile(path: string): boolean {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return false;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
    return this.importFromParsedIndexJson(parsed);
  }

  /**
   * Import legacy index (v2 or v1 shape). Only runs when {@link getStats}.uniqueSystems is 0.
   */
  importFromParsedIndexJson(parsed: unknown): boolean {
    if (!parsed || typeof parsed !== "object") return false;
    if (this.getStats().uniqueSystems > 0) return false;

    const o = parsed as Record<string, unknown>;
    let speciesMap: Record<string, SpeciesIndexEntry>;
    let cumulative = 0;

    if (o.formatVersion === 2 && o.species && typeof o.species === "object" && !Array.isArray(o.species)) {
      speciesMap = o.species as Record<string, SpeciesIndexEntry>;
      cumulative =
        typeof o.cumulativeCsvRowsImported === "number" && Number.isFinite(o.cumulativeCsvRowsImported)
          ? o.cumulativeCsvRowsImported
          : 0;
    } else {
      const speciesRaw = o.species;
      if (!speciesRaw || typeof speciesRaw !== "object" || Array.isArray(speciesRaw)) return false;
      speciesMap = this.rebuildLegacySpeciesMap(speciesRaw as Record<string, Record<string, unknown>>);
      cumulative =
        typeof o.csvRowCount === "number" && Number.isFinite(o.csvRowCount) ? (o.csvRowCount as number) : 0;
    }

    if (Object.keys(speciesMap).length === 0) return false;

    this.transaction(() => {
      for (const [label, entry] of Object.entries(speciesMap)) {
        const speciesLabel = entry.speciesLabel?.trim() || label;
        const snorm = normSpeciesLabel(speciesLabel);
        runExec(
          this.db,
          `INSERT INTO species_line_counts (species_norm, species_label, line_count) VALUES (?, ?, ?)
             ON CONFLICT(species_norm) DO UPDATE SET
               line_count = species_line_counts.line_count + excluded.line_count,
               species_label = excluded.species_label`,
          [snorm, speciesLabel, entry.csvRowCount],
        );

        for (const occ of entry.occurrences) {
          this.upsertSightingRow(
            occ.systemName,
            occ.bodyName,
            occ.bodySubtype ?? "",
            occ.distanceLs,
            speciesLabel,
            entry.genus,
            occ.count ?? null,
          );
        }
      }
      this.setCumulativeCsvRows(cumulative);
    });
    return true;
  }

  private rebuildLegacySpeciesMap(
    speciesRaw: Record<string, Record<string, unknown>>,
  ): Record<string, SpeciesIndexEntry> {
    const rebuilt: Record<string, SpeciesIndexEntry> = {};
    for (const [label, v] of Object.entries(speciesRaw)) {
      if (!v || typeof v !== "object") continue;
      const systemsArr = Array.isArray(v.systems)
        ? (v.systems as unknown[]).filter((s): s is string => typeof s === "string")
        : [];
      const occ: SpeciesIndexEntry["occurrences"] = [];
      const planets = v.planets;
      if (Array.isArray(planets)) {
        for (const p of planets) {
          if (!p || typeof p !== "object") continue;
          const rec = p as Record<string, unknown>;
          const sn = String(rec.systemName ?? "").trim();
          const bn = String(rec.bodyName ?? "").trim();
          if (!sn || !bn) continue;
          occ.push({
            systemName: sn,
            bodyName: bn,
            bodySubtype: typeof rec.bodySubtype === "string" ? rec.bodySubtype : "",
            count: typeof rec.count === "number" && Number.isFinite(rec.count) ? rec.count : null,
            distanceLs:
              typeof rec.distanceLs === "number" && Number.isFinite(rec.distanceLs) ? rec.distanceLs : null,
          });
        }
      }
      const genus = String(v.genus ?? "").trim() || "Unknown";
      const speciesLabel = String(v.speciesLabel ?? label).trim() || label;
      const systems =
        systemsArr.length > 0
          ? [...new Set(systemsArr.map((s) => s.trim()).filter(Boolean))]
          : [...new Set(occ.map((x) => x.systemName))];
      rebuilt[label] = {
        genus,
        speciesLabel,
        systems,
        occurrences: occ,
        csvRowCount:
          typeof v.csvRowCount === "number" && Number.isFinite(v.csvRowCount)
            ? (v.csvRowCount as number)
            : occ.length,
      };
    }
    return rebuilt;
  }

  applyCsvRows(rows: SpanshExoRow[]): void {
    if (rows.length === 0) return;
    this.transaction(() => {
      this.setCumulativeCsvRows(this.getCumulativeCsvRows() + rows.length);
      for (const row of rows) {
        const label = row.landmarkSubtype.trim();
        if (!label) continue;
        const snorm = normSpeciesLabel(label);
        runExec(
          this.db,
          `INSERT INTO species_line_counts (species_norm, species_label, line_count) VALUES (?, ?, 1)
             ON CONFLICT(species_norm) DO UPDATE SET line_count = line_count + 1, species_label = excluded.species_label`,
          [snorm, label],
        );
        const genus = genusFromLandmark(label);
        this.upsertSightingRow(
          row.systemName,
          row.bodyName,
          row.bodySubtype,
          row.distanceToArrival,
          label,
          genus,
          row.count,
        );
      }
    });
  }

  private ensureSystem(norm: string, display: string): number {
    runExec(
      this.db,
      "INSERT INTO systems (norm_name, display_name) VALUES (?, ?) ON CONFLICT(norm_name) DO NOTHING",
      [norm, display],
    );
    const row = queryOne<[number]>(this.db, "SELECT id FROM systems WHERE norm_name = ?", [norm]);
    if (!row) throw new Error("feederDb: missing system row");
    return row[0];
  }

  private ensurePlanet(
    systemId: number,
    bodyNorm: string,
    displayBody: string,
    bodySubtype: string,
    distanceLs: number | null,
    spanshCount: number | null,
  ): number {
    runExec(
      this.db,
      `INSERT INTO planets (system_id, norm_body, display_body, body_subtype, distance_ls, spansh_count)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(system_id, norm_body) DO UPDATE SET
           display_body = excluded.display_body,
           body_subtype = CASE
             WHEN TRIM(COALESCE(planets.body_subtype, '')) = '' AND TRIM(COALESCE(excluded.body_subtype, '')) != ''
             THEN excluded.body_subtype
             ELSE planets.body_subtype
           END,
           distance_ls = COALESCE(planets.distance_ls, excluded.distance_ls),
           spansh_count = COALESCE(planets.spansh_count, excluded.spansh_count)`,
      [systemId, bodyNorm, displayBody, bodySubtype ?? "", distanceLs, spanshCount],
    );
    const row = queryOne<[number]>(this.db, "SELECT id FROM planets WHERE system_id = ? AND norm_body = ?", [
      systemId,
      bodyNorm,
    ]);
    if (!row) throw new Error("feederDb: missing planet row");
    return row[0];
  }

  private upsertSightingRow(
    systemName: string,
    bodyName: string,
    bodySubtype: string,
    distanceLs: number | null,
    speciesLabel: string,
    genus: string,
    spanshCount: number | null,
  ): boolean {
    const sn = normSystem(systemName);
    const bn = normBody(bodyName);
    if (!sn || !bn) return false;
    const sid = this.ensureSystem(sn, systemName.trim());
    const pid = this.ensurePlanet(sid, bn, bodyName.trim(), bodySubtype, distanceLs, spanshCount);
    const speciesNorm = normSpeciesLabel(speciesLabel);
    runExec(
      this.db,
      "INSERT OR IGNORE INTO sightings (planet_id, species_norm, genus, species_label) VALUES (?, ?, ?, ?)",
      [pid, speciesNorm, genus, speciesLabel.trim()],
    );
    return this.db.getRowsModified() > 0;
  }

  /** Systems with no coordinates yet, display names, for the batch fetch. */
  /**
   * Every planet row with the two names it is keyed by and whatever identity it already carries.
   *
   * The backfill joins against this by `(normSystem, normBody)` because that is the only key the
   * corpus has today. Replacing that join with `(system_id, body_id)` is the point of the exercise,
   * but the bootstrap has to start from where the data is.
   */
  planetIdentityRows(): {
    planetId: number;
    systemId: number;
    normSystem: string;
    normBody: string;
    displayBody: string;
    bodyId: number | null;
    edsmId: number | null;
    systemEdsmId: number | null;
  }[] {
    return queryAll<[number, number, string, string, string, number | null, number | null, number | null]>(
      this.db,
      `SELECT p.id, p.system_id, s.norm_name, p.norm_body, p.display_body, p.body_id, p.edsm_id, s.edsm_id
         FROM planets p JOIN systems s ON s.id = p.system_id
        ORDER BY p.id`,
      [],
    ).map((r) => ({
      planetId: r[0],
      systemId: r[1],
      normSystem: r[2],
      normBody: r[3],
      displayBody: r[4],
      bodyId: r[5],
      edsmId: r[6],
      systemEdsmId: r[7],
    }));
  }

  /**
   * Write in-system BodyID and EDSM's body id onto planet rows.
   *
   * `COALESCE` on the existing value, so a second run is a no-op rather than a rewrite, and so a
   * later source cannot silently replace an identity already established.
   */
  setBodyIdentity(rows: { planetId: number; bodyId: number | null; edsmId: number | null }[]): number {
    if (rows.length === 0) return 0;
    let written = 0;
    this.transaction(() => {
      for (const r of rows) {
        runExec(
          this.db,
          `UPDATE planets SET body_id = COALESCE(body_id, ?), edsm_id = COALESCE(edsm_id, ?) WHERE id = ?`,
          [r.bodyId, r.edsmId, r.planetId],
        );
        written += this.db.getRowsModified();
      }
    });
    return written;
  }

  /** Write EDSM's small integer system id. `id64` stays NULL — it is Phase 2's, and re-collected. */
  setSystemEdsmIds(rows: { normSystem: string; edsmId: number }[]): number {
    if (rows.length === 0) return 0;
    let written = 0;
    this.transaction(() => {
      for (const r of rows) {
        runExec(this.db, "UPDATE systems SET edsm_id = COALESCE(edsm_id, ?) WHERE norm_name = ?", [
          r.edsmId,
          r.normSystem,
        ]);
        written += this.db.getRowsModified();
      }
    });
    return written;
  }

  /** Every system with the identity it carries so far. */
  systemIdentityRows(): { systemId: number; normSystem: string; displayName: string; id64: string | null }[] {
    return queryAll<[number, string, string, string | null]>(
      this.db,
      "SELECT id, norm_name, display_name, id64 FROM systems ORDER BY id",
      [],
    ).map((r) => ({ systemId: r[0], normSystem: r[1], displayName: r[2], id64: r[3] }));
  }

  /**
   * Store system `id64` as **text**.
   *
   * The column is TEXT and the value arrives as a string, so nothing in the path ever holds it as a
   * JavaScript number — which is the only way the digits survive. `COALESCE` keeps a second run a
   * no-op and stops a later source overwriting an identity already established.
   */
  setSystemId64(rows: { normSystem: string; id64: string; edsmId: number | null }[]): number {
    if (rows.length === 0) return 0;
    let written = 0;
    this.transaction(() => {
      for (const r of rows) {
        runExec(
          this.db,
          "UPDATE systems SET id64 = COALESCE(id64, ?), edsm_id = COALESCE(edsm_id, ?) WHERE norm_name = ?",
          [r.id64, r.edsmId, r.normSystem],
        );
        written += this.db.getRowsModified();
      }
    });
    return written;
  }

  systemId64Coverage(): { systems: number; systemsWithId64: number } {
    const one = (sql: string) => Number(queryOne<[number]>(this.db, sql, [])?.[0] ?? 0);
    return {
      systems: one("SELECT COUNT(*) FROM systems"),
      systemsWithId64: one("SELECT COUNT(*) FROM systems WHERE id64 IS NOT NULL"),
    };
  }

  /** How much of the corpus can now be addressed by identity rather than by name. */
  identityCoverage(): { planets: number; planetsWithBodyId: number; systems: number; systemsWithEdsmId: number } {
    const one = (sql: string) => Number(queryOne<[number]>(this.db, sql, [])?.[0] ?? 0);
    return {
      planets: one("SELECT COUNT(*) FROM planets"),
      planetsWithBodyId: one("SELECT COUNT(*) FROM planets WHERE body_id IS NOT NULL"),
      systems: one("SELECT COUNT(*) FROM systems"),
      systemsWithEdsmId: one("SELECT COUNT(*) FROM systems WHERE edsm_id IS NOT NULL"),
    };
  }

  /**
   * Planet rows that share a `(system_id, body_id)` — the same physical body imported more than
   * once because its name was rendered differently. This is the measurement Phase 1 exists to
   * produce, and nothing merges until the owner has seen it.
   */
  duplicateIdentityGroups(): { systemId: number; systemName: string; bodyId: number; bodies: string[] }[] {
    return queryAll<[number, string, number, string]>(
      this.db,
      `SELECT p.system_id, s.display_name, p.body_id, GROUP_CONCAT(p.display_body, ' | ')
         FROM planets p JOIN systems s ON s.id = p.system_id
        WHERE p.body_id IS NOT NULL
        GROUP BY p.system_id, p.body_id
       HAVING COUNT(*) > 1
        ORDER BY s.display_name`,
      [],
    ).map((r) => ({ systemId: r[0], systemName: r[1], bodyId: r[2], bodies: String(r[3]).split(" | ") }));
  }

  systemsMissingCoords(): string[] {
    return queryAll<[string]>(
      this.db,
      "SELECT display_name FROM systems WHERE x IS NULL OR y IS NULL OR z IS NULL ORDER BY id",
      [],
    ).map((r) => r[0]!);
  }

  /** Store coordinates for systems already in the corpus. Unknown names are ignored, not inserted. */
  setSystemCoords(rows: { name: string; x: number; y: number; z: number }[]): number {
    if (rows.length === 0) return 0;
    let written = 0;
    this.transaction(() => {
      for (const r of rows) {
        runExec(this.db, "UPDATE systems SET x = ?, y = ?, z = ? WHERE norm_name = ?", [
          r.x,
          r.y,
          r.z,
          normSystem(r.name),
        ]);
        written += this.db.getRowsModified();
      }
    });
    return written;
  }

  /** Every system that has coordinates: id → position. */
  systemCoords(): Map<number, { x: number; y: number; z: number }> {
    const out = new Map<number, { x: number; y: number; z: number }>();
    for (const [id, x, y, z] of queryAll<[number, number, number, number]>(
      this.db,
      "SELECT id, x, y, z FROM systems WHERE x IS NOT NULL AND y IS NOT NULL AND z IS NOT NULL",
      [],
    )) {
      out.set(id, { x, y, z });
    }
    return out;
  }

  rebuildSpeciesIndex(): Record<string, SpeciesIndexEntry> {
    const out: Record<string, SpeciesIndexEntry> = {};
    const speciesRows = queryAll<[string, string, number]>(
      this.db,
      `SELECT species_norm, species_label, line_count FROM species_line_counts ORDER BY species_label COLLATE NOCASE`,
      [],
    );

    const occSql = `
      SELECT s.display_name AS systemName, p.display_body AS bodyName, p.body_subtype AS bodySubtype, p.distance_ls AS distanceLs, p.spansh_count AS spanshCount
      FROM sightings si
      JOIN planets p ON p.id = si.planet_id
      JOIN systems s ON s.id = p.system_id
      WHERE si.species_norm = ?
      ORDER BY s.display_name COLLATE NOCASE, p.display_body COLLATE NOCASE`;

    for (const sr of speciesRows) {
      const speciesNorm = sr[0]!;
      const speciesLabelRow = sr[1]!;
      const lineCount = sr[2]!;
      const rawOcc = queryAll<[string, string, string, number | null, number | null]>(this.db, occSql, [
        speciesNorm,
      ]).map((row) => ({
        systemName: row[0]!,
        bodyName: row[1]!,
        bodySubtype: row[2]!,
        distanceLs: row[3],
        count: row[4],
      }));

      const occMap = new Map<string, SpeciesIndexEntry["occurrences"][number]>();
      for (const o of rawOcc) {
        const k = occurrenceKey(o.systemName, o.bodyName);
        if (!occMap.has(k))
          occMap.set(k, {
            systemName: o.systemName,
            bodyName: o.bodyName,
            bodySubtype: o.bodySubtype,
            distanceLs: o.distanceLs,
            count: o.count,
          });
      }
      const occurrences = [...occMap.values()];
      const systems = [...new Set(occurrences.map((x) => x.systemName.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
      const gRow = queryOne<[string]>(this.db, `SELECT genus FROM sightings WHERE species_norm = ? LIMIT 1`, [
        speciesNorm,
      ]);

      out[speciesLabelRow] = {
        genus: gRow?.[0]?.trim() || genusFromLandmark(speciesLabelRow),
        speciesLabel: speciesLabelRow,
        systems,
        occurrences,
        csvRowCount: lineCount,
      };
    }
    return out;
  }
}

/** WASM SQLite — same file format as native SQLite; avoids Node ABI issues with native addons. */
export async function openFeederStore(dbPath: string): Promise<FeederStore> {
  const SQL = await initSqlJs({ locateFile: (file: string) => wasmPath(file) });
  mkdirSync(dirname(dbPath), { recursive: true });
  let db: Database;
  if (existsSync(dbPath)) {
    const buf = readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  const store = new FeederStore(dbPath, db);
  store.persist();
  return store;
}
