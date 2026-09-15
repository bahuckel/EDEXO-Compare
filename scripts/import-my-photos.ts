/**
 * Import the owner's own exobiology photographs into the species tree.
 *
 *   npx tsx scripts/import-my-photos.ts "<path to Images>"
 *
 * The folder can also come from `EDEXO_PHOTO_SOURCE`. There is no built-in default: this
 * repository is public, and a path under somebody's home directory is not something to publish.
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
 * ## Credit, and how a second photographer says so
 *
 * Every file it copies is recorded in `data/species/photo-credits.json` against the commander who
 * took it. The photographs already in the tree are ED-DSN's and stay credited to ED-DSN; these are
 * not, and attributing them to the wrong people would be the one mistake this whole area of the
 * project has been careful about.
 *
 * Photographs are the owner's unless a folder says otherwise. A folder named **`By CMDR <name>`**
 * hands everything beneath it to that commander:
 *
 *   Images/Stratum/Stratum Tectonicas - Green.jpg          -> CMDR FALrenica
 *   Images/By CMDR PhoEniXDFA/Aleoida Spica - Emerald.jpg  -> CMDR PhoEniXDFA
 *   Images/By CMDR PhoEniXDFA/Osseus/Osseus Discus - Red.jpg  -> CMDR PhoEniXDFA
 *
 * The walk is recursive for exactly that reason: a contributor may hand over a flat folder or one
 * sorted by genus, and which of those they chose should not decide whether their name survives.
 * The nearest `By CMDR` ancestor wins, so a contributor folder can sit anywhere in the tree.
 *
 * The credit reads `Bahuckel — CMDR <name>`, because the contributors so far are all of the owner's
 * clan and that is how he asked for them to be named. Somebody outside it would need a line here
 * rather than a folder rename — which is the right amount of friction for a claim about authorship.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getProjectRoot, getSpeciesDataDir } from "../src/server/paths.js";
import { loadSpeciesDatabaseFromTree, findGenusPhotosFolder } from "../src/server/speciesTreeLoader.js";
import { colourVariantRuleFor } from "../src/server/eddsnColourVariants.js";
import type { SpeciesEntry } from "../src/shared/types.js";

/**
 * Where the photographs are, if the command line does not say.
 *
 * An environment variable rather than a path baked into the file: this repository is public,
 * and a hard-coded path under somebody's home directory publishes whose machine it is and how
 * their desktop is arranged. Nothing about the import needs that to be committed.
 */
const DEFAULT_SOURCE = process.env.EDEXO_PHOTO_SOURCE?.trim() ?? "";

/** Whose photographs these are unless a `By CMDR …` folder says otherwise. */
const OWNER_ID = "falrenica";

/** A folder that reassigns everything beneath it to somebody else. */
const BY_CMDR_RE = /^By\s+CMDR\s+(.+)$/i;

interface Contributor {
  id: string;
  name: string;
  licence: string;
}

const OWNER: Contributor = {
  id: OWNER_ID,
  name: "Bahuckel — CMDR FALrenica",
  licence: "Photographed by the project owner and contributed to this project.",
};

/**
 * The commander a folder name names, or null when it names none.
 *
 * The id is the commander's own name lowercased, so the manifest reads as a list of people rather
 * than a list of slugs, and re-importing the same folder cannot create a second entry for the same
 * photographer under a different key.
 */
function contributorFromFolder(folder: string): Contributor | null {
  const m = BY_CMDR_RE.exec(folder.trim());
  if (!m) return null;
  const cmdr = m[1]!.trim();
  if (!cmdr) return null;
  return {
    id: cmdr.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    name: `Bahuckel — CMDR ${cmdr}`,
    licence: `Photographed by CMDR ${cmdr} and contributed to this project.`,
  };
}

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

