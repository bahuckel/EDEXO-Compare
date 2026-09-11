/**
 * Fill the feeder's system cache from the local Spansh galaxy DB instead of from EDSM.
 *
 *   npx tsx scripts/hydrate-from-galaxy-db.ts [--limit N] [--dry]
 *
 * ## Why this exists
 *
 * A body's physical parameters — gravity, temperature, atmosphere, materials — reach the corpus in
 * exactly one way: `pipeline.ts` asks EDSM for a system, caches the reply under `raw/systems/`, and
 * pulls the body out of it. Importing a Spansh **route export** adds sightings but no physics, so a
 * fresh import leaves planets with `body_data_origin = NULL` and no numbers to build a profile from.
 *
 * `feeder -- import-dump` does not fill that gap and was never meant to: it is update-only and
 * writes mapping evidence and system coordinates, as `EDSM-targz-to-db/docs/DB-TO-EDEXO.md` §5 says
 * plainly — *"the remaining ~40 M body rows stream past unused"*.
 *
 * So the honest options were EDSM (thousands of rate-limited requests for data already on this
 * machine) or the local DB. The owner's instruction was the local DB.
 *
 * ## The seam
 *
 * The pipeline skips the network entirely when a system's JSON is already cached — that is what
 * `cachedSystemFileFor` is for. So this writes **EDSM-shaped** system JSON into that cache and
 * changes no pipeline code at all. `feeder -- run` afterwards reads it off disk.
 *
 * The shape is copied from a real cached EDSM reply rather than inferred, because two of its
 * choices are load-bearing and both are easy to get wrong:
 *
 * - `materials` and `solidComposition` are **objects** (`{"Iron": 22.4}`), not arrays. `flatten.ts`
 *   reads arrays for materials, so emitting arrays here would start counting material data that the
 *   existing 9,895 EDSM-hydrated bodies never contributed — a silent change to what every histogram
 *   means. Matching EDSM keeps the new rows comparable with the old.
 * - Only bodies EDSM would have are emitted. Stars come too, because `extractPlanetContext`
 *   summarises them for the star-driven colour rules.
 *
 * ## What the DB does not have
 *
 * `volcanism_type` is NULL on ~95 % of landable bio bodies, and NULL is not "No volcanism" — Spansh
 * writes that string when it knows. The field is therefore omitted rather than filled in, so the
 * histograms see "unrecorded" rather than a fact nobody established. Same for gas giants and water
 * worlds, whose `atmosphere_type` is NULL without meaning airless (DB-TO-EDEXO §4).
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every path comes from the environment so no machine layout is baked into a public repo.
 * `EDEXO_FEEDER_DIR` is the exomastery-feeder checkout; `EDEXO_GALAXY_DB` is the Spansh SQLite.
 */
function requireEnv(name: string, hint: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`${name} is not set — point it at ${hint}.`);
    process.exit(1);
  }
  return v.trim();
}

const GALAXY_DB = requireEnv("EDEXO_GALAXY_DB", "the Spansh galaxy SQLite file");
const FEEDER_DIR = requireEnv("EDEXO_FEEDER_DIR", "the exomastery-feeder checkout");
const FEEDER_DB = join(FEEDER_DIR, "data", "feeder_store.sqlite");
const SYSTEMS_DIR = join(FEEDER_DIR, "data", "raw", "systems");

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const limitArg = argv.find((a) => a.startsWith("--limit"));
const limit = limitArg ? Number(limitArg.split("=")[1] ?? argv[argv.indexOf(limitArg) + 1]) : 0;

/** Same rule as pipeline.ts, so the file lands where the pipeline will look for it. */
function systemFileSlug(name: string): string {
  const h = createHash("sha1").update(name.trim().toLowerCase()).digest("hex").slice(0, 20);
  const safe = name.replace(/[^\w-]+/g, "_").slice(0, 60);
  return `${safe}__${h}`;
}

/**
 * A body id64 exceeds 2^53 — `216173121057047981` is a real one from this DB — so every statement
 * reads integers as BigInt and the values are narrowed here. Reading them as numbers throws
 * outright in `node:sqlite`, which is the good outcome: the same mistake made silently upstream is
 * what ate 38,489 body ids once already (EDEXO-TEXT-OR-BIGINT §C).
 */
