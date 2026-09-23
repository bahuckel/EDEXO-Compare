/**
 * Species precision, phase 2: every planet class a species is found on that its row leaves out —
 * priced, all at once.
 *
 *   npx tsx scripts/precision-class-sweep.ts [--min-bodies 5] [--min-share 0.05]
 *
 * Tussock divisa was shown on 45.7 % of its own bodies because its row said Rocky and 95 of its 175
 * bodies are High Metal Content. Osseus cornibus and Recepta umbrux turned up the same shape on the
 * next two checks, so this asks the question for every species instead of waiting to trip over them.
 *
 * For each species × planet class with at least `--min-bodies` truth bodies and `--min-share` of the
 * species' own, where the row does not allow that class: add it to a patched tree (the real loader,
 * see `loadPatchedDb`), replay every slot of the genus, and report what it gains on the species' own
 * bodies against what it costs — other species' slots it now appears in, siblings that lose theirs,
 * and the genus' mean slot size. Nothing in `data/species` changes; the table is for the owner.
 *
 * Output: stdout and `docs/precision/class-sweep.md` (local only).
 */
import path from "node:path";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { createReplay, loadPatchedDb, loadTruthByBody, precisionDir, root, runMatcher, type Prepared } from "./precisionReplay.js";
import type { SpeciesDatabase } from "../src/shared/types.js";

const argv = process.argv.slice(2);
const argNum = (n: string, d: number) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? Number(argv[i + 1]) : d;
};
const MIN_BODIES = argNum("min-bodies", 5);
const MIN_SHARE = argNum("min-share", 0.05);

/** Journal planet class → the token the species files write in `planet_types`. */
const TOKEN: Record<string, string> = {
  "High metal content body": "High Metal Content",
  "Rocky body": "Rocky",
  "Icy body": "Icy",
  "Rocky ice body": "Rocky Ice",
  "Metal rich body": "Metal Rich",
};

/** Each species' raw `conditions.planet_types`, as written — the patch extends exactly that. */
const rawPlanetTypes = new Map<string, string[] | null>();
{
  const dir = path.join(root, "data", "species");
  for (const genus of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const files = readdirSync(path.join(dir, genus.name)).filter((f) => f.endsWith(".json"));
    const file = files.find((f) => f.endsWith("_new.json")) ?? files[0];
    if (!file) continue;
    const doc = JSON.parse(readFileSync(path.join(dir, genus.name, file), "utf8")) as {
      species?: { id: string; conditions?: { planet_types?: unknown } }[];
    };
    for (const s of doc.species ?? []) {
      const pt = s.conditions?.planet_types;
      rawPlanetTypes.set(s.id, Array.isArray(pt) ? pt.map(String) : null);
    }
  }
}

const base = loadSpeciesDatabaseFromTree(root);
const byId = new Map(base.species.map((e) => [e.id, e]));
const truthByBody = await loadTruthByBody();
const { prepare } = await createReplay(base);

/* ------------------------------------------------------------------ one pass: every slot, base tree */

interface Slot {
  truth: string;
  genus: string;
  planetClass: string;
  p: Prepared;
  shownBase: Set<string>; // species of this genus shown
}
const slots: Slot[] = [];
for (const [key, rows] of truthByBody) {
  const p = prepare(key, rows);
  if (!p) continue;
  const shown = new Set(runMatcher(base, p, true).filter((m) => !m.unlikely).map((m) => m.entry.id));
  for (const r of rows) {
    const e = byId.get(r.species);
    if (!e) continue;
    slots.push({
      truth: r.species,
      genus: e.genusDataDir,
      planetClass: p.scan.PlanetClass ?? "?",
      p,
      shownBase: new Set([...shown].filter((id) => byId.get(id)?.genusDataDir === e.genusDataDir)),
    });
  }
}
process.stderr.write(`${slots.length} slots replayed on the base tree\n`);

/* ------------------------------------------------------------------ candidates */

interface Candidate {
  species: string;
  planetClass: string;
  bodies: number;
  of: number;
  shownNow: number;
}
const candidates: Candidate[] = [];
const bySpecies = new Map<string, Slot[]>();
for (const s of slots) bySpecies.set(s.truth, [...(bySpecies.get(s.truth) ?? []), s]);
for (const [id, own] of bySpecies) {
  const allowed = byId.get(id)?.criteria.planetClassAnyOf ?? [];
  const byClass = new Map<string, Slot[]>();
  for (const s of own) byClass.set(s.planetClass, [...(byClass.get(s.planetClass) ?? []), s]);
  for (const [cls, list] of byClass) {
    if (allowed.includes(cls) || !TOKEN[cls]) continue;
    if (list.length < MIN_BODIES || list.length / own.length < MIN_SHARE) continue;
    candidates.push({ species: id, planetClass: cls, bodies: list.length, of: own.length, shownNow: list.filter((s) => s.shownBase.has(id)).length });
  }
}
candidates.sort((a, b) => b.bodies - a.bodies);
process.stderr.write(`${candidates.length} candidates\n`);