/** `grey` -> `Grey`, `light green` -> `Light_Green`-ready words. */
function titleCaseColour(key: string): string {
  return key
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** "Gray" -> "grey" when, and only when, the species actually has that colour. */
function normaliseColourSpelling(colour: string, allowed: ReadonlySet<string>): string {
  const key = colour.trim().toLowerCase();
  if (allowed.has(key)) return key;
  const swapped = key.replace(/gray/g, "grey");
  return allowed.has(swapped) ? swapped : key;
}

function main(): void {
  const source = process.argv[2]?.trim() || DEFAULT_SOURCE;
  const root = getProjectRoot();
  if (!source) {
    console.error(
      [
        "Where are the photographs? Pass the folder:",
        '  npx tsx scripts/import-my-photos.ts "<path to Images>"',
        "or set EDEXO_PHOTO_SOURCE to it.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    console.error(`No such folder: ${source}`);
    process.exitCode = 1;
    return;
  }

  const db = loadSpeciesDatabaseFromTree(root);
  const bySpecies = new Map(db.species.map((e) => [e.displayName.trim().toLowerCase(), e]));
  const creditsPath = path.join(getSpeciesDataDir(root), "photo-credits.json");
  const credits = loadCredits(creditsPath);
  credits.contributors[OWNER.id] = { name: OWNER.name, licence: OWNER.licence };

  let copied = 0;
  let skipped = 0;
  const problems: string[] = [];
  const byContributor = new Map<string, number>();

  /**
   * Every image under the source folder, carrying whoever the tree says took it.
   *
   * Recursive, because a contributor may hand over a flat folder or one sorted by genus and which
   * of those they chose should not decide whether their name survives. The nearest `By CMDR …`
   * ancestor wins; without one the photographs are the owner's, which is what they have always been.
   */
  const files: { genusFolder: string; dir: string; file: string; by: Contributor }[] = [];
  const walk = (dir: string, rel: string, by: Contributor): void => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) {
        walk(abs, rel ? `${rel}/${name}` : name, contributorFromFolder(name) ?? by);
      } else if (IMAGE_RE.test(name)) {
        files.push({ genusFolder: rel || ".", dir, file: name, by });
      }
    }
  };
  walk(source, "", OWNER);

  {
    for (const { genusFolder, dir, file, by } of files) {
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
      /*
        The game's vocabulary is British and a keyboard is not.

        "Gray" and "Grey" are the same colour, and rejecting one of them sends a photograph back over
        a spelling. The species tables are the authority on which colours exist, so the alias only
        ever maps onto a colour the species already has -- it cannot invent one.
      */
      const colourKey = normaliseColourSpelling(parsed.colour, allowed);
      if (allowed.size > 0 && !allowed.has(colourKey)) {
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
      /*
        The file is named for the colour the *species table* uses, not the colour the filename used.

        The app finds a variant photograph by matching this stem against the colour it predicted, so
        a file saying "Gray" while the prediction says "Grey" is a photograph nothing can ever find.
      */
      const canonicalColour = titleCaseColour(colourKey);
      const target = `${genus}-${speciesWord}-${canonicalColour.replace(/\s+/g, "_")}.${parsed.ext}`;
      const abs = path.join(photosDir, target);

      const src = path.join(dir, file);
      if (existsSync(abs) && statSync(abs).size === statSync(src).size) {
        skipped++;
      } else {
        copyFileSync(src, abs);
        copied++;
        console.log(
          `  ${entry.displayName.padEnd(24)} ${parsed.colour.padEnd(11)} -> ${entry.genusDataDir}/${target}` +
            (by.id === OWNER.id ? "" : `  (${by.name})`),
        );
      }
      /*
        Written on every pass, not only on a copy. A photograph already in the tree still has to
        carry the right name — re-running the import after a contributor folder appears is how a
        file imported under the wrong credit gets the right one.
      */
      if (by.id !== OWNER.id) credits.contributors[by.id] = { name: by.name, licence: by.licence };
      credits.byFile[target] = by.id;
      byContributor.set(by.name, (byContributor.get(by.name) ?? 0) + 1);
    }
  }

  writeFileSync(creditsPath, `${JSON.stringify(credits, null, 1)}\n`, "utf8");

  console.log(`\n${copied} copied, ${skipped} already present, ${problems.length} not imported`);
  console.log(`credits: ${path.relative(root, creditsPath)} (${Object.keys(credits.byFile).length} files)`);
  for (const [name, n] of [...byContributor].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${name}`);
  }
  for (const p of problems) console.log(`  ! ${p}`);
  if (copied > 0) console.log(`\nRun \`npm run images\` to build the card and thumbnail derivatives.`);
}

main();
