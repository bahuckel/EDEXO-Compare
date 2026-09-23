/**
 * Species precision, phase 2: what separates two species of one genus?
 *
 *   npx tsx scripts/precision-separate.ts --pair frutexa_frutexa_acus frutexa_frutexa_metallicum
 *   npx tsx scripts/precision-separate.ts --top 8          # the phase-1 confusion pairs, by credits at stake
 *   npx tsx scripts/precision-separate.ts --genus stratum --top 10
 *   npx tsx scripts/precision-separate.ts --pair A B --where "distance to parent star ls>=2460"
 *
 * ## The question, shaped the way a gate is used
 *
 * A gate on species A demotes A wherever the body fails it. So a separator is useful exactly when it
 * **keeps A's own bodies** and **fails B's**: the search holds A's recall at a floor (99 % by default,
 * and 100 % reported beside it with its margin) and maximises the share of B's bodies the rule
 * excludes. Both directions are searched — a gate on A resolves B's slots, a gate on B resolves A's.
 *
 * Every axis the bodies carry: temperature, gravity, pressure, radius, mass, the orbit, rotation,
 * tilt, rock/metal/ice, **each crust material's share** (absent is 0 — itself information), **each
 * gas's share**, distance to the parent star, the parent star's subclass, galactic position — and the
 * categorical ones: planet class, atmosphere, volcanism, host-star class, luminosity, tidal lock,
 * region. One-feature rules first; then, greedily, the best second rule on what the first let
 * through, with A's floor held jointly.
 *
 * ## What makes a rule believable — all of it is reported, none of it assumed
 *
 *  - **Held out by system.** Five folds split by star system, never by body. The threshold is fitted
 *    on four and scored on the fifth.
 *  - **Per source.** A rule only one source believes is a property of that source.
 *  - **Per colour.** A's recall per host-star class: a rule may not drop a colour.
 *  - **Margin.** How far the nearest wrong-side body of A sits from the 100 % threshold.
 *  - **Counter-examples by name**, so a commander can go and look.
 *
 * Missing values abstain: a body with no reading on an axis passes a rule on that axis, which is how
 * the matcher treats a gate it cannot evaluate.
 *
 * Output: stdout and `docs/precision/separate-<A>-vs-<B>.md` (local only).
 */
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { loadPriceList, lookupPrice } from "../src/server/priceList.js";
import { hostStarClassKey } from "../src/shared/hostStarClass.js";
import { journalPressureToAtm } from "../src/shared/journalPhysics.js";
import { atmosphereCompositionKey, normalizeScanAtmosphereForMatch } from "../src/shared/scanAtmosphereMatch.js";
import { createReplay, loadTruthByBody, precisionDir, root, type Prepared, type Source } from "./precisionReplay.js";

const argv = process.argv.slice(2);
const argOf = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const FLOOR = Number(argOf("floor") ?? 0.99);

const db = loadSpeciesDatabaseFromTree(root);
const byId = new Map(db.species.map((e) => [e.id, e]));
const prices = loadPriceList(root);
const priceOf = (id: string) => {
  const e = byId.get(id);
  return e ? (lookupPrice(prices, e.displayName, e.id) ?? 0) : 0;
};

/* ------------------------------------------------------------------ which pairs */

