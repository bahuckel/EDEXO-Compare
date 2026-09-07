/**
 * Which species have a photograph, and which the app is falling back to a placeholder for.
 *
 * Written for the ED-DSN conversation: their owner offered to organise a photo operation and asked
 * what is actually needed, so this answers it from the species tree rather than from a folder
 * listing. Filenames cannot answer it — `resolveSpeciesPhoto` matches fuzzily, and a species with no
 * file of its own can still resolve to a sibling's image, which looks like coverage and is not.
 *
 * `--wanted` prints just the list to hand over, one species per line.
 */
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { resolveSpeciesPhoto } from "../src/server/speciesPhotos.js";
import { getProjectRoot } from "../src/server/paths.js";

const root = getProjectRoot();
const db = loadSpeciesDatabaseFromTree(root);
const wantedOnly = process.argv.includes("--wanted");

type Row = { genus: string; name: string; file: string; placeholder: boolean; fuzzy: boolean };
const rows: Row[] = db.species.map((e) => {
  const r = resolveSpeciesPhoto(e, root);
  const file = (r.photoUrl ?? "").split("/").pop() ?? "";
  return {
    genus: e.genus,
    name: e.displayName,
    file,
    placeholder: (r.photoNote ?? "").startsWith("No image found"),
    // A note means the resolver could not hit the filename exactly and matched by similarity — the
    // image may well be of a different species in the same genus.
    fuzzy: !!r.photoNote && !(r.photoNote ?? "").startsWith("No image found"),
  };
});

const missing = rows.filter((r) => r.placeholder);
const fuzzy = rows.filter((r) => r.fuzzy);

if (wantedOnly) {
  for (const r of [...missing, ...fuzzy].sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(r.name);
  }
} else {
  console.log(`species in the tree      ${rows.length}`);
  console.log(`  exact photo match      ${rows.length - missing.length - fuzzy.length}`);
  console.log(`  matched by similarity  ${fuzzy.length}   (may be the wrong species)`);
  console.log(`  no photo, placeholder  ${missing.length}`);
  console.log("");

  if (missing.length) {
    console.log("NO PHOTO:");
    for (const r of missing) console.log(`  ${r.genus.padEnd(18)} ${r.name}`);
    console.log("");
  }
  if (fuzzy.length) {
    console.log("MATCHED BY SIMILARITY — worth confirming these are the right species:");
    for (const r of fuzzy) console.log(`  ${r.genus.padEnd(18)} ${r.name.padEnd(32)} -> ${r.file}`);
    console.log("");
  }

  const byGenus = new Map<string, number>();
  for (const r of [...missing, ...fuzzy]) byGenus.set(r.genus, (byGenus.get(r.genus) ?? 0) + 1);
  if (byGenus.size) {
    console.log("wanted, by genus:");
    for (const [g, n] of [...byGenus].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${g}`);
    }
  }
}
