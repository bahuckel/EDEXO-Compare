/**
 * Species precision, phase 2: one species' gates against every body it was found on — and, given a
 * proposed change, what that change would do before anybody decides on it.
 *
 *   npx tsx scripts/precision-gate-check.ts --species tussock_tussock_divisa
 *   npx tsx scripts/precision-gate-check.ts --species tussock_tussock_divisa \
 *       --patch '{"planet_types":["Rocky","High Metal Content"]}'
 *
 * ## What it answers
 *
 *  1. **Where does the species lose its own bodies?** Every truth slot replayed through the shipped
 *     matcher: shown, demoted, or not listed at all, with the failing gate's own words counted.
 *  2. **What do its bodies actually look like?** Planet class, atmosphere, volcanism and host star
 *     counted; gravity, temperature and pressure as a spread — split by source, because a finding only
 *     one source believes is a property of that source.
 *  3. **Every colour.** Recall per host-star class, which is what sets the colour for most genera: a
 *     change that rescues the F-star bodies and drops the M-star ones is caught here.
 *  4. **With `--patch`, the price.** The patch goes through the real loader (`loadPatchedDb`) and the
 *     whole genus is replayed twice. Recall gained on the species' own bodies is set against the
 *     slots of *other* species it now appears in — the precision the change costs — and against any
 *     sibling that loses its own bodies.
 *
 * Nothing here edits `data/species`. A patch that earns its keep goes to the owner with this report.
 *
 * Output: stdout, and `docs/precision/gate-<species>.md` (local only).
 */
import path from "node:path";
import { writeFileSync } from "node:fs";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { resolvePlanetTemperatureBand, speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import { hostStarClassKey } from "../src/shared/hostStarClass.js";
import { journalPressureToAtm } from "../src/shared/journalPhysics.js";
import {
  createReplay,
  loadPatchedDb,
  loadTruthByBody,
  precisionDir,
  root,
  runMatcher,
  type ConditionsPatch,
  type Prepared,
  type Source,
} from "./precisionReplay.js";
import type { SpeciesDatabase } from "../src/shared/types.js";

const argv = process.argv.slice(2);
const argOf = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const speciesId = argOf("species");
if (!speciesId) {
  console.error("usage: npx tsx scripts/precision-gate-check.ts --species <id> [--patch '<conditions json>']");
  process.exit(1);
}
const patchRaw = argOf("patch");
const patch: ConditionsPatch | null = patchRaw ? (JSON.parse(patchRaw) as ConditionsPatch) : null;

const base = loadSpeciesDatabaseFromTree(root);
const entry = base.species.find((e) => e.id === speciesId);
if (!entry) {
  console.error(`no species ${speciesId}`);
  process.exit(1);
}
const genus = entry.genusDataDir;
const patched: SpeciesDatabase | null = patch ? loadPatchedDb({ [speciesId]: patch }) : null;

const truthByBody = await loadTruthByBody();
const { prepare } = await createReplay(base);

/* ------------------------------------------------------------------ replay the genus */

type Tier = "shown" | "unlikely" | "absent";
interface GenusSlot {
  body: string;
  truth: string;
  source: Source;
  p: Prepared;
  base: Map<string, Tier>; // genus species → tier
  patched: Map<string, Tier> | null;
}

/** The matcher's own soft-failure reasons for this species, where it was demoted — post-match gates included. */
const demotedBy = new Map<string, string[]>(); // body → reasons
function tiers(db: SpeciesDatabase, p: Prepared, body?: string): Map<string, Tier> {
  const out = new Map<string, Tier>();
  for (const m of runMatcher(db, p, true)) {
    if (m.entry.genusDataDir !== genus) continue;
    out.set(m.entry.id, m.unlikely ? "unlikely" : "shown");
    if (body && m.unlikely && m.entry.id === speciesId)
      demotedBy.set(body, m.reasons.filter((r) => r.soft).map((r) => `soft ${r.field}: ${r.detail}`));
  }
  return out;
}
const tierOf = (m: Map<string, Tier> | null, id: string): Tier => m?.get(id) ?? "absent";

const slots: GenusSlot[] = [];
for (const [key, rows] of truthByBody) {
  const row = rows.find((r) => r.genus === genus);
  if (!row) continue;
  const p = prepare(key, rows);
  if (!p) continue;
  slots.push({ body: row.body, truth: row.species, source: p.source, p, base: tiers(base, p, row.body), patched: patched ? tiers(patched, p) : null });
}
const own = slots.filter((s) => s.truth === speciesId);

/* ------------------------------------------------------------------ the report */

const out: string[] = [];
const say = (...l: string[]) => out.push(...l);
const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : "—");
const SOURCES: Source[] = ["journal", "capture", "corpus"];

