/**
 * Import the owner's own exobiology photographs into the species tree.
 *
 *   npx tsx scripts/import-my-photos.ts ["C:\\path\\to\\Images"]
 *
 * ## What it expects
 *
 * One folder per genus, and files named `Genus Species - Colour.jpg`:
 *
 *   Images/Bacterium/Bacterium Vesicula - Lime.jpg
 *   Images/Stratum/Stratum Tectonicas - Green.jpg
 *
 * Spacing around the dash is not load-bearing — `Bacterium Cerbrus- Green.jpg` reads the same — and
 * the extension may be jpg, jpeg, png or webp.
 *
 * ## Why a script rather than a one-off copy
 *
 * The batches keep coming. Doing it by hand means re-deciding the on-disk name every time, and the
 * name is the whole interface: `speciesPhotos.ts` finds a photograph by matching filename stems, so
 * a file named freehand is a file the app cannot see. This settles the convention once:
 *
 *   <Genus>-<species>-<Colour>.<ext>      Bacterium-vesicula-Lime.jpg
 *
 * which is the existing `Bacterium-vesicula.png` convention with the variant appended, so the
 * species still resolves and the colour is available to pick between variants.
 *
 * ## Two things it refuses to do
 *
 * It will not import a species the database does not have, and it will not import a colour the
 * species' own table cannot produce. Both are silent failures otherwise — a photograph in the tree
 * that nothing ever shows — and both usually mean a typo in a filename rather than a discovery.
 *
 * ## Credit
 *
 * Every file it copies is recorded in `data/species/photo-credits.json` against the commander who
 * took it. The photographs already in the tree are ED-DSN's and stay credited to ED-DSN; these are
 * not, and attributing them to the wrong people would be the one mistake this whole area of the
 * project has been careful about.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getProjectRoot, getSpeciesDataDir } from "../src/server/paths.js";
import { loadSpeciesDatabaseFromTree, findGenusPhotosFolder } from "../src/server/speciesTreeLoader.js";
import { colourVariantRuleFor } from "../src/server/eddsnColourVariants.js";
import type { SpeciesEntry } from "../src/shared/types.js";

const DEFAULT_SOURCE = "C:\\Users\\FeraL\\Desktop\\My ED Discoveries\\Images";

/** Who took these. One entry per contributor; the manifest keys files to it. */
const CREDIT_ID = "falrenica";

interface CreditsFile {
  formatVersion: number;
  note: string;
  contributors: Record<string, { name: string; url?: string; licence: string }>;
  /** Photo filename → contributor id. Anything absent is ED-DSN's, which is the default. */
  byFile: Record<string, string>;
}

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

function parseName(file: string): { species: string; colour: string; ext: string } | null {
  const m = /^(.*?)\s*-\s*([A-Za-z][A-Za-z ]*?)\s*\.(jpe?g|png|webp)$/i.exec(file);
  if (!m) return null;
  return { species: m[1]!.trim(), colour: m[2]!.trim(), ext: m[3]!.toLowerCase() };
}

/** Every colour this species can actually be, from its own table. Empty when it has none. */
function coloursFor(root: string, entry: SpeciesEntry): Set<string> {
  const rule = colourVariantRuleFor(root, entry.genusDataDir, entry.displayName);
  return new Set(Object.values(rule?.map ?? {}).map((c) => c.trim().toLowerCase()));
}

function loadCredits(file: string): CreditsFile {
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as CreditsFile;
      if (parsed?.byFile) return parsed;
    } catch {
      /* fall through to a fresh one rather than lose the import over a bad byte */
    }
  }
  return {
    formatVersion: 1,
    note:
      "Photographs not listed here came with the project from the ED-DSN community and are credited to ED-DSN. Anything listed was contributed by the commander named against it.",
    contributors: {},
    byFile: {},
  };
}

function main(): void {
  const source = process.argv[2]?.trim() || DEFAULT_SOURCE;
  const root = getProjectRoot();
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    console.error(`No such folder: ${source}`);
    process.exitCode = 1;
    return;
  }

  const db = loadSpeciesDatabaseFromTree(root);
  const bySpecies = new Map(db.species.map((e) => [e.displayName.trim().toLowerCase(), e]));
  const creditsPath = path.join(getSpeciesDataDir(root), "photo-credits.json");
  const credits = loadCredits(creditsPath);
  credits.contributors[CREDIT_ID] = {
    name: "Bahuckel — CMDR FALrenica",
    licence: "Photographed by the project owner and contributed to this project.",
  };

  let copied = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const genusFolder of readdirSync(source)) {
    const dir = path.join(source, genusFolder);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!IMAGE_RE.test(file)) continue;
      const parsed = parseName(file);
      if (!parsed) {
        problems.push(`${genusFolder}/${file} — cannot read "Genus Species - Colour.ext" from the name`);
        continue;
      }
      const entry = bySpecies.get(parsed.species.toLowerCase());
      if (!entry) {
        problems.push(`${genusFolder}/${file} — no species called "${parsed.species}"`);
        continue;
      }
      const allowed = coloursFor(root, entry);
      if (allowed.size > 0 && !allowed.has(parsed.colour.toLowerCase())) {
        problems.push(
          `${genusFolder}/${file} — "${parsed.colour}" is not a colour ${entry.displayName} can be (${[...allowed].sort().join(", ")})`,
        );
        continue;
      }

      const genusPath = path.join(getSpeciesDataDir(root), entry.genusDataDir);
      const photosDir = findGenusPhotosFolder(genusPath, entry.genusDataDir);
      if (!photosDir) {
        problems.push(`${genusFolder}/${file} — no photos folder under data/species/${entry.genusDataDir}/`);
        continue;
      }
      mkdirSync(photosDir, { recursive: true });

      // <Genus>-<species>-<Colour>.<ext>, matching the tree's existing <Genus>-<species>.<ext>.
      const [genus, ...rest] = entry.displayName.trim().split(/\s+/);
      const speciesWord = rest.join("_") || genus!;
      const target = `${genus}-${speciesWord}-${parsed.colour.replace(/\s+/g, "_")}.${parsed.ext}`;
      const abs = path.join(photosDir, target);

      const src = path.join(dir, file);
      if (existsSync(abs) && statSync(abs).size === statSync(src).size) {
        skipped++;
      } else {
        copyFileSync(src, abs);
        copied++;
        console.log(`  ${entry.displayName.padEnd(24)} ${parsed.colour.padEnd(11)} -> ${entry.genusDataDir}/${target}`);
      }
      credits.byFile[target] = CREDIT_ID;
    }
  }

  writeFileSync(creditsPath, `${JSON.stringify(credits, null, 1)}\n`, "utf8");

  console.log(`\n${copied} copied, ${skipped} already present, ${problems.length} not imported`);
  console.log(`credits: ${path.relative(root, creditsPath)} (${Object.keys(credits.byFile).length} files)`);
  for (const p of problems) console.log(`  ! ${p}`);
  if (copied > 0) console.log(`\nRun \`npm run images\` to build the card and thumbnail derivatives.`);
}

main();