function num(v: unknown): number | null {
  if (typeof v === "bigint") return Number(v);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** An id keeps every digit by staying a string, exactly as the export writes it. */
function idString(v: unknown): string {
  return typeof v === "bigint" ? v.toString() : String(v);
}

/**
 * The solid classes where a missing atmosphere means airless.
 *
 * DB-TO-EDEXO §4: *"Airless in the exobiology sense = `atmosphereType` null or `"No atmosphere"`
 * **and** `subType` in {Rocky body, High metal content world, Metal-rich body, Icy body, Rocky Ice
 * world}"* — and, in the same breath, that gas giants and water worlds have no `atmosphereType` in
 * Spansh *"even though they have atmospheres; null there is not airless for them"*.
 *
 * EDSM writes the string `"No atmosphere"`; Spansh writes null for both cases and leaves the reader
 * to tell them apart. Passing null through would file an airless rock as *unknown* rather than as
 * *none*, which is a different claim and would put these bodies in a different bucket from the
 * 9,895 already hydrated from EDSM.
 */
const AIRLESS_WHEN_NULL = new Set([
  "Rocky body",
  "High metal content world",
  "Metal-rich body",
  "Icy body",
  "Rocky Ice world",
]);

/** SQLite has no boolean; 1/0 arrives as BigInt under `setReadBigInts`. */
function bool(v: unknown): boolean {
  return typeof v === "bigint" ? v === 1n : v === 1;
}

/** `{Iron: 22.4}` — EDSM's shape, not an array. See the header. */
function compositionObject(rows: { k: string; v: number }[]): Record<string, number> | null {
  if (rows.length === 0) return null;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.k] = r.v;
  return out;
}

