import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { SpeciesEntry } from "../shared/types.js";
import { findGenusPhotosFolder } from "./speciesTreeLoader.js";
import { getSpeciesDataDir } from "./paths.js";
import { photoContributorFor, type PhotoContributor } from "./photoCredits.js";

/** Single-segment URL file param uses encodeURIComponent; route uses basename only. */
export { BUILTIN_PLACEHOLDER_FILE } from "../shared/photoPlaceholder.js";
import { BUILTIN_PLACEHOLDER_FILE } from "../shared/photoPlaceholder.js";

export interface ResolvedPhoto {
  /** The photo to show when there is only room for one. Always present. */
  photoUrl: string;
  photoNote: string | null;
  /**
   * Every photo found for this species, `photoUrl` first.
   *
   * A species can have more than one picture — the same organism on a different world, at a
   * different time of day, by a different commander — and the ED-DSN expedition will produce exactly
   * that. A single image was never a property of the data, only of this resolver throwing away
   * everything it did not pick.
   *
   * Length 1 for a species with one photo, so a caller can always read this and ignore
   * {@link photoUrl}; both are kept because most callers want the one image and should not have to
   * index into an array to say so.
   */
  photoUrls: string[];
  /**
   * The colour-variant photographs, when there are any.
   *
   * The owner is photographing the variants themselves — `Bacterium-vesicula-Lime.jpg` beside
   * `Bacterium-vesicula-Red.jpg` — and the app now works out which variant a body will grow. The two
   * facts are worth nothing apart and everything together: the card can show the plant the commander
   * is actually going to find rather than one of its siblings.
   *
   * Empty for a species nobody has photographed by variant yet, which is most of them.
   */
  photoVariants: { url: string; colour: string }[];
  /**
   * Photographs that are **not** ED-DSN's, by URL.
   *
   * Only the exceptions travel: the shipped 97 are ED-DSN's and stay credited by the standing line,
   * so this carries the handful a commander contributed and nothing else. See `photoCredits.ts`.
   */
  photoCreditByUrl?: Record<string, PhotoContributor>;
}

/**
 * Colours a variant filename can carry.
 *
 * Elite's variant names are a closed set — the codex has never invented a new one — so this can be a
 * list rather than "any word after the species", which would happily read `Bacterium-vesicula-2` or
 * a stray suffix as a colour.
 */
const VARIANT_COLOURS = [
  "amethyst",
  "aquamarine",
  "blue",
  "cobalt",
  "cyan",
  "emerald",
  "gold",
  "green",
  "grey",
  "indigo",
  "lime",
  "magenta",
  "maroon",
  "mauve",
  "mulberry",
  "ocher",
  "orange",
  "peach",
  "red",
  "sage",
  "teal",
  "turquoise",
  "white",
  "yellow",
] as const;

/**
 * The colour a filename names for this species, or null when it names none.
 *
 * Compared on {@link normStem}, so `Bacterium-vesicula-Lime.jpg` and `bacterium vesicula lime.jpg`
 * are the same file as far as this is concerned and no new spelling rule has to be learned to add a
 * photograph: keep the species name, append the colour.
 */
function variantColourOf(file: string, speciesStem: string): string | null {
  const n = normStem(file);
  if (!speciesStem || !n.startsWith(speciesStem)) return null;
  const tail = n.slice(speciesStem.length);
  if (!tail) return null;
  const hit = VARIANT_COLOURS.find((c) => c === tail);
  return hit ? hit.charAt(0).toUpperCase() + hit.slice(1) : null;
}

function speciesPhotoBaseUrl(genusDataDir: string, filename: string): string {
  const safe = basename(filename);
  return `/species-photos/${encodeURIComponent(genusDataDir)}/${encodeURIComponent(safe)}`;
}

