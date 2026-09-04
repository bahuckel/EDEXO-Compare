import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { SpeciesEntry } from "../shared/types.js";
import { findGenusPhotosFolder } from "./speciesTreeLoader.js";
import { getSpeciesDataDir } from "./paths.js";

/** Single-segment URL file param uses encodeURIComponent; route uses basename only. */
export const BUILTIN_PLACEHOLDER_FILE = "__builtin_placeholder.svg";

export interface ResolvedPhoto {
  photoUrl: string;
  photoNote: string | null;
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
    if (speciesCompact.length > 2)
      push(`${dirU}_${speciesCompact}`);
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

function bestFuzzyPhoto(
  files: string[],
  entry: SpeciesEntry,
): { name: string; note: string } | null {
  const target = normStem(entry.displayName.replace(/\s*\([^)]*\)\s*/g, "").trim());
  const targetSpecies =
    normStem(entry.displayName.replace(/\s*\([^)]*\)\s*/g, "").replace(new RegExp(`^${escapeRe(entry.genus.trim())}`, "i"), "").trim()) ||
    target;

  let best: { name: string; score: number } | null = null;
  for (const f of files) {
    const n = normStem(f);
    if (!n) continue;
    let score = 0;
    if (n === target || n === targetSpecies) score = 1000;
    else if (target.length > 4 && (n.includes(target) || target.includes(n))) score = 500;
    else if (targetSpecies.length > 4 && (n.includes(targetSpecies) || targetSpecies.includes(n))) score = 400;
    else {
      const dirP = normStem(entry.genusDataDir);
      if (dirP.length > 3 && n.startsWith(dirP) && targetSpecies.length > 3 && n.includes(targetSpecies)) score = 350;
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

  const builtin: ResolvedPhoto = {
    photoUrl: `/photos/${BUILTIN_PLACEHOLDER_FILE}`,
    photoNote: `No image found in data/species/${entry.genusDataDir}/ — expected a folder like ${entry.genusDataDir}_photos next to your genus .json.`,
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

  const cands = candidateFilenames(entry);
  for (const name of cands) {
    const abs = join(photosDir, basename(name));
    if (!existsSync(abs)) continue;
    const wanted = entry.photoFile ? basename(entry.photoFile) : null;
    const note =
      wanted && basename(name) !== wanted
        ? `Species file “${wanted}” was not found — showing “${basename(name)}” from ${entry.genusDataDir}_photos.`
        : null;
    return { photoUrl: speciesPhotoBaseUrl(entry.genusDataDir, basename(name)), photoNote: note };
  }

  const fuzzy = bestFuzzyPhoto(imageFiles, entry);
  if (fuzzy) {
    return {
      photoUrl: speciesPhotoBaseUrl(entry.genusDataDir, fuzzy.name),
      photoNote: fuzzy.note,
    };
  }

  const fallback = imageFiles[0];
  if (fallback) {
    return {
      photoUrl: speciesPhotoBaseUrl(entry.genusDataDir, fallback),
      photoNote: `Species image not specified or missing — showing sample file “${fallback}” from ${entry.genusDataDir}_photos.`,
    };
  }

  return builtin;
}
