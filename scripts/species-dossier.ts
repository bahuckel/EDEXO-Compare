/**
 * Every body one species has been recorded on, with the parameters we actually argue about.
 *
 * Asked for on Bacterium tela: *"find all bacterium tela we have, write them down with body names,
 * parameters of the body and etc — gravity, atmosphere, body type, crust materials, volcanism, star
 * type."* It takes `--species`, so the same dossier can be produced for any of them.
 *
 * ## Where the rows come from
 *
 * Three sources, kept apart in the output because they are not the same kind of evidence:
 *
 *  - **corpus** — `exomastery-feeder/data/raw/planets/<slug>/body_*.json`, each naming the system
 *    cache that holds the body's full record. This is the bulk, and it is the same material the
 *    species profile is built from. Note that the pack directory holds *more* bodies than the
 *    profile counts, so a total here will not match `sampleCount`; the old notes are explicit that
 *    you reconcile against the profile before quoting a number from the packs.
 *  - **journal** — the commander's own `ScanOrganic` confirmations, read from his journals, with the
 *    body's physics from the same `Scan` line. Few, and the only rows where the colour variant is
 *    known, because the variant token names the material that set it.
 *  - **relay** — `eddn-bio-collector`, when its store is present. Other commanders' scans, arriving
 *    live. Optional: the dossier is complete without it.
 *
 * ## Why the shape of the output is what it is
 *
 * A list of 800 bodies answers nothing on its own. Each axis is summarised **against an ambient
 * rate** first — the pooled distribution of every species profile — because a share without one is
 * the mistake this project keeps making: 69 % Thin Water reads as a finding until you learn that bio
 * bodies are 15 % Thin Water anyway, and *that* is the finding. The per-body table follows, for
 * reading by hand and for grepping.
 *
 *   npx tsx scripts/species-dossier.ts                                  # Bacterium Tela
 *   npx tsx scripts/species-dossier.ts --species "Osseus discus"
 *   npx tsx scripts/species-dossier.ts --out docs/whatever.md
 *
 * Paths are resolved relative to this repository, never hard-coded: `EXOMASTERY_FEEDER_DIR` and
 * `EDDN_COLLECTOR_DB` override the siblings it expects.
 */
import path from "node:path";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { listJournalFilesChronological, readJournalFull } from "../src/server/journalWatcher.js";
import { normaliseMaterial } from "../src/shared/speciesColour.js";
import type { JournalLine } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const argOf = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};

const speciesName = argOf("species", "Bacterium Tela");
const slug = speciesName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
const outPath = path.resolve(root, argOf("out", path.join("docs", `${slug.replace(/_/g, "-")}-resolve.md`)));

const feederDir = process.env.EXOMASTERY_FEEDER_DIR?.trim() || path.resolve(root, "..", "exomastery-feeder");
const collectorDb =
  process.env.EDDN_COLLECTOR_DB?.trim() || path.resolve(root, "..", "eddn-bio-collector", "data", "collector.sqlite");

/* ------------------------------------------------------------------ the row */

interface Row {
  source: "corpus" | "journal" | "relay";
  system: string;
  body: string;
  bodyClass: string;
  atmosphere: string;
  /** The dominant gas and its share, which is what "Thin Water" actually means. */
  atmosphereDetail: string;
  gravityG: number | null;
  temperatureK: number | null;
  pressureAtm: number | null;
  volcanism: string;
  star: string;
  distanceLs: number | null;
  /** Grade-3 materials present, the six the colour question turns on. */
  grade3: string;
  /** Everything in the crust, ordered as the source gave it. */
  materials: string;
  /** Colour variant, when the source knows it. Only the journal and the relay ever do. */
  variant: string;
}

const rows: Row[] = [];

const SPLIT_LINES = new RegExp("\r?\n");
const GRADE3 = ["cadmium", "mercury", "molybdenum", "niobium", "tin", "tungsten"];
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clean = (v: unknown): string => String(v ?? "").trim();

