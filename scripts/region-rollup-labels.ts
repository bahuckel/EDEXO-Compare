/**
 * Does the galaxy index call a species by the name the game calls it?
 *
 *   npx tsx scripts/region-rollup-labels.ts <capture.jsonl>
 *
 * `data/galaxy/bio-index.bin` — and therefore `data/exomastery/region-species.json`, the table the
 * region gate and the region prior both read — labels its species layer through a bridge built in
 * `scripts/build-bio-index.ts`:
 *
 *     $Codex_Ent_Tussocks_10_F_Name;  ->  Codex_Ent_Tussocks_10  ->  (Bioforge)  ->  our species id
 *
 * The middle step is somebody else's table, so a species number named wrongly there becomes a
 * column of the rollup labelled wrongly here, silently and everywhere.
 *
 * ## The test
 *
 * The capture and the index share systems. For each shared system this prints, per species the
 * index claims, which codex **token** was reported there — `CodexEntry` and `ScanOrganic` — with the
 * capture's name for it alongside. A correct label sits beside one token, consistently. A
 * mislabelled one sits beside somebody else's, in system after system.
 *
 * This is a co-occurrence count and not proof on its own: a system holding both species agrees with
 * both. The signal is the *asymmetry* — a column whose own name almost never appears beside it while
 * another name almost always does.
 *
 * ## The token is the evidence, the name is not
 *
 * **EDDN strips every `_Localised` field.** A capture's `name` is whatever the collector's own table
 * says the token is, never what the game said. The first run of this tool trusted those names, and
 * the collector numbered Tussocks one place off from `_06`; the result was a clean seven-cycle that
 * looked exactly like proof the *index* was mislabelled, and a relabel that would have demoted three
 * of the owner's own Tussock caputus finds. Read the token column, and check any token-to-name claim
 * against `Species_Localised` / `Name_Localised` in a real journal before acting on it.
 */
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { loadBioIndex } from "../src/server/bioIndex.js";

const capture = process.argv[2];
const genusFilter = process.argv[3] ?? null;
const MIN = Number(process.env.MIN ?? 5);
if (!capture) {
  console.error("usage: npx tsx scripts/region-rollup-labels.ts <capture.jsonl> [genus-prefix]");
  process.exit(1);
}

const idx = loadBioIndex();
if (!idx) throw new Error("no bio index — data/galaxy/bio-index.bin");

const bag = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");

/** speciesId of the index -> what the game named in the same system, counted. */
const beside = new Map<string, Map<string, number>>();
let shared = 0;
let missing = 0;

const rl = readline.createInterface({ input: fs.createReadStream(path.resolve(capture)) });
for await (const line of rl) {
  const o = JSON.parse(line) as Record<string, any>;
  if (o.kind === "system" || o.kind === "manifest") continue;
  /** `Tussock Caputus [Tussocks_10]` — the capture's name, then the token number it was given for. */
  const names = new Set<string>();
  const label = (name: unknown, token: unknown) => {
    if (!name) return;
    const stem = /^\$Codex_Ent_(.+?_\d{2})/.exec(String(token ?? ""))?.[1];
    names.add(stem ? `${name} [${stem}]` : String(name));
  };
  for (const c of o.signals?.codex ?? []) label(c.name, c.token);
  for (const s of o.signals?.organics ?? [])
    if (s.scanType === "Log" || s.scanType === "Sample") label(s.name, s.species);
  if (!names.size) continue;

  const row = idx.lookup(BigInt(o.systemId64));
  if (!row) {
    missing++;
    continue;
  }
  shared++;
  for (const id of row.species) {
    if (genusFilter && !id.startsWith(genusFilter)) continue;
    let m = beside.get(id);
    if (!m) beside.set(id, (m = new Map()));
    // Only names from the same genus: a system holding Bacterium aurasus says nothing about which
    // Tussock this column is, and aurasus is in half the galaxy.
    const genusWord = id.split("_")[1]!;
    for (const n of names)
      if (n.toLowerCase().startsWith(genusWord)) m.set(n, (m.get(n) ?? 0) + 1);
  }
}

console.log(`bodies whose system the index knows: ${shared}; system unknown to the index: ${missing}\n`);
console.log("index label                          own name beside it   most frequent name [token] beside it");
for (const [id, m] of [...beside].sort()) {
  const total = [...m.values()].reduce((a, b) => Math.max(a, b), 0);
  if (total < MIN) continue;
  const nameOnly = (n: string) => n.replace(/\s*\[[^\]]*\]$/, "");
  const ownName = id.split("_").slice(-2).join(" ");
  const own = [...m].filter(([n]) => bag(nameOnly(n)) === bag(ownName)).reduce((a, [, c]) => a + c, 0);
  const ranked = [...m].sort((a, b) => b[1] - a[1]);
  const [topName, topN] = ranked[0]!;
  const flag = bag(nameOnly(topName)) === bag(ownName) ? "" : "   <<< check the token against a journal";
  console.log(
    `${id.padEnd(36)} ${String(own).padStart(6)}               ${topName} ×${topN}${flag}`,
  );
}
