/**
 * Species precision: a set of proposed row changes, replayed together over every slot.
 *
 *   npx tsx scripts/precision-whatif.ts '{"frutexa_frutexa_metallicum":{"planet_types":["High Metal Content"]}, …}'
 *
 * The gate check prices one change on one genus. Changes that ship together can interact — two
 * gates that each look free can between them hide a body — so the set is loaded as one patched tree
 * (the real loader, `loadPatchedDb`) and the whole truth table replayed against it and against the
 * current tree. Reported the way phase 1 reports: truth shown, truth listed, slot sizes, and every
 * species whose own recall moves, in either direction.
 */
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { createReplay, loadPatchedDb, loadTruthByBody, root, runMatcher, type ConditionsPatch } from "./precisionReplay.js";
import type { SpeciesDatabase } from "../src/shared/types.js";

const patches = JSON.parse(process.argv[2] ?? "{}") as Record<string, ConditionsPatch>;
if (!Object.keys(patches).length) {
  console.error("usage: npx tsx scripts/precision-whatif.ts '<{speciesId: conditionsPatch}>'");
  process.exit(1);
}
const base = loadSpeciesDatabaseFromTree(root);
const patched = loadPatchedDb(patches);
const genusOf = new Map(base.species.map((e) => [e.id, e.genusDataDir]));
const truthByBody = await loadTruthByBody();
const { prepare } = await createReplay(base);

interface Tally {
  slots: number;
  shown: number;
  listed: number;
  sizes: number[];
  perSpecies: Map<string, { n: number; shown: number }>;
}
const empty = (): Tally => ({ slots: 0, shown: 0, listed: 0, sizes: [], perSpecies: new Map() });
const tallies: [Tally, Tally] = [empty(), empty()];

for (const [key, rows] of truthByBody) {
  const p = prepare(key, rows);
  if (!p) continue;
  ([base, patched] as SpeciesDatabase[]).forEach((db, i) => {
    const t = tallies[i]!;
    const matches = runMatcher(db, p, true);
    for (const r of rows) {
      const g = genusOf.get(r.species);
      if (!g) continue;
      const inGenus = matches.filter((m) => m.entry.genusDataDir === g);
      const shown = inGenus.filter((m) => !m.unlikely).map((m) => m.entry.id);
      t.slots += 1;
      if (shown.includes(r.species)) t.shown += 1;
      if (inGenus.some((m) => m.entry.id === r.species)) t.listed += 1;
      t.sizes.push(shown.length);
      const s = t.perSpecies.get(r.species) ?? { n: 0, shown: 0 };
      s.n += 1;
      if (shown.includes(r.species)) s.shown += 1;
      t.perSpecies.set(r.species, s);
    }
  });
}

const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(2)} %` : "—");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const share = (xs: number[], f: (n: number) => boolean) => pc(xs.filter(f).length, xs.length);
const line = (label: string, t: Tally) =>
  `| ${label} | ${t.slots} | ${pc(t.shown, t.slots)} | ${pc(t.listed, t.slots)} | ${mean(t.sizes).toFixed(3)} | ${share(t.sizes, (n) => n === 1)} | ${share(t.sizes, (n) => n <= 2)} |`;
console.log(`| tree | slots | truth shown | truth listed | mean size | size 1 | ≤ 2 |`);
console.log(`|---|---:|---:|---:|---:|---:|---:|`);
console.log(line("current", tallies[0]));
console.log(line("with the patches", tallies[1]));
console.log(`\nSpecies whose own recall moved:`);
for (const [id, a] of tallies[0].perSpecies) {
  const b = tallies[1].perSpecies.get(id)!;
  if (a.shown !== b.shown) console.log(`  ${id}: ${pc(a.shown, a.n)} → ${pc(b.shown, b.n)} of ${a.n}`);
}