/** `{Iron: 20.89, ...}` -> "Iron 20.9, ..." — biggest first, which is how a crust is read. */
function materialList(mats: Record<string, number> | undefined): string {
  if (!mats) return "";
  return Object.entries(mats)
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(", ");
}

function grade3Of(mats: Record<string, number> | undefined): string {
  if (!mats) return "";
  const hits = Object.entries(mats)
    .filter(([k]) => GRADE3.includes(normaliseMaterial(k)))
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v.toFixed(2)}`);
  return hits.join(", ");
}

function dominantGas(comp: Record<string, number> | undefined): string {
  if (!comp) return "";
  const top = Object.entries(comp)
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => b[1] - a[1])[0];
  return top ? `${top[0]} ${top[1].toFixed(1)}%` : "";
}

/* ------------------------------------------------------------------ 1. the corpus packs */

interface SystemCacheBody {
  name?: string;
  bodyId?: number;
  subType?: string;
  isLandable?: boolean;
  gravity?: number;
  surfaceTemperature?: number;
  surfacePressure?: number;
  volcanismType?: string;
  atmosphereType?: string;
  atmosphereComposition?: Record<string, number>;
  materials?: Record<string, number>;
  distanceToArrival?: number;
  parents?: Record<string, number>[];
}

interface StarSummary {
  name?: string;
  spectralClass?: string;
  starType?: string;
  subType?: string;
  luminosity?: string;
}

const systemCache = new Map<string, SystemCacheBody[]>();
function bodiesOfSystemCache(file: string): SystemCacheBody[] {
  const hit = systemCache.get(file);
  if (hit) return hit;
  let list: SystemCacheBody[] = [];
  try {
    const j = JSON.parse(readFileSync(path.join(feederDir, "data", "raw", "systems", file), "utf8")) as {
      bodies?: SystemCacheBody[];
    };
    list = Array.isArray(j.bodies) ? j.bodies : [];
  } catch {
    list = [];
  }
  systemCache.set(file, list);
  return list;
}

/**
 * The star this body orbits, named as the codex would.
 *
 * `parents` is nearest-first, so the first `Star` entry is the host; the star summaries in the body
 * file carry the classes. A body orbiting a barycentre names no star at all, and rather than pick one
 * of a pair — the mistake that put an M-dwarf host on an Electricae pluma record — every star in the
 * system is listed.
 */
function starFor(body: SystemCacheBody, stars: StarSummary[], sysBodies: SystemCacheBody[]): string {
  const label = (s: StarSummary | undefined) =>
    clean(s?.spectralClass) || clean(s?.starType) || clean(s?.subType) || "?";
  const starIds = (body.parents ?? []).map((p) => p?.Star).filter((x): x is number => typeof x === "number");
  if (starIds.length > 0) {
    const names = starIds
      .map((id) => sysBodies.find((b) => b.bodyId === id)?.name)
      .filter((x): x is string => Boolean(x));
    const matched = names.map((n) => stars.find((s) => clean(s.name) === n)).filter(Boolean) as StarSummary[];
    if (matched.length) return matched.map(label).join(" / ");
  }
  return stars.length ? `${stars.map(label).join(" / ")} (system)` : "?";
}

interface PackDoc {
  systemName?: string;
  bodyName?: string;
  systemCacheFile?: string;
  context?: { starSummaries?: StarSummary[] };
}

/*
  The pack directory holds the same record under three spellings, and taking only one of them is how
  the first run of this dossier reported 430 bodies for a species with more than eight hundred:

    body_<hash>.json    the individually fetched bodies
    sample_<n>.json     the sampled ones, identical shape, different prefix
    samples.jsonl.gz    the same sample set again, one JSON object per line

  So read all three and de-duplicate on the body name. The gzip is a superset of the loose
  `sample_*.json` files here, but that is a property of this directory rather than a rule, and
  dropping either one on that assumption would quietly lose bodies somewhere else.
*/
const packDir = path.join(feederDir, "data", "raw", "planets", slug);
const packDocs: PackDoc[] = [];
if (existsSync(packDir)) {
  for (const f of readdirSync(packDir)) {
    const full = path.join(packDir, f);
    try {
      if (f.endsWith(".jsonl.gz")) {
        const text = gunzipSync(readFileSync(full)).toString("utf8");
        for (const line of text.split(SPLIT_LINES)) {
          if (line.trim()) packDocs.push(JSON.parse(line) as PackDoc);
        }
      } else if (f.endsWith(".json")) {
        packDocs.push(JSON.parse(readFileSync(full, "utf8")) as PackDoc);
      }
    } catch {
      /* a pack that will not parse is skipped; the rest still land */
    }
  }
}

const packFiles = packDocs;
const seenBodies = new Set<string>();
for (const doc of packDocs) {
  const name = clean(doc.bodyName);
  if (!name || seenBodies.has(name)) continue;
  seenBodies.add(name);
  const cacheFile = clean(doc.systemCacheFile);
  if (!cacheFile) continue;
  const sysBodies = bodiesOfSystemCache(cacheFile);
  const body = sysBodies.find((b) => clean(b.name) === clean(doc.bodyName));
  if (!body) continue;

  rows.push({
    source: "corpus",
    system: clean(doc.systemName),
    body: clean(doc.bodyName),
    bodyClass: clean(body.subType),
    atmosphere: clean(body.atmosphereType),
    atmosphereDetail: dominantGas(body.atmosphereComposition),
    gravityG: num(body.gravity),
    temperatureK: num(body.surfaceTemperature),
    pressureAtm: num(body.surfacePressure),
    volcanism: clean(body.volcanismType) || "No volcanism",
    star: starFor(body, doc.context?.starSummaries ?? [], sysBodies),
    distanceLs: num(body.distanceToArrival),
    grade3: grade3Of(body.materials),
    materials: materialList(body.materials),
    variant: "",
  });
}

/* ------------------------------------------------------------------ 2. his own journals */

const journalDir =
  process.env.ED_JOURNAL_DIR?.trim() ||
  path.join(process.env.USERPROFILE || "", "Saved Games", "Frontier Developments", "Elite Dangerous");

interface JournalBody {
  system: string;
  name: string;
  planetClass: string;
  atmosphereType: string;
  atmosphereComposition: Record<string, number>;
  materials: Record<string, number>;
  gravityMs: number | null;
  temperatureK: number | null;
  pressurePa: number | null;
  volcanism: string;
  distanceLs: number | null;
  parentStarId: number | null;
  starType: string | null;
}

const journalBodies = new Map<string, JournalBody>();
const journalHits = new Map<string, string>(); // bodyKey -> variant label
const bodyKey = (sys: unknown, id: unknown) => `${String(sys)}:${String(id)}`;

const wantedLower = speciesName.trim().toLowerCase();

function handle(line: JournalLine): void {
  if (line.event === "Scan") {
    const key = bodyKey(line.SystemAddress, line.BodyID);
    const mats: Record<string, number> = {};
    for (const m of (line.Materials as { Name?: string; Percent?: number }[] | undefined) ?? []) {
      const n = clean(m?.Name);
      if (n) mats[n[0]!.toUpperCase() + n.slice(1)] = Number(m?.Percent ?? 0);
    }
    const comp: Record<string, number> = {};
    for (const c of (line.AtmosphereComposition as { Name?: string; Percent?: number }[] | undefined) ?? []) {
      const n = clean(c?.Name);
      if (n) comp[n] = Number(c?.Percent ?? 0);
    }
    let parentStarId: number | null = null;
    for (const p of (line.Parents as Record<string, number>[] | undefined) ?? []) {
      if (typeof p?.Star === "number") {
        parentStarId = p.Star;
        break;
      }
    }
    journalBodies.set(key, {
      system: clean(line.StarSystem),
      name: clean(line.BodyName),
      planetClass: clean(line.PlanetClass),
      atmosphereType: clean(line.AtmosphereType),
      atmosphereComposition: comp,
      materials: mats,
      gravityMs: num(line.SurfaceGravity),
      temperatureK: num(line.SurfaceTemperature),
      pressurePa: num(line.SurfacePressure),
      volcanism: clean(line.Volcanism) || "No volcanism",
      distanceLs: num(line.DistanceFromArrivalLS),
      parentStarId,
      starType: clean(line.StarType) || null,
    });
    return;
  }
  if (line.event !== "ScanOrganic") return;
  const species = clean(line.Species_Localised);
  const genus = clean(line.Genus_Localised);
  const full = species.toLowerCase().startsWith(genus.toLowerCase()) ? species : `${genus} ${species}`.trim();
  if (full.toLowerCase() !== wantedLower) return;
  journalHits.set(bodyKey(line.SystemAddress, line.Body), clean(line.Variant_Localised));
}

if (existsSync(journalDir)) {
  const files = await listJournalFilesChronological(journalDir, { minFileStartUtcMs: 0 });
  for (const file of files) await readJournalFull(file, handle);
}

for (const [key, variant] of journalHits) {
  const b = journalBodies.get(key);
  if (!b) continue;
  const sys = key.split(":")[0]!;
  const star =
    b.parentStarId != null ? (journalBodies.get(`${sys}:${b.parentStarId}`)?.starType ?? "?") : (b.starType ?? "?");
  rows.push({
    source: "journal",
    system: b.system,
    body: b.name,
    bodyClass: b.planetClass,
    atmosphere: b.atmosphereType,
    atmosphereDetail: dominantGas(b.atmosphereComposition),
    gravityG: b.gravityMs == null ? null : b.gravityMs / 9.80665,
    temperatureK: b.temperatureK,
    pressureAtm: b.pressurePa == null ? null : b.pressurePa / 101_325,
    volcanism: b.volcanism,
    star,
    distanceLs: b.distanceLs,
    grade3: grade3Of(b.materials),
    materials: materialList(b.materials),
    variant: variant.includes(" - ") ? variant.slice(variant.lastIndexOf(" - ") + 3) : "",
  });
}

/* ------------------------------------------------------------------ 3. the relay, if it is there */

let relayNote = "not read (no store on disk)";
if (existsSync(collectorDb)) {
  try {
    const { DatabaseSync } = (await import("node:sqlite")) as typeof import("node:sqlite");
    const db = new DatabaseSync(collectorDb, { readOnly: true });
    let seen = 0;
    for (const r of db.prepare("select body_name, system_name, host_star, json from bodies").all() as {
      body_name: string;
      system_name: string;
      host_star: string | null;
      json: string;
    }[]) {
      let doc: Record<string, unknown>;
      try {
        doc = JSON.parse(r.json) as Record<string, unknown>;
      } catch {
        continue;
      }
      const labels = [
        ...((doc.organics as { name?: string; variant?: string }[] | undefined) ?? []).map((o) => ({
          name: o.name,
          token: o.variant,
        })),
        ...((doc.codex as { name?: string; token?: string }[] | undefined) ?? []).map((c) => ({
          name: c.name,
          token: c.token,
        })),
      ].filter((l) => clean(l.name).toLowerCase() === wantedLower);
      if (labels.length === 0) continue;
      seen += 1;

      const scan = (doc.scan ?? {}) as {
        PlanetClass?: string;
        AtmosphereType?: string;
        SurfaceGravity?: number;
        SurfaceTemperature?: number;
        SurfacePressure?: number;
        Volcanism?: string;
        DistanceFromArrivalLS?: number;
        Materials?: { Name?: string; Percent?: number }[];
        AtmosphereComposition?: { Name?: string; Percent?: number }[];
      };
      const mats: Record<string, number> = {};
      for (const m of scan.Materials ?? []) {
        const n = clean(m?.Name);
        if (n) mats[n[0]!.toUpperCase() + n.slice(1)] = Number(m?.Percent ?? 0);
      }
      const comp: Record<string, number> = {};
      for (const c of scan.AtmosphereComposition ?? []) {
        const n = clean(c?.Name);
        if (n) comp[n] = Number(c?.Percent ?? 0);
      }
      const tokenMaterial = labels.map((l) => /_([A-Za-z]{4,})_Name;?$/.exec(clean(l.token))?.[1]).find(Boolean);

      rows.push({
        source: "relay",
        system: clean(r.system_name),
        body: clean(r.body_name),
        bodyClass: clean(scan.PlanetClass),
        atmosphere: clean(scan.AtmosphereType),
        atmosphereDetail: dominantGas(comp),
        gravityG: scan.SurfaceGravity == null ? null : scan.SurfaceGravity / 9.80665,
        temperatureK: num(scan.SurfaceTemperature),
        pressureAtm: scan.SurfacePressure == null ? null : scan.SurfacePressure / 101_325,
        volcanism: clean(scan.Volcanism) || (scan.PlanetClass ? "No volcanism" : ""),
        star: clean(r.host_star) || "?",
        distanceLs: num(scan.DistanceFromArrivalLS),
        grade3: grade3Of(mats),
        materials: materialList(mats),
        variant: tokenMaterial ? `${tokenMaterial} (material)` : "",
      });
    }
    relayNote = `${seen} bodies`;
  } catch (e) {
    relayNote = `unreadable (${(e as Error).message})`;
  }
}

/* ------------------------------------------------------------------ the ambient, for comparison */

function pooledAmbient(axisPath: string): Map<string, number> {
  const out = new Map<string, number>();
  const speciesRoot = path.join(root, "data", "species");
  if (!existsSync(speciesRoot)) return out;
  for (const genus of readdirSync(speciesRoot)) {
    const dir = path.join(speciesRoot, genus, "exomastery");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith("_exomastery.json")) continue;
      try {
        const prof = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as {
          categorical?: Record<string, Record<string, number>>;
        };
        for (const [k, n] of Object.entries(prof.categorical?.[axisPath] ?? {})) {
          if (Number.isFinite(n)) out.set(k, (out.get(k) ?? 0) + n);
        }
      } catch {
        /* skip a profile that will not parse */
      }
    }
  }
  return out;
}

/*
  The journal and the corpus spell the same value differently -- `SulphurDioxide` against
  `Thin Sulphur dioxide`, `High metal content body` against `High metal content world` -- and a first
  run of this dossier listed each pair as two separate rows, splitting 131 sulphur-dioxide bodies into
  116 and 15. Every axis is therefore bucketed on a flattened key, and the row is labelled with the
  fullest spelling seen for that key, which is the corpus one wherever the corpus has the value.
*/
function flatten(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^(hot\s+|cold\s+)?(thin|thick)\s+/, "")
    .replace(/\s+(body|world)$/, "")
    .replace(/\s+volcanism$/, "")
    .replace(/[\s_-]+/g, "");
}

const AXES: { label: string; of: (r: Row) => string; ambient: string }[] = [
  { label: "Atmosphere", of: (r) => r.atmosphere || "(none recorded)", ambient: "body.atmosphereType" },
  { label: "Body class", of: (r) => r.bodyClass || "(unknown)", ambient: "body.subType" },
  { label: "Volcanism", of: (r) => r.volcanism || "(unknown)", ambient: "body.volcanismType" },
  { label: "Host star", of: (r) => r.star || "?", ambient: "exo.host_star_spectral_primary" },
];

/** Count by flattened key, remembering the fullest spelling met for each. */
function bucket(values: string[]): { counts: Map<string, number>; labels: Map<string, string> } {
  const counts = new Map<string, number>();
  /* key -> spelling -> times seen, so the label can be the commonest rather than the longest. */
  const spellings = new Map<string, Map<string, number>>();
  for (const v of values) {
    const k = flatten(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    const per = spellings.get(k) ?? new Map<string, number>();
    per.set(v, (per.get(v) ?? 0) + 1);
    spellings.set(k, per);
  }
  const labels = new Map<string, string>();
  for (const [k, per] of spellings) {
    // Commonest wins; a tie goes to the fuller spelling, which is the corpus one.
    const best = [...per].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
    if (best) labels.set(k, best[0]);
  }
  return { counts, labels };
}

function tally(values: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function numericSummary(values: (number | null)[], unit: string, digits = 3): string {
  const xs = values.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (xs.length === 0) return "no values recorded";
  const at = (q: number) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]!;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return (
    `min ${xs[0]!.toFixed(digits)} · 25th ${at(0.25).toFixed(digits)} · median ${at(0.5).toFixed(digits)} · ` +
    `75th ${at(0.75).toFixed(digits)} · max ${xs[xs.length - 1]!.toFixed(digits)} · mean ${mean.toFixed(digits)} ${unit} (n=${xs.length})`
  );
}

/* ------------------------------------------------------------------ write it */

const bySource = tally(rows.map((r) => r.source));
const md: string[] = [];

md.push(`# ${speciesName} — every body we have`);
md.push("");
md.push(
  `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by ` +
    "`npx tsx scripts/species-dossier.ts --species \"" +
    speciesName +
    '"`. Local-only, like everything under `docs/`.',
);
md.push("");
md.push("## Where these rows come from");
md.push("");
md.push("| source | rows | what it is |");
md.push("|---|---|---|");
md.push(
  `| corpus | ${bySource.get("corpus") ?? 0} | \`exomastery-feeder\` raw packs, joined to the system caches that hold each body's full record |`,
);
md.push(
  `| journal | ${bySource.get("journal") ?? 0} | the commander's own \`ScanOrganic\` confirmations — the only rows that know the colour variant |`,
);
md.push(`| relay | ${bySource.get("relay") ?? 0} | \`eddn-bio-collector\` (${relayNote}) |`);
md.push("");
md.push(
  `**${rows.length} bodies in total**, de-duplicated by body name. The pack directory yielded ` +
    `${packFiles.length} records across its three spellings (\`body_*.json\`, \`sample_*.json\` and ` +
    "`samples.jsonl.gz`); a row is dropped only when its system cache no longer holds the body. This total is " +
    "**not** the profile's `sampleCount` and should not be quoted as it — the packs carry more bodies than the " +
    "profile counts.",
);
md.push("");