say(`# Gate check — ${entry.displayName} (\`${speciesId}\`)`, ``, `Generated ${new Date().toISOString()}. Local only.`, ``);
say(`Genus **${genus}**: ${slots.length} slots replayed, ${own.length} of them this species' own.`, ``);
{
  const doc = base.species.find((e) => e.id === speciesId)!;
  say(`Current criteria (as loaded):`, ``, "```json", JSON.stringify(doc.criteria, null, 1).slice(0, 1500), "```", ``);
  if (patch) say(`**Patch under test:** \`${JSON.stringify(patch)}\``, ``);
}

/* 1. where it loses its own bodies */
const tierCount = (list: GenusSlot[], which: "base" | "patched") => {
  const c = { shown: 0, unlikely: 0, absent: 0 };
  for (const s of list) c[tierOf(which === "base" ? s.base : s.patched, speciesId)] += 1;
  return c;
};
say(`## 1. Its own bodies`, ``, `| source | bodies | shown | unlikely | not listed |${patch ? " shown after patch |" : ""}`, `|---|---:|---:|---:|---:|${patch ? "---:|" : ""}`);
for (const src of [...SOURCES, "all"] as const) {
  const l = src === "all" ? own : own.filter((s) => s.source === src);
  if (!l.length) continue;
  const b = tierCount(l, "base");
  const a = patch ? tierCount(l, "patched") : null;
  say(`| ${src} | ${l.length} | ${pc(b.shown, l.length)} | ${b.unlikely} | ${b.absent} |${a ? ` ${pc(a.shown, l.length)} |` : ""}`);
}
const failures = new Map<string, number>();
for (const s of own) {
  const tier = tierOf(s.base, speciesId);
  if (tier === "shown") continue;
  let lines: string[];
  if (tier === "unlikely") {
    // Demoted: the matcher says why, including the gates it applies after the per-species check.
    lines = demotedBy.get(s.body) ?? [];
  } else {
    // Not listed: only the per-species check knows. Given the matcher's own temperature inputs —
    // passing null reads as "no temperature at all".
    const est = estimatedTemperatureRangeForScan(s.p.scan);
    const r = speciesMatchesCriteria(entry, s.p.scan, resolvePlanetTemperatureBand(s.p.scan, est), est, s.p.ctx);
    lines = r.ok ? ["(passes its own gates — removed by a system-level rule)"] : r.reasons.map((f) => `${f.soft ? "soft" : "HARD"} ${f.field}: ${f.detail}`);
  }
  for (const line of lines) {
    const k = line.replace(/\d+\.\d{3,}/g, (n) => Number(n).toFixed(2));
    failures.set(k, (failures.get(k) ?? 0) + 1);
  }
}
say(``, `Why, on the bodies it is not shown on (the gate's own words, counted):`, ``);
say([...failures].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => `- ×${n} ${k}`).join("\n") || "_none_", ``);

/* 2. what its bodies look like */
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function spread(xs: number[]): string {
  if (!xs.length) return "—";
  const s = [...xs].sort((a, b) => a - b);
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))]!;
  const f = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(3));
  return `${f(s[0]!)} · p5 ${f(q(0.05))} · median ${f(q(0.5))} · p95 ${f(q(0.95))} · ${f(s[s.length - 1]!)}`;
}
function counts(values: string[]): string {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
}
say(`## 2. What its bodies look like`, ``);
for (const src of [...SOURCES, "all"] as const) {
  const l = src === "all" ? own : own.filter((s) => s.source === src);
  if (!l.length) continue;
  const scans = l.map((s) => s.p.scan);
  say(
    `### ${src} (${l.length})`,
    ``,
    `- planet class: ${counts(scans.map((x) => x.PlanetClass ?? "?"))}`,
    `- atmosphere: ${counts(scans.map((x) => x.AtmosphereType ?? "?"))}`,
    `- volcanism: ${counts(scans.map((x) => x.Volcanism?.trim() || "none"))}`,
    `- host star: ${counts(l.map((s) => hostStarClassKey(s.p.ctx.parentStarType) ?? "?"))}`,
    `- gravity g: ${spread(scans.map((x) => num(x.SurfaceGravity)).filter((x): x is number => x != null).map((x) => x / 9.80665))}`,
    `- temperature K: ${spread(scans.map((x) => num(x.SurfaceTemperature)).filter((x): x is number => x != null))}`,
    `- pressure atm: ${spread(scans.map((x) => num(x.SurfacePressure)).filter((x): x is number => x != null).map(journalPressureToAtm))}`,
    ``,
  );
}