function displayStemForFiles(entry: SpeciesEntry): string {
  return entry.displayName
    .replace(/\s*\([^)]*\)\s*/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fold to compare filenames (e.g. brain_tree_gnarled / braintreegnarled). */
function normStem(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Stems to try for `genus-species.png` style assets: species-only, genus_species,
 * folder-style prefixes, compact forms.
 */
function collectFilenameStems(entry: SpeciesEntry): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (!t) return;
    const b = basename(t);
    if (!out.some((x) => x.toLowerCase() === b.toLowerCase())) out.push(b);
  };

  if (entry.photoFile) push(entry.photoFile.replace(/\.[a-z0-9]+$/i, ""));

  const base = displayStemForFiles(entry);
  push(base);
  push(base.toLowerCase());
  push(base.replace(/_/g, ""));
  push(base.toLowerCase().replace(/_/g, ""));

  const genus = entry.genus.trim();
  const withoutGenus = base.replace(new RegExp(`^${escapeRe(genus)}_?`, "i"), "").replace(/^_|_$/g, "");
  if (withoutGenus && withoutGenus !== base) {
    push(withoutGenus);
    push(withoutGenus.toLowerCase());
  }

  const dir = entry.genusDataDir;
  const dirU = dir.replace(/-/g, "_");
  const dirCompact = normStem(dir);
  const speciesCompact = normStem(withoutGenus || base);

  for (const stem of [...out]) {
    if (!stem) continue;
    const sLo = stem.toLowerCase();
    push(`${dirU}_${sLo}`);
    push(`${dirU}-${sLo}`);
    push(`${dir}_${sLo}`);
    if (speciesCompact.length > 2) push(`${dirU}_${speciesCompact}`);
    if (dirCompact.length > 2 && speciesCompact.length > 2) push(`${dirCompact}_${speciesCompact}`);
    if (dirCompact.length > 2 && speciesCompact.length > 2) push(`${dirCompact}${speciesCompact}`);
  }

  return out;
}

function candidateFilenames(entry: SpeciesEntry): string[] {
  const stems = collectFilenameStems(entry);
  const out: string[] = [];
  const push = (s: string) => {
    const b = basename(s);
    if (b && !out.some((x) => x.toLowerCase() === b.toLowerCase())) out.push(b);
  };
  for (const stem of stems) {
    const stemLo = stem.toLowerCase();
    for (const ext of ["png", "jpg", "jpeg", "webp", "gif", "svg"]) {
      push(`${stem}.${ext}`);
      push(`${stemLo}.${ext}`);
    }
  }
  return out;
}

/**
 * Extra photographs of the same species, by filename.
 *
 * The convention is the primary's name with a number after it — `Aleoida-arcus.png` alongside
 * `Aleoida-arcus-2.png`, `Aleoida-arcus_3.jpg`, `Aleoida-arcus (4).png`. Comparison is on
 * {@link normStem}, which already strips punctuation and case, so all three separators fall out for
 * free and no new spelling rule has to be learned to add a second picture: keep the name, add a
 * number.
 *
 * Deliberately *not* a similarity match. This runs after a species has been identified by exact
 * filename, and a loose rule here would quietly pull a sibling species into the gallery — the
 * Frutexa acus bug, but silent, because a gallery of the wrong plant still looks like a gallery.
 */
function numberedSiblings(files: string[], primary: string): string[] {
  const stem = normStem(primary);
  if (!stem) return [];
  const extras = files
    .filter((f) => f !== primary)
    .map((f) => ({ f, n: normStem(f) }))
    .filter((x) => x.n !== stem && x.n.startsWith(stem) && /^\d+$/.test(x.n.slice(stem.length)))
    .map((x) => ({ f: x.f, order: Number(x.n.slice(stem.length)) }))
    // Numerically, so 10 follows 9 rather than 1.
    .sort((a, b) => a.order - b.order || a.f.localeCompare(b.f));
  return extras.map((x) => x.f);
}