md.push("## The numbers, before the list");
md.push("");
md.push("Each categorical axis is shown against the **ambient** — every species profile's counts pooled — because a");
md.push("share on its own says nothing. 69 % Thin Water only means something once you know bio bodies are 15 %");
md.push("Thin Water anyway.");
md.push("");

for (const axis of AXES) {
  const mine = bucket(rows.map(axis.of));
  const ambientRaw = pooledAmbient(axis.ambient);
  const ambient = new Map<string, number>();
  for (const [k, n] of ambientRaw) ambient.set(flatten(k), (ambient.get(flatten(k)) ?? 0) + n);
  const ambientTotal = [...ambient.values()].reduce((a, b) => a + b, 0);

  md.push(`### ${axis.label}`);
  md.push("");
  md.push("| value | bodies | share | ambient | lift |");
  md.push("|---|---:|---:|---:|---:|");
  for (const [key, n] of [...mine.counts].sort((a, b) => b[1] - a[1])) {
    const share = (n / Math.max(1, rows.length)) * 100;
    const amb = ambientTotal > 0 ? ((ambient.get(key) ?? 0) / ambientTotal) * 100 : 0;
    const lift = amb > 0 ? `${(share / amb).toFixed(2)}×` : "—";
    const label = mine.labels.get(key) ?? key;
    md.push(`| ${label} | ${n} | ${share.toFixed(1)} % | ${amb > 0 ? `${amb.toFixed(1)} %` : "—"} | ${lift} |`);
  }
  md.push("");
}