/* ------------------------------------------------------------------ price each one */

interface Priced extends Candidate {
  gained: number;
  joined: number;
  otherSlots: number;
  siblingsLost: number;
  sizeBefore: number;
  sizeAfter: number;
  whose: string;
  note?: string;
}
const priced: Priced[] = [];
for (const c of candidates) {
  const raw = rawPlanetTypes.get(c.species);
  if (!raw) {
    priced.push({ ...c, gained: 0, joined: 0, otherSlots: 0, siblingsLost: 0, sizeBefore: 0, sizeAfter: 0, whose: "", note: "row has no planet_types list to extend" });
    continue;
  }
  const patched: SpeciesDatabase = loadPatchedDb({ [c.species]: { planet_types: [...raw, TOKEN[c.planetClass]!] } });
  const genus = byId.get(c.species)!.genusDataDir;
  const genusSlots = slots.filter((s) => s.genus === genus);
  let gained = 0;
  let joined = 0;
  let siblingsLost = 0;
  let before = 0;
  let after = 0;
  const whose = new Map<string, number>();
  const cache = new Map<Prepared, Set<string>>();
  for (const s of genusSlots) {
    let shownAfter = cache.get(s.p);
    if (!shownAfter) {
      shownAfter = new Set(runMatcher(patched, s.p, true).filter((m) => !m.unlikely && m.entry.genusDataDir === genus).map((m) => m.entry.id));
      cache.set(s.p, shownAfter);
    }
    before += s.shownBase.size;
    after += shownAfter.size;
    if (s.truth === c.species) {
      if (!s.shownBase.has(c.species) && shownAfter.has(c.species)) gained += 1;
    } else {
      if (!s.shownBase.has(c.species) && shownAfter.has(c.species)) {
        joined += 1;
        whose.set(s.truth, (whose.get(s.truth) ?? 0) + 1);
      }
      if (s.shownBase.has(s.truth) && !shownAfter.has(s.truth)) siblingsLost += 1;
    }
  }
  const otherSlots = genusSlots.filter((s) => s.truth !== c.species).length;
  priced.push({
    ...c,
    gained,
    joined,
    otherSlots,
    siblingsLost,
    sizeBefore: before / genusSlots.length,
    sizeAfter: after / genusSlots.length,
    whose: [...whose].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k.split("_").pop()} ${n}`).join(", "),
  });
  process.stderr.write(`  ${c.species} + ${c.planetClass}: +${gained} own, ${joined} others\n`);
}

/* ------------------------------------------------------------------ the table */

const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : "—");
const out: string[] = [
  `# Planet-class sweep`,
  ``,
  `Generated ${new Date().toISOString()} by \`scripts/precision-class-sweep.ts\`. Local only.`,
  ``,
  `Every planet class holding at least ${MIN_BODIES} of a species' truth bodies and ${(MIN_SHARE * 100).toFixed(0)} % of them, that the species' row does not allow — added in a patched tree and the whole genus replayed.`,
  ``,
  `*Gain per wrong slot* is own bodies newly shown for each other species' slot it newly joins: above 1 the change adds more truth than noise.`,
  ``,
  `| species | class | its bodies there | shown now | + own shown | joins others' slots | siblings lost | genus mean size | gain per wrong slot |`,
  `|---|---|---:|---:|---:|---:|---:|---:|---:|`,
];
for (const p of priced) {
  if (p.note) {
    out.push(`| ${p.species} | ${p.planetClass} | ${p.bodies} of ${p.of} | ${p.shownNow} | — | — | — | — | ${p.note} |`);
    continue;
  }
  const ratio = p.joined ? (p.gained / p.joined).toFixed(2) : p.gained ? "∞" : "—";
  out.push(
    `| ${p.species} | ${p.planetClass} | ${p.bodies} of ${p.of} (${pc(p.bodies, p.of)}) | ${p.shownNow} | **+${p.gained}** | ${p.joined} of ${p.otherSlots}${p.whose ? ` (${p.whose})` : ""} | ${p.siblingsLost} | ${p.sizeBefore.toFixed(3)} → ${p.sizeAfter.toFixed(3)} | ${ratio} |`,
  );
}
writeFileSync(path.join(precisionDir, "class-sweep.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