/*
  Temperature per atmosphere, all sources together. A flat band on a species that lives in two
  climates — Fungoida on CO2 at 180-195 K and on water above 390 K — is the commonest shape of a
  wrong gate, and a table per atmosphere is where it shows.
*/
{
  const byAtmo = new Map<string, number[]>();
  for (const s of own) {
    const a = s.p.scan.AtmosphereType?.replace(/^(?:(?:hot|thin|thick)\s+)+/i, "") || "none";
    const t = num(s.p.scan.SurfaceTemperature);
    if (t != null) byAtmo.set(a, [...(byAtmo.get(a) ?? []), t]);
  }
  say(`### temperature by atmosphere (all sources)`, ``, `| atmosphere | bodies | K: min · p5 · median · p95 · max |`, `|---|---:|---|`);
  for (const [a, ts] of [...byAtmo].sort((x, y) => y[1].length - x[1].length)) say(`| ${a} | ${ts.length} | ${spread(ts)} |`);
  say(``);
}

/* 3. every colour */
say(`## 3. Recall per host-star class (the colour, for star-set genera)`, ``, `| host | bodies | shown |${patch ? " after patch |" : ""}`, `|---|---:|---:|${patch ? "---:|" : ""}`);
const byHost = new Map<string, GenusSlot[]>();
for (const s of own) {
  const k = hostStarClassKey(s.p.ctx.parentStarType) ?? "?";
  byHost.set(k, [...(byHost.get(k) ?? []), s]);
}
for (const [k, l] of [...byHost].sort((a, b) => b[1].length - a[1].length)) {
  const b = l.filter((s) => tierOf(s.base, speciesId) === "shown").length;
  const a = patch ? l.filter((s) => tierOf(s.patched, speciesId) === "shown").length : 0;
  say(`| ${k} | ${l.length} | ${pc(b, l.length)} |${patch ? ` ${pc(a, l.length)} |` : ""}`);
}
say(``);

/* 4. the price of the patch */
if (patch) {
  const others = slots.filter((s) => s.truth !== speciesId);
  const addedTo = others.filter((s) => tierOf(s.base, speciesId) !== "shown" && tierOf(s.patched, speciesId) === "shown");
  const removedFrom = others.filter((s) => tierOf(s.base, speciesId) === "shown" && tierOf(s.patched, speciesId) !== "shown");
  const meanSize = (which: "base" | "patched") =>
    slots.reduce((a, s) => a + [...(which === "base" ? s.base : s.patched!).values()].filter((t) => t === "shown").length, 0) / slots.length;
  const siblingLoss = others.filter((s) => tierOf(s.base, s.truth) === "shown" && tierOf(s.patched, s.truth) !== "shown");
  const gained = own.filter((s) => tierOf(s.base, speciesId) !== "shown" && tierOf(s.patched, speciesId) === "shown").length;
  const lost = own.filter((s) => tierOf(s.base, speciesId) === "shown" && tierOf(s.patched, speciesId) !== "shown").length;
  say(
    `## 4. What the patch costs`,
    ``,
    `| | |`,
    `|---|---:|`,
    `| own bodies newly shown | **+${gained}** of ${own.length} |`,
    `| own bodies newly hidden | ${lost} |`,
    `| other species' slots it now appears in | **${addedTo.length}** of ${others.length} (${pc(addedTo.length, others.length)}) |`,
    `| other species' slots it leaves | ${removedFrom.length} |`,
    `| siblings losing their own body | ${siblingLoss.length} |`,
    `| genus mean slot size | ${meanSize("base").toFixed(3)} → ${meanSize("patched").toFixed(3)} |`,
    ``,
  );
  const whose = new Map<string, number>();
  for (const s of addedTo) whose.set(s.truth, (whose.get(s.truth) ?? 0) + 1);
  say(`Whose slots it joins: ${[...whose].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k.split("_").pop()} ${n}`).join(", ") || "none"}`, ``);
}

const file = path.join(precisionDir, `gate-${speciesId}${patch ? "-patched" : ""}.md`);
writeFileSync(file, out.join("\n"));
console.log(out.join("\n"));
console.log(`\n→ ${path.relative(root, file)}`);