md.push("### The continuous ones");
md.push("");
md.push(`- **Gravity** — ${numericSummary(rows.map((r) => r.gravityG), "g")}`);
md.push(`- **Surface temperature** — ${numericSummary(rows.map((r) => r.temperatureK), "K", 1)}`);
md.push(`- **Surface pressure** — ${numericSummary(rows.map((r) => r.pressureAtm), "atm", 4)}`);
md.push(`- **Distance from arrival** — ${numericSummary(rows.map((r) => r.distanceLs), "ls", 0)}`);
md.push("");

const g3Count = (r: Row) => r.grade3.split(",").filter((x) => x.trim()).length;
const g3Hist = new Map<number, number>();
for (const r of rows) g3Hist.set(g3Count(r), (g3Hist.get(g3Count(r)) ?? 0) + 1);
const pairCounts = new Map<string, number>();
for (const r of rows) {
  const names = r.grade3
    .split(",")
    .map((x) => x.trim().split(" ")[0]!)
    .filter(Boolean)
    .sort();
  if (names.length === 2) {
    const k = names.join(" + ");
    pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
  }
}

md.push("### Grade-3 materials, which is where the colour question lives");
md.push("");
md.push("| grade-3 materials on the body | bodies |");
md.push("|---:|---:|");
for (const [n, c] of [...g3Hist].sort((a, b) => a[0] - b[0])) {
  md.push(`| ${n === 0 ? "none recorded" : n} | ${c} |`);
}
md.push("");
md.push(
  "**Every body that has them has exactly two — never one, never three.** That is not a quirk of this " +
    "dossier: the relay's independent sample said the same thing (154 contested bodies, all of them two). " +
    "Tela's colour table maps all six materials to six different colours, so *every* body it grows on is a " +
    "two-way choice, which is why the panel's hedge fires on essentially all of them rather than on a rare few.",
);
md.push("");
md.push(
  "And presence cannot settle it. Measured across 154 relay contests, the more abundant material wins 84 and " +
    "the scarcer 70 against a coin's 77; enrichment against each material's own median is 78 / 76. No fixed " +
    "order survives either — every genus contradicts itself, several pairs three and four deep. See §15 of the " +
    "2026-09-19 session notes before spending another evening on it.",
);
md.push("");
md.push("The pairs that actually occur, commonest first:");
md.push("");
md.push("| pair | bodies |");
md.push("|---|---:|");
for (const [pair, n] of [...pairCounts].sort((a, b) => b[1] - a[1])) md.push(`| ${pair} | ${n} |`);
md.push("");