function main(): void {
  const feeder = new DatabaseSync(FEEDER_DB, { readOnly: true });
  const galaxy = new DatabaseSync(GALAXY_DB, { readOnly: true });

  /*
    Systems that still own an un-hydrated planet. Joined here rather than listed by hand so a second
    run after a new route import picks up whatever is outstanding then.
  */
  const wanted = feeder
    .prepare(
      `SELECT DISTINCT s.display_name AS name
         FROM planets p JOIN systems s ON s.id = p.system_id
        WHERE p.body_data_origin IS NULL
        ORDER BY s.display_name`,
    )
    .all() as { name: string }[];

  const todo = limit > 0 ? wanted.slice(0, limit) : wanted;
  console.log(`${wanted.length} system(s) hold un-hydrated planets${limit > 0 ? ` — doing ${todo.length}` : ""}`);

  const sysStmt = galaxy.prepare(`SELECT id64, name, x, y, z, body_count FROM systems WHERE name = ? LIMIT 1`);
  const bodyStmt = galaxy.prepare(
    `SELECT id64, body_id, name, type, sub_type, distance_to_arrival, parents_json,
            is_landable, gravity, earth_masses, radius, surface_pressure, surface_temperature,
            atmosphere_type, volcanism_type, terraforming_state, rotational_period, tidally_locked,
            axial_tilt, orbital_period, semi_major_axis, orbital_eccentricity, orbital_inclination,
            arg_of_periapsis, spectral_class, luminosity, absolute_magnitude, solar_masses,
            solar_radius, age, main_star
       FROM bodies WHERE system_id64 = ? ORDER BY body_id`,
  );
  for (const st of [sysStmt, bodyStmt]) st.setReadBigInts(true);
  const matStmt = galaxy.prepare(`SELECT material AS k, percent AS v FROM body_materials WHERE body_id64 = ?`);
  const atmStmt = galaxy.prepare(`SELECT element AS k, percent AS v FROM body_atmosphere_composition WHERE body_id64 = ?`);
  const solStmt = galaxy.prepare(`SELECT element AS k, percent AS v FROM body_solid_composition WHERE body_id64 = ?`);

  if (!dry) mkdirSync(SYSTEMS_DIR, { recursive: true });

  let written = 0;
  let already = 0;
  let missing = 0;
  let bodies = 0;
  const started = Date.now();

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i]!.name;
    const file = join(SYSTEMS_DIR, `${systemFileSlug(name)}.json`);
    if (existsSync(file)) {
      already++;
      continue;
    }
    const srow = sysStmt.get(name) as Record<string, unknown> | undefined;
    if (!srow) {
      missing++;
      continue;
    }

    const sysId64 = srow.id64 as bigint;
    const rows = bodyStmt.all(sysId64) as Record<string, unknown>[];
    const out = rows.map((b) => {
      const id64 = b.id64 as bigint;
      const isStar = (b.type as string) === "Star";
      const body: Record<string, unknown> = {
        id64: idString(id64),
        bodyId: num(b.body_id),
        name: b.name,
        type: b.type,
        subType: b.sub_type,
        distanceToArrival: num(b.distance_to_arrival),
      };
      if (b.parents_json) {
        try {
          body.parents = JSON.parse(b.parents_json as string);
        } catch {
          /* a malformed parents list is not worth failing a system over */
        }
      }
      if (isStar) {
        body.isMainStar = bool(b.main_star);
        body.spectralClass = b.spectral_class ?? undefined;
        body.luminosity = b.luminosity ?? undefined;
        body.absoluteMagnitude = num(b.absolute_magnitude);
        body.solarMasses = num(b.solar_masses);
        body.solarRadius = num(b.solar_radius);
        body.age = num(b.age);
        body.surfaceTemperature = num(b.surface_temperature);
      } else {
        body.isLandable = bool(b.is_landable);
        body.gravity = num(b.gravity);
        body.earthMasses = num(b.earth_masses);
        body.radius = num(b.radius);
        body.surfacePressure = num(b.surface_pressure);
        body.surfaceTemperature = num(b.surface_temperature);
        const subType = typeof b.sub_type === "string" ? b.sub_type : "";
        body.atmosphereType =
          b.atmosphere_type ?? (AIRLESS_WHEN_NULL.has(subType) ? "No atmosphere" : null);
        // Omitted when NULL rather than called "No volcanism" — see the header.
        if (b.volcanism_type) body.volcanismType = b.volcanism_type;
        body.terraformingState = b.terraforming_state ?? null;
        body.rotationalPeriod = num(b.rotational_period);
        body.rotationalPeriodTidallyLocked = bool(b.tidally_locked);
        body.axialTilt = num(b.axial_tilt);
        body.orbitalPeriod = num(b.orbital_period);
        body.semiMajorAxis = num(b.semi_major_axis);
        body.orbitalEccentricity = num(b.orbital_eccentricity);
        body.orbitalInclination = num(b.orbital_inclination);
        body.argOfPeriapsis = num(b.arg_of_periapsis);
        body.materials = compositionObject(matStmt.all(id64) as { k: string; v: number }[]);
        body.atmosphereComposition = compositionObject(atmStmt.all(id64) as { k: string; v: number }[]);
        body.solidComposition = compositionObject(solStmt.all(id64) as { k: string; v: number }[]);
      }
      return body;
    });

    bodies += out.length;
    const doc = {
      id: null,
      id64: idString(sysId64),
      name: srow.name,
      url: null,
      bodyCount: num(srow.body_count) ?? out.length,
      coords: { x: num(srow.x), y: num(srow.y), z: num(srow.z) },
      bodies: out,
      // Stamped so a later reader can tell these from a genuine EDSM reply.
      _source: "galaxy.sqlite (local Spansh dump)",
    };
    if (!dry) writeFileSync(file, JSON.stringify(doc, null, 2), "utf8");
    written++;

    if (written % 200 === 0) {
      const rate = written / ((Date.now() - started) / 1000);
      const left = (todo.length - i - 1) / Math.max(rate, 0.001);
      console.log(
        `  ${written} written, ${bodies} bodies — ${rate.toFixed(1)}/s, ~${(left / 60).toFixed(1)} min left`,
      );
    }
  }

  console.log(
    `\n${dry ? "would write" : "wrote"} ${written} system file(s), ${bodies} bodies` +
      `\n${already} already cached, ${missing} not found in the galaxy DB` +
      `\nin ${((Date.now() - started) / 1000).toFixed(0)}s`,
  );
  if (dry) console.log("\nDry run — nothing written. Drop --dry to apply.");
}

main();
