/**
 * The feeder database's schema and its migrations, version by version. Split out of feederDb.ts (code review D, 2026-09-27).
 */
import { queryAll, queryOne, runExec } from "./feederSql.js";
import type { Database, SqlValue } from "sql.js";

const SCHEMA_VER = 4;
export const META_CUMULATIVE = "cumulative_csv_rows";
const META_SCHEMA = "schema_ver";

export function migrateSchema(db: Database): void {
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
   * but `sql.js`'s default `get()` hands it back to JavaScript as a `number`, which puts the float64
   * rounding straight back — see `bigIntJson.ts`.
   *
   * TEXT is not the *only* way to survive that; it is the way that cannot be got wrong. Measured on
   * sql.js 1.14.2 with `6160925022241180003`:
   *
   *   default get()                 6160925022241180000   rounded
   *   get(null, {useBigInt: true})  6160925022241180003   exact, a bigint
   *   CAST(col AS TEXT)             6160925022241180003   exact
   *
   * SQLite itself never loses the value in any of these — `a = CAST(b AS INTEGER)` compares equal.
   * The rounding is entirely a property of the JavaScript boundary, not of the column.
   *
   * TEXT is chosen here because `queryAll`/`queryOne` use a plain `.get()`, so an INTEGER id64 would
   * round in any call site that forgot to opt in, and forgetting is silent. At 2,993 systems the
   * storage and indexing cost of TEXT is noise. **A galaxy-scale store should choose differently**:
   * INTEGER with `useBigInt` keeps 64-bit exactness, an `INTEGER PRIMARY KEY` rowid alias, and no
   * second index — which is what the Spansh ingest does, correctly, at ~10^8 rows.
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
   * Who said so, schema 4 — see `../shared/provenance.ts` for the vocabulary and the reasoning.
   *
   * The corpus already recorded **how strong** each claim is: every row in `sightings` is a species
   * identification, which `sectorMapData` counts as `confirmed`. What it never recorded is **who
   * made it**, so 47,983 rows arrived indistinguishable — a Spansh export, a live EDDN upload and
   * the owner's own scan all looked identical once stored.
   *
   * Two columns, not one, because a row is two claims from two sources:
   *
   *   `sightings.claim_origin`     who says this species grows on this body
   *   `planets.body_data_origin`   who supplied that body's gravity, temperature and atmosphere
   *
   * They are usually different, and the tempting shortcut is wrong. 79.5 % of sightings sit on a
   * planet with an `edsm_id`, but reading that as "EDSM identified this species" would misattribute
   * most of the corpus: EDSM's bodies endpoint returns **no** biological signals — measured this
   * session as 0 of 1,444 planet records, with the `signals` key absent entirely. EDSM hydrated the
   * body; the Exomastery CSV made the claim.
   *
   * That asymmetry is why only one is backfillable. `body_data_origin` is recoverable from columns
   * already present; `claim_origin` is not, and a row imported before this existed is written
   * `unknown` rather than guessed. `unknown` is a real answer — the corpus genuinely does not know —
   * and it is deliberately not the same as a NULL that might mean "not yet migrated".
   */
  const sightingCols = new Set(
    queryAll<SqlValue[]>(db, "PRAGMA table_info(sightings)", []).map((r) => String(r[1])),
  );
  if (!sightingCols.has("claim_origin")) db.run("ALTER TABLE sightings ADD COLUMN claim_origin TEXT");
  if (!planetCols.has("body_data_origin")) db.run("ALTER TABLE planets ADD COLUMN body_data_origin TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_sightings_claim_origin ON sightings(claim_origin)");

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
  /**
   * The EDDN body register, schema 3 (INCLUDE-BODY-IDS Phase 4).
   *
   * Separate from `planets` on purpose. `planets` means "a body with at least one confirmed
   * sighting" and every profile is built from it; EDDN reports bodies nobody has identified yet, and
   * mixing the two would change what every count in the app means. This is Store A of §2.1 — one row
   * per physical body, keyed by the game's own identity, holding the target-ladder facts and nothing
   * about habitat.
   *
   * `system_id64` is TEXT for the same reason as everywhere else: `sql.js`'s default read hands an
   * INTEGER back as a JavaScript `number`.
   *
   * Footfall and mapping are tri-states with an age, and the sticky-`true` rule is enforced in the
   * upsert rather than trusted to the caller — see `observedFlag.ts` for why `true` outranks recency.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS eddn_bodies (
      system_id64      TEXT NOT NULL,
      body_id          INTEGER NOT NULL,
      system_name      TEXT,
      body_name        TEXT,
      x REAL, y REAL, z REAL,
      bio_signal_count INTEGER,
      genuses          TEXT,      -- JSON array, as EDDN's internal names
      is_footfalled    INTEGER,   -- NULL | 0 | 1
      footfall_seen_at TEXT,
      is_mapped        INTEGER,   -- NULL | 0 | 1
      mapped_seen_at   TEXT,
      first_seen_at    TEXT NOT NULL,
      last_seen_at     TEXT NOT NULL,
      PRIMARY KEY (system_id64, body_id)
    );
    CREATE INDEX IF NOT EXISTS idx_eddn_bodies_system ON eddn_bodies(system_id64);
    CREATE INDEX IF NOT EXISTS idx_eddn_bodies_unwalked
      ON eddn_bodies(is_footfalled, is_mapped) WHERE bio_signal_count > 0;
  `);

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