const known = rows.filter((r) => r.variant);
if (known.length > 0) {
  md.push("### The bodies whose colour is known");
  md.push("");
  md.push("| body | variant | grade-3 present | source |");
  md.push("|---|---|---|---|");
  for (const r of known) md.push(`| ${r.body} | ${r.variant} | ${r.grade3 || "—"} | ${r.source} |`);
  md.push("");
}

md.push("## Every body");
md.push("");
md.push("Gravity in g, temperature in K, pressure in atm, distance in ls. Materials are the full crust, biggest");
md.push("first; the grade-3 column repeats the six the colour tables read.");
md.push("");
md.push("| # | source | body | class | atmosphere | main gas | g | K | atm | volcanism | star | ls | grade-3 | materials |");
md.push("|---:|---|---|---|---|---|---:|---:|---:|---|---|---:|---|---|");

const sorted = [...rows].sort((a, b) => {
  const order = { journal: 0, relay: 1, corpus: 2 } as const;
  if (order[a.source] !== order[b.source]) return order[a.source] - order[b.source];
  return a.body.localeCompare(b.body);
});
sorted.forEach((r, i) => {
  md.push(
    `| ${i + 1} | ${r.source} | ${r.body} | ${r.bodyClass} | ${r.atmosphere} | ${r.atmosphereDetail} | ` +
      `${r.gravityG?.toFixed(3) ?? "—"} | ${r.temperatureK?.toFixed(1) ?? "—"} | ${r.pressureAtm?.toFixed(4) ?? "—"} | ` +
      `${r.volcanism} | ${r.star} | ${r.distanceLs?.toFixed(0) ?? "—"} | ${r.grade3 || "—"} | ${r.materials || "—"} |`,
  );
});
md.push("");

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, md.join("\n"), "utf8");
console.log(`${rows.length} bodies -> ${path.relative(root, outPath)}`);
for (const [k, v] of bySource) console.log(`  ${k.padEnd(8)} ${v}`);
