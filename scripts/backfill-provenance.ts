/**
 * Give the 47,983 rows that predate schema 4 an origin, without inventing one.
 *
 * Two columns, two very different levels of confidence, which is the whole point of keeping them
 * apart:
 *
 * ## `sightings.claim_origin` — provable, not guessed
 *
 * The corpus has exactly one statement that writes a sighting (`feederDb.upsertSightingRow`) and
 * exactly two callers: `applyCsvRows`, which is fed by `importCsv` from a Spansh exobiology export,
 * and the legacy-index restore, whose index files were themselves produced by earlier runs of that
 * same import. No journal, EDDN or EDSM path has ever created a sighting — EDSM's bodies endpoint
 * does not even return biological signals. So every pre-existing row is `exomastery` by
 * construction, and this is a deduction from the write paths rather than an assumption about the
 * data.
 *
 * The one thing that would break that deduction is a corpus built by a version of the code that no
 * longer exists, so the script reports what it changed and never touches a row that already has an
 * origin.
 *
 * ## `planets.body_data_origin` — inferred, and says so
 *
 * Recovered from columns already present. EDSM wins over Spansh where both are set: a route export
 * carries a body's subtype and arrival distance, but gravity, temperature and atmosphere — the
 * numbers every profile is built from — come from the EDSM hydrate.
 *
 * Run with `--write`. Without it, this reports and changes nothing.
 */
import { copyFileSync, existsSync } from "node:fs";
import { openFeederStore } from "../src/feeder/feederDb.js";
import { feederDbPath } from "../src/feeder/paths.js";

const write = process.argv.includes("--write");
const dbPath = feederDbPath();

if (!existsSync(dbPath)) {
  console.error(`No corpus at ${dbPath}`);
  process.exit(1);
}

if (write) {
  // The migration rewrites the file in place; a corpus is not something to lose to a bad WHERE.
  const backup = `${dbPath}.bak-preprovenance`;
  if (!existsSync(backup)) {
    copyFileSync(dbPath, backup);
    console.log(`Backed up to ${backup}`);
  } else {
    console.log(`Backup already exists at ${backup}, leaving it alone`);
  }
}

const store = await openFeederStore(dbPath);
const db = store.db;

const count = (sql: string): number => {
  const st = db.prepare(sql);
  st.step();
  const n = Number(st.get()[0]);
  st.free();
  return n;
};

const before = {
  sightings: count("SELECT COUNT(*) FROM sightings"),
  withClaim: count("SELECT COUNT(*) FROM sightings WHERE claim_origin IS NOT NULL"),
  planets: count("SELECT COUNT(*) FROM planets"),
  withBody: count("SELECT COUNT(*) FROM planets WHERE body_data_origin IS NOT NULL"),
};

console.log(`corpus: ${before.sightings.toLocaleString()} sightings, ${before.planets.toLocaleString()} planets`);
console.log(`  already tagged: ${before.withClaim} claims, ${before.withBody} bodies`);

/**
 * The three body rules as a **partition**, not a fallthrough.
 *
 * A fallthrough reads fine and reports nonsense in a dry run: with nothing written, each probe sees
 * the whole untagged set, so the counts overlap instead of summing to the row count — the first
 * version of this script printed 9,895 + 3,651 + 13,789 against 13,789 planets. Worse, it makes the
 * dry run and the real run disagree, which is the one property a dry run exists to provide.
 *
 * Spelling out the exclusions costs a clause each and makes the counts add up in both modes,
 * whatever order the steps run in.
 */
const BODY_EDSM = "body_data_origin IS NULL AND edsm_id IS NOT NULL";
const BODY_SPANSH = `body_data_origin IS NULL AND edsm_id IS NULL
    AND (spansh_count IS NOT NULL OR mapped_source = 'spansh')`;
const BODY_UNKNOWN = `body_data_origin IS NULL AND edsm_id IS NULL AND spansh_count IS NULL
    AND (mapped_source IS NULL OR mapped_source <> 'spansh')`;

const plan = [
  {
    what: "claim_origin = exomastery (every writer is a Spansh exobiology export)",
    sql: "UPDATE sightings SET claim_origin = 'exomastery' WHERE claim_origin IS NULL",
    probe: "SELECT COUNT(*) FROM sightings WHERE claim_origin IS NULL",
  },
  /*
   * The three body rules are written as a **partition**, not as a fallthrough.
   *
   * A fallthrough reads fine and reports nonsense in a dry run: with nothing written, each probe
   * sees the whole untagged set, so the three counts overlap instead of summing. Worse, it makes the
   * dry run and the real run disagree — exactly the property a dry run exists to provide.
   *
   * Spelling out the exclusions costs a line each and makes the counts add up to the row count, in
   * both modes, whatever order the steps run in.
   */
  {
    what: "body_data_origin = edsm (hydrated from EDSM; wins where both are set)",
    sql: `UPDATE planets SET body_data_origin = 'edsm' WHERE ${BODY_EDSM}`,
    probe: `SELECT COUNT(*) FROM planets WHERE ${BODY_EDSM}`,
  },
  {
    what: "body_data_origin = spansh (came via a Spansh export, never hydrated)",
    sql: `UPDATE planets SET body_data_origin = 'spansh' WHERE ${BODY_SPANSH}`,
    probe: `SELECT COUNT(*) FROM planets WHERE ${BODY_SPANSH}`,
  },
  {
    what: "body_data_origin = unknown (no column says where the numbers came from)",
    sql: `UPDATE planets SET body_data_origin = 'unknown' WHERE ${BODY_UNKNOWN}`,
    probe: `SELECT COUNT(*) FROM planets WHERE ${BODY_UNKNOWN}`,
  },
];

console.log(write ? "\napplying:" : "\nwould apply (pass --write to commit):");
for (const step of plan) {
  const n = count(step.probe);
  console.log(`  ${String(n).padStart(7)}  ${step.what}`);
  if (write && n > 0) db.run(step.sql);
}

if (write) {
  store.persist();
  console.log("\nsaved.");
  const rows = db.exec(
    `SELECT claim_origin, COUNT(*) FROM sightings GROUP BY 1
     UNION ALL SELECT 'body:' || COALESCE(body_data_origin,'null'), COUNT(*) FROM planets GROUP BY body_data_origin`,
  );
  for (const r of rows[0]?.values ?? []) console.log(`  ${String(r[0]).padEnd(18)} ${r[1]}`);
} else {
  console.log("\nnothing written.");
}
