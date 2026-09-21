/**
 * Build `data/exomastery/body-type-prior.json` — what grows on a body of *this kind*.
 *
 *   npx tsx scripts/build-body-type-prior.ts [path/to/exomastery-feeder/data/raw/planets]
 *
 * ### What it is for
 *
 * The ranking model's prior is galaxy-wide: "how much of all recorded biology is this species". Three
 * field misses on 2026-09-21 were the same shape — the corpus knows the answer **for that kind of
 * body** and the model reached for it through a galaxy-wide number instead. Bacterium tela is 52 % of
 * hot thin-sulphur-dioxide bodies and verrata 43-48 % of water-magma ones; both lost to a species
 * more common overall.
 *
 * This table answers the narrower question. It is a **joint count**, which is the point: the
 * likelihood already multiplies seven to twenty-seven damped terms that assume independence, and
 * that assumption is why it has to be damped at all. Counting whole bodies assumes nothing.
 *
 * ### The key, and the backoff
 *
 * ```
 *   planet class | atmosphere | volcanism family | temperature band
 * ```
 *
 * Coarse enough to carry counts: five classes, atmosphere folded (`NeonRich` → `neon`), the
 * volcanism family with its intensity stripped (`Major Water Magma` → `watermagma`), and the
 * temperature bands swept in §C1g. A cell under the reader's floor is not trusted and it falls
 * through to the next level; when none answers, the galaxy-wide prior stands.
 *
 * **The temperature edges are measured, not chosen.** The corpus is not spread across temperature,
 * it is piled at two spikes — 72.8 % of bodies sit between 150 K and 200 K and 16.6 % between 400 K
 * and 450 K — so the obvious `[100, 200, 300]` put three quarters of everything in one cell and the
 * term said nothing on most bodies. `[100, 160, 185, 300]` splits the big spike and was the best of
 * seven band sets on the probe.
 *
 * ### The source
 *
 * `exomastery-feeder/data/raw/planets`, which is **not** shipped: one JSON per (body, species), the
 * body's own record from EDSM beside the species actually found on it. 51,272 usable pairs over
 * 13,983 distinct bodies and 99 species at the time of writing. Nine of the tree's 108 species are
 * colour splits the corpus does not carry and they fall back to the galaxy prior, which is correct
 * rather than a gap.
 *
 * Re-run this after a corpus rebuild. The output is small — about 57 KB — and ships beside the
 * histogram edges.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { BODY_TYPE_T_EDGES, bodyTypeKeyParts } from "../src/shared/bodyTypeKey.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = process.argv[2] ?? path.resolve(root, "..", "exomastery-feeder", "data", "raw", "planets");

if (!existsSync(rawDir)) {
  console.error(`No raw corpus at ${rawDir}`);
  console.error("Pass the path to exomastery-feeder/data/raw/planets as the first argument.");
  process.exit(1);
}

const db = loadSpeciesDatabaseFromTree(root);
const byName = new Map(db.species.map((e) => [e.displayName.toLowerCase(), e.id]));

/** Finest key first — the reader walks these in the same order. */
const LEVELS: ((c: string, a: string, v: string, t: string) => string)[] = [
  (c, a, v, t) => `${c}|${a}|${v}|${t}`,
  (c, a, v) => `${c}|${a}|${v}`,
  (c, a, v) => `${c}|${a}|${v === "none" ? "none" : "volc"}`,
  (c, a) => `${c}|${a}`,
  (_c, a) => a,
];

const tables: Record<string, Record<string, number>>[] = LEVELS.map(() => ({}));
let pairs = 0;
let unmapped = 0;
const missing = new Set<string>();
const bodies = new Set<string>();

for (const genusDir of readdirSync(rawDir)) {
  const dir = path.join(rawDir, genusDir);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    continue; // not a directory
  }
  for (const file of files) {
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const label = String(rec.speciesLabel ?? "");
    const id = byName.get(label.toLowerCase());
    if (!id) {
      unmapped++;
      missing.add(label);
      continue;
    }
    const ctx = rec.context as { targetBody?: Record<string, unknown> } | undefined;
    const body = ctx?.targetBody;
    if (!body || typeof body !== "object") continue;
    const tRaw = Number(body.surfaceTemperature);
    const { planetClass, atmosphere, volcanism, temperature } = bodyTypeKeyParts({
      subType: String(body.subType ?? ""),
      atmosphereType: String(body.atmosphereType ?? ""),
      volcanismType: String(body.volcanismType ?? ""),
      temperatureK: Number.isFinite(tRaw) ? tRaw : null,
    });
    pairs++;
    bodies.add(String(rec.bodyName ?? file));
    for (const [i, fn] of LEVELS.entries()) {
      const k = fn(planetClass, atmosphere, volcanism, temperature);
      (tables[i]![k] ??= {})[id] = ((tables[i]![k] ?? {})[id] ?? 0) + 1;
    }
  }
}

const outDir = path.join(root, "data", "exomastery");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "body-type-prior.json");
writeFileSync(
  out,
  JSON.stringify({
    formatVersion: 1,
    builtAt: new Date().toISOString().slice(0, 10),
    tEdges: BODY_TYPE_T_EDGES,
    levels: tables,
  }),
);

console.log(`pairs ${pairs.toLocaleString()} over ${bodies.size.toLocaleString()} bodies`);
console.log(
  `unmapped species labels: ${unmapped} (${[...missing].slice(0, 5).join(", ")}${missing.size > 5 ? ", …" : ""})`,
);
console.log(`cells per level: ${tables.map((t) => Object.keys(t).length).join(", ")}`);
console.log(`-> ${path.relative(root, out)}`);