function bestFuzzyPhoto(files: string[], entry: SpeciesEntry): { name: string; note: string } | null {
  const target = normStem(entry.displayName.replace(/\s*\([^)]*\)\s*/g, "").trim());
  const targetSpecies =
    normStem(
      entry.displayName
        .replace(/\s*\([^)]*\)\s*/g, "")
        .replace(new RegExp(`^${escapeRe(entry.genus.trim())}`, "i"), "")
        .trim(),
    ) || target;

  let best: { name: string; score: number } | null = null;
  for (const f of files) {
    const n = normStem(f);
    if (!n) continue;
    let score = 0;
    if (n === target || n === targetSpecies) score = 1000;
    else if (target.length > 4 && (n.includes(target) || target.includes(n))) score = 500;
    else if (targetSpecies.length > 4 && (n.includes(targetSpecies) || targetSpecies.includes(n)))
      score = 400;
    else {
      const dirP = normStem(entry.genusDataDir);
      if (dirP.length > 3 && n.startsWith(dirP) && targetSpecies.length > 3 && n.includes(targetSpecies))
        score = 350;
    }
    if (score > 0 && (!best || score > best.score)) best = { name: f, score };
  }
  if (!best || best.score < 350) return null;
  return {
    name: best.name,
    note: `Matched image “${best.name}” to species by normalized name (no exact filename hit).`,
  };
}

/**
 * One return shape for every path out of the resolver.
 *
 * Four of them built the same object by hand and three had already drifted apart on which fields
 * they bothered with. The credit lookup in particular must not be optional per path: a contributed
 * photograph shown down the fallback route would carry ED-DSN's name.
 */
function withCredits(
  entry: SpeciesEntry,
  projectRoot: string,
  primary: string,
  note: string | null,
  files: string[],
  variantFiles: string[],
): ResolvedPhoto {
  const seen = new Set<string>();
  const ordered = files.filter((f) => f && !seen.has(f.toLowerCase()) && seen.add(f.toLowerCase()));
  const url = (f: string) => speciesPhotoBaseUrl(entry.genusDataDir, f);
  const speciesStem = normStem(displayStemForFiles(entry));

  const photoCreditByUrl: Record<string, PhotoContributor> = {};
  for (const f of ordered) {
    const who = photoContributorFor(projectRoot, f);
    if (who) photoCreditByUrl[url(f)] = who;
  }

  return {
    photoUrl: url(primary),
    photoNote: note,
    photoUrls: ordered.map(url),
    photoVariants: variantFiles
      .map((f) => ({ url: url(f), colour: variantColourOf(f, speciesStem) }))
      .filter((v): v is { url: string; colour: string } => v.colour !== null),
    ...(Object.keys(photoCreditByUrl).length ? { photoCreditByUrl } : {}),
  };
}

/**
 * Resolved photos, keyed by genus folder + species id. Resolution walks the photo directory and
 * stats candidate filenames; it ran for every match, on every body, on every snapshot push
 * (10x/sec while scanning). The layout is static for a run — the species-tree watcher clears this.
 */
const resolvedPhotoCache = new Map<string, ResolvedPhoto>();

export function clearSpeciesPhotoCache(): void {
  resolvedPhotoCache.clear();
}

/**
 * Resolve image under `data/species/<genusDataDir>/<genusDataDir>_photos/` (your layout).
 */
export function resolveSpeciesPhoto(entry: SpeciesEntry, projectRoot: string): ResolvedPhoto {
  const cacheKey = `${projectRoot}::${entry.genusDataDir}::${entry.id}`;
  const cached = resolvedPhotoCache.get(cacheKey);
  if (cached) return cached;
  const resolved = resolveSpeciesPhotoUncached(entry, projectRoot);
  resolvedPhotoCache.set(cacheKey, resolved);
  return resolved;
}