let pairs: [string, string][] = [];
const pairIdx = argv.indexOf("--pair");
if (pairIdx >= 0) pairs = [[argv[pairIdx + 1]!, argv[pairIdx + 2]!]];
else {
  const top = Number(argOf("top") ?? 8);
  const tally = new Map<string, { a: string; b: string; stake: number }>();
  for (const line of readFileSync(path.join(precisionDir, "phase1-slots.jsonl"), "utf8").split("\n")) {
    if (!line) continue;
    const s = JSON.parse(line) as { truth: string; post: { shown: string[] } };
    if (!s.post.shown.includes(s.truth)) continue;
    for (const o of s.post.shown) {
      if (o === s.truth) continue;
      const [a, b] = [s.truth, o].sort() as [string, string];
      const k = `${a}|${b}`;
      const t = tally.get(k) ?? { a, b, stake: 0 };
      t.stake += Math.abs(priceOf(s.truth) - priceOf(o)) + 1; // +1 so equal-price confusions still count
      tally.set(k, t);
    }
  }
  // `--genus stratum` keeps the pairs of one genus: a round works through a genus at a time.
  const genus = argOf("genus");
  pairs = [...tally.values()]
    .filter((t) => !genus || byId.get(t.a)?.genusDataDir === genus)
    .sort((x, y) => y.stake - x.stake)
    .slice(0, top)
    .map((t) => [t.a, t.b]);
}
for (const [a, b] of pairs) {
  if (!byId.has(a) || !byId.has(b)) {
    console.error(`unknown species in pair ${a} / ${b}`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ bodies and their features */

const truthByBody = await loadTruthByBody();
const { prepare } = await createReplay(db);

interface Body {
  name: string;
  system: string;
  species: string;
  source: Source;
  host: string;
  num: Map<string, number>;
  cat: Map<string, string>;
}

const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
function features(p: Prepared): { num: Map<string, number>; cat: Map<string, string> } {
  const s = p.scan;
  const num = new Map<string, number>();
  const put = (k: string, v: unknown) => {
    const x = fin(v);
    if (x != null) num.set(k, x);
  };
  put("temperature K", s.SurfaceTemperature);
  const g = fin(s.SurfaceGravity);
  if (g != null) num.set("gravity g", g / 9.80665);
  const pr = fin(s.SurfacePressure);
  if (pr != null) num.set("pressure atm", journalPressureToAtm(pr));
  put("radius m", s.radius);
  put("mass EM", s.MassEM);
  put("semi-major axis m", s.SemiMajorAxis);
  put("eccentricity", s.Eccentricity);
  put("inclination", s.OrbitalInclination);
  put("orbital period s", s.OrbitalPeriod);
  put("rotation period s", s.RotationPeriod);
  put("axial tilt", s.AxialTilt);
  put("distance to parent star ls", p.ctx.orbitDistanceFromParentStarLs);
  put("parent star subclass", p.ctx.parentStarSubclass);
  if (p.ctx.systemCoords) {
    put("galactic x", p.ctx.systemCoords.x);
    put("galactic y", p.ctx.systemCoords.y);
    put("galactic z", p.ctx.systemCoords.z);
  }
  // Rock/metal/ice: the journal writes fractions, Spansh writes percent. One unit — percent.
  const comp = s.composition;
  if (comp && typeof comp === "object") {
    const vals = Object.values(comp).filter((v): v is number => typeof v === "number");
    const scale = vals.reduce((a, b) => a + b, 0) <= 1.5 ? 100 : 1;
    for (const [k, v] of Object.entries(comp)) if (typeof v === "number") num.set(`${k.toLowerCase()} %`, v * scale);
  }
  // Crust materials: a full list, so an absent element is a real zero. Only when the list exists.
  if (Array.isArray(s.materials) && s.materials.length) {
    for (const m of s.materials) {
      const n = String(m?.Name ?? m?.name ?? "").trim().toLowerCase();
      const v = fin(m?.Percent ?? m?.percent);
      if (n && v != null) num.set(`material ${n} %`, v);
    }
    num.set("__materials", 1);
  }
  if (Array.isArray(s.atmosphereComposition) && s.atmosphereComposition.length) {
    for (const a of s.atmosphereComposition) {
      const n = atmosphereCompositionKey(String(a?.Name ?? a?.name ?? ""));
      const v = fin(a?.Percent ?? a?.percent);
      if (n && v != null) num.set(`gas ${n} %`, v);
    }
    num.set("__gases", 1);
  }
  const cat = new Map<string, string>();
  cat.set("planet class", s.PlanetClass ?? "?");
  cat.set("atmosphere", atmosphereCompositionKey(normalizeScanAtmosphereForMatch(s)) || "none");
  cat.set("volcanism", (s.Volcanism ?? "").toLowerCase().replace(/\s*volcanism$/, "").trim() || "none");
  cat.set("host star", hostStarClassKey(p.ctx.parentStarType) ?? "?");
  // The system's main star — not always the host, and for some species the one that decides.
  if (p.ctx.systemMainStarClass) cat.set("main star", p.ctx.systemMainStarClass);
  // Where the body sits: a moon, a planet, or round a barycentre.
  if (p.parentKind) cat.set("orbits", p.parentKind);
  // What else the system holds — only where the body list is complete, or absence means nothing.
  if (p.ctx.systemBodyListComplete) {
    num.set("bodies in system", p.systemBodies);
    const held = new Set((p.ctx.systemBodyClasses ?? []).map((c) => c.toLowerCase()));
    for (const k of ["earthlike body", "water world", "ammonia world", "gas giant with water based life", "gas giant with ammonia based life", "sudarsky class i gas giant", "sudarsky class ii gas giant", "sudarsky class iii gas giant", "sudarsky class iv gas giant", "metal rich body", "icy body"])
      cat.set(`system has ${k}`, held.has(k) ? "yes" : "no");
  }
  if (p.ctx.parentStarLuminosity) cat.set("host luminosity", p.ctx.parentStarLuminosity);
  cat.set("tidally locked", s.TidalLock ? "yes" : "no");
  if (p.ctx.regionName) cat.set("region", p.ctx.regionName);
  return { num, cat };
}

const bodiesOf = new Map<string, Body[]>();
const wanted = new Set(pairs.flat());
for (const [key, rows] of truthByBody) {
  const hit = rows.filter((r) => wanted.has(r.species));
  if (!hit.length) continue;
  const p = prepare(key, rows);
  if (!p) continue;
  const f = features(p);
  for (const r of hit) {
    const b: Body = {
      name: r.body,
      system: p.scan.StarSystem || r.body,
      species: r.species,
      source: p.source,
      host: hostStarClassKey(p.ctx.parentStarType) ?? "?",
      num: f.num,
      cat: f.cat,
    };
    bodiesOf.set(r.species, [...(bodiesOf.get(r.species) ?? []), b]);
  }
}

// `--where "distance to parent star ls>=2460"` narrows both sides to the bodies where they still
// collide, once a first rule has done its work. Numeric `>=`/`<=`, categorical `=`; a body with no
// reading on the axis is left out, not let through.
const where = argOf("where");
if (where) {
  const m = /^(.+?)\s*(>=|<=|=)\s*(.+)$/.exec(where);
  if (!m) {
    console.error(`--where: cannot read "${where}" (feature>=n, feature<=n or feature=value)`);
    process.exit(1);
  }
  const [, feature, op, raw] = m as unknown as [string, string, string, string];
  const keepBody = (b: Body): boolean => {
    if (op === "=") return b.cat.get(feature) === raw;
    const v = b.num.get(feature);
    return v !== undefined && (op === ">=" ? v >= Number(raw) : v <= Number(raw));
  };
  for (const [k, l] of bodiesOf) bodiesOf.set(k, l.filter(keepBody));
}

/* ------------------------------------------------------------------ rules */

/**
 * Where the body is, rather than what it is. A separator on these is real but is not a gate to write
 * into a species row: the galaxy-wide region table (`region-species.json`) already answers "does it
 * grow here" from 5.3 million systems, where a list fitted to a few hundred truth bodies would miss
 * every region they happen not to include. They are reported, marked 🌐, and kept out of "best".
 */
const SPATIAL = new Set(["region", "galactic x", "galactic y", "galactic z"]);

type Rule =
  | { kind: "min" | "max"; feature: string; t: number }
  | { kind: "in"; feature: string; values: Set<string> };

/** Does a body pass the rule? Materials and gases absent from a full list read as 0; other gaps abstain. */
function passes(r: Rule, b: Body): boolean {
  if (r.kind === "in") {
    const v = b.cat.get(r.feature);
    return v === undefined || r.values.has(v);
  }
  let v = b.num.get(r.feature);
  if (v === undefined) {
    if (r.feature.startsWith("material ") && b.num.has("__materials")) v = 0;
    else if (r.feature.startsWith("gas ") && b.num.has("__gases")) v = 0;
    else return true;
  }
  return r.kind === "min" ? v >= r.t : v <= r.t;
}
const valueOf = (feature: string, b: Body): number | undefined => {
  const v = b.num.get(feature);
  if (v !== undefined) return v;
  if (feature.startsWith("material ") && b.num.has("__materials")) return 0;
  if (feature.startsWith("gas ") && b.num.has("__gases")) return 0;
  return undefined;
};
const describe = (r: Rule): string =>
  r.kind === "in"
    ? `${r.feature} ∈ {${[...r.values].sort().join(", ")}}`
    : `${r.feature} ${r.kind === "min" ? "≥" : "≤"} ${fmt(r.t)}`;
const fmt = (x: number) => (Math.abs(x) >= 1e5 ? x.toExponential(3) : Math.abs(x) >= 100 ? x.toFixed(1) : x.toFixed(3));

/**
 * Fit every one-feature rule that keeps at least `floor` of `keep` (A), and return them with the
 * share of `drop` (B) they exclude. Numeric thresholds sit at A's quantile; categorical sets take
 * A's commonest values until the floor is covered.
 */
function fitRules(keep: Body[], drop: Body[], floor: number, exact = false): Rule[] {
  const rules: Rule[] = [];
  const numFeatures = new Set<string>();
  for (const b of [...keep, ...drop]) for (const k of b.num.keys()) if (!k.startsWith("__")) numFeatures.add(k);
  for (const f of numFeatures) {
    const vals = keep.map((b) => valueOf(f, b)).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
    if (vals.length < Math.max(5, keep.length * 0.5)) continue; // an axis most of A never reports cannot gate A
    // Bodies with no reading abstain and pass, so only the ones with a value can be given up — at
    // most (1 - floor) of all of A, taken from the tail the threshold cuts.
    const allowedMisses = exact ? 0 : Math.floor(keep.length * (1 - floor));
    const k = Math.max(0, Math.min(vals.length - 1, allowedMisses));
    rules.push({ kind: "min", feature: f, t: vals[k]! });
    rules.push({ kind: "max", feature: f, t: vals[vals.length - 1 - k]! });
  }
  const catFeatures = new Set<string>();
  for (const b of keep) for (const k of b.cat.keys()) catFeatures.add(k);
  for (const f of catFeatures) {
    const counts = new Map<string, number>();
    let seen = 0;
    for (const b of keep) {
      const v = b.cat.get(f);
      if (v === undefined) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
      seen += 1;
    }
    if (!seen) continue;
    const need = exact ? seen : Math.ceil(seen - keep.length * (1 - floor));
    const values = new Set<string>();
    let covered = 0;
    for (const [v, n] of [...counts].sort((a, b) => b[1] - a[1])) {
      if (covered >= need) break;
      values.add(v);
      covered += n;
    }
    rules.push({ kind: "in", feature: f, values });
  }
  return rules;
}

interface Scored {
  rule: Rule;
  keepRate: number;
  dropRate: number;
}
function score(rule: Rule, keep: Body[], drop: Body[]): Scored {
  const k = keep.filter((b) => passes(rule, b)).length;
  const d = drop.filter((b) => !passes(rule, b)).length;
  return { rule, keepRate: keep.length ? k / keep.length : 1, dropRate: drop.length ? d / drop.length : 0 };
}
function bestRules(keep: Body[], drop: Body[], floor: number, n: number, exact = false): Scored[] {
  return fitRules(keep, drop, floor, exact)
    .map((r) => score(r, keep, drop))
    .filter((s) => s.keepRate >= floor - 1e-9 && s.dropRate > 0)
    .sort((a, b) => b.dropRate - a.dropRate || b.keepRate - a.keepRate)
    .slice(0, n);
}

/* ------------------------------------------------------------------ validation */

/** Five folds by system: fit the rule's threshold on four, score on the fifth. */
function crossValidate(template: Rule, keep: Body[], drop: Body[], floor: number): { keep: number; drop: number } {
  const systems = [...new Set([...keep, ...drop].map((b) => b.system))].sort();
  const fold = new Map(systems.map((s, i) => [s, i % 5]));
  let kk = 0;
  let kn = 0;
  let dd = 0;
  let dn = 0;
  for (let f = 0; f < 5; f++) {
    const trK = keep.filter((b) => fold.get(b.system) !== f);
    const trD = drop.filter((b) => fold.get(b.system) !== f);
    const teK = keep.filter((b) => fold.get(b.system) === f);
    const teD = drop.filter((b) => fold.get(b.system) === f);
    const refit = fitRules(trK, trD, floor).find(
      (r) => r.feature === template.feature && r.kind === template.kind,
    );
    if (!refit) continue;
    kk += teK.filter((b) => passes(refit, b)).length;
    kn += teK.length;
    dd += teD.filter((b) => !passes(refit, b)).length;
    dn += teD.length;
  }
  return { keep: kn ? kk / kn : 1, drop: dn ? dd / dn : 0 };
}

/* ------------------------------------------------------------------ report */

const pc = (x: number) => `${(100 * x).toFixed(1)} %`;
const short = (id: string) => byId.get(id)?.displayName ?? id;
const summary: string[] = [
  `| gate on | to reject | best physical rule (floor ${pc(FLOOR)}) | rejects, held out | keeps, held out | second rule | both reject | 🌐 spatial, held out |`,
  `|---|---|---|---:|---:|---|---:|---|`,
];

for (const [x, y] of pairs) {
  const out: string[] = [];
  const say = (...l: string[]) => out.push(...l);
  const X = bodiesOf.get(x) ?? [];
  const Y = bodiesOf.get(y) ?? [];
  say(`# ${short(x)} vs ${short(y)}`, ``, `Generated ${new Date().toISOString()} by \`scripts/precision-separate.ts\`. Local only.`, ``);
  say(`${short(x)}: ${X.length} bodies (${M(priceOf(x))}) · ${short(y)}: ${Y.length} bodies (${M(priceOf(y))}).${where ? ` Only where \`${where}\`.` : ""}`, ``);

  for (const [a, b, A, B] of [
    [x, y, X, Y],
    [y, x, Y, X],
  ] as const) {
    say(`## A gate on ${short(a)} that rejects ${short(b)}`, ``);
    if (A.length < 30 || B.length < 30) say(`> **Insufficient:** under 30 bodies on one side. Anything below is a hint, not a gate.`, ``);
    const top = bestRules(A, B, FLOOR, 16);
    say(`| rule | keeps ${short(a)} | rejects ${short(b)} | held out: keeps / rejects |`, `|---|---:|---:|---:|`);
    for (const s of top) {
      const cv = crossValidate(s.rule, A, B, FLOOR);
      say(`| ${SPATIAL.has(s.rule.feature) ? "🌐 " : ""}${describe(s.rule)} | ${pc(s.keepRate)} | **${pc(s.dropRate)}** | ${pc(cv.keep)} / ${pc(cv.drop)} |`);
    }
    say(``);
    const spatialBest = top.find((q) => SPATIAL.has(q.rule.feature));
    const best = top.find((q) => !SPATIAL.has(q.rule.feature));
    if (spatialBest) {
      const cv = crossValidate(spatialBest.rule, A, B, FLOOR);
      say(`🌐 **Spatially:** \`${describe(spatialBest.rule)}\` rejects ${pc(cv.drop)} held out — a question for the region table, not the row.`, ``);
    }
    if (!best) {
      say(`_No single axis keeps ${pc(FLOOR)} of ${short(a)} and rejects any ${short(b)}._`, ``);
      summary.push(`| ${short(a)} | ${short(b)} | — | — | — | — | — | ${spatialBest ? spatialBest.rule.feature : "—"} |`);
      continue;
    }

    // The best rule, examined.
    const r = best.rule;
    say(`### Best: \`${describe(r)}\``, ``);
    say(`Per source — keeps ${short(a)} / rejects ${short(b)}:`, ``);
    for (const src of ["journal", "capture", "corpus"] as Source[]) {
      const a2 = A.filter((q) => q.source === src);
      const b2 = B.filter((q) => q.source === src);
      if (!a2.length && !b2.length) continue;
      const s = score(r, a2, b2);
      say(`- ${src}: ${a2.length ? pc(s.keepRate) : "—"} of ${a2.length} / ${b2.length ? pc(s.dropRate) : "—"} of ${b2.length}`);
    }
    say(``, `${short(a)} kept, per host-star class (no colour may be dropped):`, ``);
    const hosts = new Map<string, Body[]>();
    for (const q of A) hosts.set(q.host, [...(hosts.get(q.host) ?? []), q]);
    say([...hosts].sort((p, q) => q[1].length - p[1].length).map(([h, l]) => `${h} ${pc(l.filter((q) => passes(r, q)).length / l.length)} of ${l.length}`).join(" · "), ``);
    if (r.kind !== "in") {
      const exact = fitRules(A, B, 1, true).find((q) => q.kind === r.kind && q.feature === r.feature);
      if (exact) {
        const s100 = score(exact, A, B);
        const vals = A.map((q) => valueOf(r.feature, q)).filter((v): v is number => v !== undefined);
        say(``, `At 100 % of ${short(a)}: \`${describe(exact)}\` rejects ${pc(s100.dropRate)} of ${short(b)}.`);
        const lost = A.filter((q) => !passes(r, q));
        if (lost.length)
          say(``, `${short(a)} bodies the ${pc(FLOOR)} rule would demote (${lost.length}): ${lost.slice(0, 12).map((q) => `${q.name} (${fmt(valueOf(r.feature, q) ?? NaN)}, ${q.source})`).join("; ")}`);
        const margin = r.kind === "min" ? Math.min(...vals) : Math.max(...vals);
        say(``, `Margin: ${short(a)}'s own extreme on this axis is ${fmt(margin)} against the ${pc(FLOOR)} threshold ${fmt(r.t)}.`);
      }
    }
    const through = B.filter((q) => passes(r, q));
    say(``, `${short(b)} bodies it lets through: ${through.length} of ${B.length}.`);

    // Greedy second rule on what got through, A's floor held jointly.
    const keptA = A.filter((q) => passes(r, q));
    const second = bestRules(keptA, through, FLOOR / best.keepRate > 1 ? 1 : FLOOR / best.keepRate, 12).find(
      (q) => !SPATIAL.has(q.rule.feature),
    );
    let both = best.dropRate;
    if (second) {
      const joint = score({ ...second.rule }, keptA, through);
      both = 1 - (through.length * (1 - joint.dropRate)) / (B.length || 1);
      const jointKeep = A.filter((q) => passes(r, q) && passes(second.rule, q)).length / (A.length || 1);
      say(``, `### Then: \`${describe(second.rule)}\``, ``, `Together they keep ${pc(jointKeep)} of ${short(a)} and reject **${pc(both)}** of ${short(b)}.`);
    }
    say(``);
    const cv = crossValidate(r, A, B, FLOOR);
    const sp = spatialBest ? crossValidate(spatialBest.rule, A, B, FLOOR) : null;
    summary.push(
      `| ${short(a)} | ${short(b)} | \`${describe(r)}\` | ${pc(cv.drop)} | ${pc(cv.keep)} | ${second ? `\`${describe(second.rule)}\`` : "—"} | ${pc(both)} | ${sp ? `${spatialBest!.rule.feature} ${pc(sp.drop)}` : "—"} |`,
    );
  }
  const file = path.join(precisionDir, `separate-${x}-vs-${y}${where ? "-where" : ""}.md`);
  writeFileSync(file, out.join("\n") + "\n");
  process.stderr.write(`→ ${path.relative(root, file)}\n`);
}

function M(cr: number) {
  return `${(cr / 1e6).toFixed(1)} M`;
}

writeFileSync(path.join(precisionDir, "separate-summary.md"), `# Separators\n\nGenerated ${new Date().toISOString()}.\n\n${summary.join("\n")}\n`);
console.log(summary.join("\n"));