function resolveSpeciesPhotoUncached(entry: SpeciesEntry, projectRoot: string): ResolvedPhoto {
  const genusPath = join(getSpeciesDataDir(projectRoot), entry.genusDataDir);
  const photosDir = findGenusPhotosFolder(genusPath, entry.genusDataDir);

  const placeholderUrl = `/photos/${BUILTIN_PLACEHOLDER_FILE}`;
  const builtin: ResolvedPhoto = {
    photoUrl: placeholderUrl,
    photoNote: `No image found in data/species/${entry.genusDataDir}/ — expected a folder like ${entry.genusDataDir}_photos next to your genus .json.`,
    photoUrls: [placeholderUrl],
    photoVariants: [],
  };

  if (!photosDir || !existsSync(photosDir)) {
    return builtin;
  }

  let imageFiles: string[] = [];
  try {
    imageFiles = readdirSync(photosDir).filter((n) => /\.(png|jpe?g|webp|gif|svg)$/i.test(n));
  } catch {
    imageFiles = [];
  }

  /*
   * The variants, found before anything else because every return path below wants them.
   *
   * A species with no ED-DSN photograph but one of the owner's own would otherwise fall through to
   * the fuzzy matcher and then to "here is some file from this genus", which is how you end up
   * showing a commander a picture of a different plant.
   */
  const speciesStem = normStem(displayStemForFiles(entry));
  const variantFiles = imageFiles
    .map((f) => ({ f, colour: variantColourOf(f, speciesStem) }))
    .filter((x): x is { f: string; colour: string } => x.colour !== null)
    .sort((a, b) => a.colour.localeCompare(b.colour))
    .map((x) => x.f);

  /*
   * A photograph the commander took of this species retires ED-DSN's of the same species.
   *
   * His words: *"remove ED-DSN photos for every Genus+Species I have photographed"*. He walked to
   * the plant, stood in front of it and photographed it; showing somebody else's picture of the
   * same species beside his is at best redundant and at worst wrong, since the two may be different
   * colour variants of it.
   *
   * Decided by the credits manifest rather than by the filename, because the manifest is what
   * actually knows who took a picture — a naming convention is a proxy for that and would quietly
   * retire an ED-DSN photograph that happened to be named like a variant.
   *
   * Only that species. A genus he has photographed once keeps ED-DSN's pictures of its other
   * species, which is the whole point of them still being here.
   */
  const ownFiles = variantFiles.filter((f) => photoContributorFor(projectRoot, f) !== null);
  if (ownFiles.length > 0) {
    return withCredits(entry, projectRoot, ownFiles[0]!, null, ownFiles, ownFiles);
  }

  /*
   * A variant is a better primary than a guess.
   *
   * When the tree has no photograph under the species' own name, one that names the species *and* a
   * colour still shows the right organism — and it is the owner's own, taken on a body he walked.
   */
  if (variantFiles.length > 0 && !candidateFilenames(entry).some((c) => imageFiles.some((f) => f.toLowerCase() === basename(c).toLowerCase()))) {
    return withCredits(entry, projectRoot, variantFiles[0]!, null, variantFiles, variantFiles);
  }

  const cands = candidateFilenames(entry);
  for (const name of cands) {
    const abs = join(photosDir, basename(name));
    if (!existsSync(abs)) continue;
    /*
     * Use the name the directory actually has, not the candidate that matched it.
     *
     * `existsSync` is case-insensitive on Windows and on macOS's default volume, so the candidate
     * `aleoida-arcus.png` "exists" when the file is really `Aleoida-arcus.png` — and the URL built
     * from the candidate then 404s on any case-sensitive filesystem, which is where this is served
     * from in a Linux container. It has always been latent; it surfaces here because the gallery
     * compares the primary against the directory listing to find its siblings.
     */
    const primary = imageFiles.find((f) => f.toLowerCase() === basename(name).toLowerCase()) ?? basename(name);
    const wanted = entry.photoFile ? basename(entry.photoFile) : null;
    const note =
      wanted && primary !== wanted
        ? `Species file “${wanted}” was not found — showing “${primary}” from ${entry.genusDataDir}_photos.`
        : null;
    const all = [primary, ...numberedSiblings(imageFiles, primary), ...variantFiles];
    return withCredits(entry, projectRoot, primary, note, all, variantFiles);
  }

  const fuzzy = bestFuzzyPhoto(imageFiles, entry);
  if (fuzzy) {
    // No siblings collected here on purpose: the species was matched by similarity rather than by
    // name, so a numbered neighbour of *that* file is not evidence of anything about this species.
    return withCredits(entry, projectRoot, fuzzy.name, fuzzy.note, [fuzzy.name, ...variantFiles], variantFiles);
  }

  const fallback = imageFiles[0];
  if (fallback) {
    return withCredits(
      entry,
      projectRoot,
      fallback,
      `Species image not specified or missing — showing sample file “${fallback}” from ${entry.genusDataDir}_photos.`,
      [fallback, ...variantFiles],
      variantFiles,
    );
  }

  return builtin;
}
