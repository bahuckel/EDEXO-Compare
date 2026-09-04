import type { OrganicGenusLock, SpeciesDatabase, SpeciesEntry } from "../shared/types.js";
import { filterByGenusHints } from "./genusMatchUtils.js";

function normOrganicLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function speciesMatchesOrganicLabels(entry: SpeciesEntry, lock: OrganicGenusLock): boolean {
  const nd = normOrganicLabel(entry.displayName);
  const labels = [lock.variantLocalised, lock.speciesLocalised].filter((s): s is string => !!s?.trim());
  for (const lab of labels) {
    const nl = normOrganicLabel(lab);
    if (!nl) continue;
    if (nd === nl) return true;
    if (nd.includes(nl) || nl.includes(nd)) return true;
  }
  return false;
}

function resolveLockToSpeciesId(
  lock: OrganicGenusLock,
  genusDataDir: string,
  db: SpeciesDatabase,
): string | null {
  const cands = db.species.filter((s) => s.genusDataDir === genusDataDir);
  const hits = cands.filter((e) => speciesMatchesOrganicLabels(e, lock));
  if (hits.length === 1) return hits[0]!.id;
  return null;
}

/** Species entry ids unambiguously confirmed by on-foot ScanOrganic locks (genus + species/variant labels). */
export function collectResolvedOrganicLockSpeciesIds(
  locks: OrganicGenusLock[] | null | undefined,
  db: SpeciesDatabase,
): string[] {
  if (!locks?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const lock of locks) {
    const loc = lock.genusLocalised?.trim() || "";
    const sym = lock.genusSymbol?.trim() || "";
    const hint = { Genus_Localised: loc || sym, Genus: sym || loc };
    if (!hint.Genus_Localised) continue;

    const narrowedByLock = filterByGenusHints(db.species, [hint]);
    const dirs = new Set(narrowedByLock.map((s) => s.genusDataDir));
    if (dirs.size !== 1) continue;
    const dir = [...dirs][0]!;
    const sid = resolveLockToSpeciesId(lock, dir, db);
    if (sid && !seen.has(sid)) {
      seen.add(sid);
      out.push(sid);
    }
  }
  return out;
}

/**
 * After DSS genus filters: each planet allows at most one species per genus.
 * ScanOrganic confirms which species that is for a given genus — drop other rows in that genus folder.
 */
export function applyOrganicGenusLocks(
  entries: SpeciesEntry[],
  locks: OrganicGenusLock[] | null | undefined,
  db: SpeciesDatabase,
): SpeciesEntry[] {
  if (!locks?.length) return entries;

  /** genusDataDir → confirmed species id */
  const resolved = new Map<string, string>();

  for (const lock of locks) {
    const loc = lock.genusLocalised?.trim() || "";
    const sym = lock.genusSymbol?.trim() || "";
    const hint = { Genus_Localised: loc || sym, Genus: sym || loc };
    if (!hint.Genus_Localised) continue;

    const narrowedByLock = filterByGenusHints(db.species, [hint]);
    const dirs = new Set(narrowedByLock.map((s) => s.genusDataDir));
    if (dirs.size !== 1) continue;
    const dir = [...dirs][0]!;
    const sid = resolveLockToSpeciesId(lock, dir, db);
    if (sid) resolved.set(dir, sid);
  }

  if (resolved.size === 0) return entries;

  return entries.filter((e) => {
    const sid = resolved.get(e.genusDataDir);
    if (sid === undefined) return true;
    return e.id === sid;
  });
}

/**
 * True when an on-foot ScanOrganic lock unambiguously maps to a genus folder other than `bacterium`.
 * Used to drop bacterium candidates when DSS did not list bacterium but a sample confirmed another genus.
 */
export function organicScanConfirmsNonBacteriumGenus(
  locks: OrganicGenusLock[] | null | undefined,
  db: SpeciesDatabase,
): boolean {
  if (!locks?.length) return false;

  for (const lock of locks) {
    const loc = lock.genusLocalised?.trim() || "";
    const sym = lock.genusSymbol?.trim() || "";
    const hint = { Genus_Localised: loc || sym, Genus: sym || loc };
    if (!hint.Genus_Localised) continue;

    const narrowedByLock = filterByGenusHints(db.species, [hint]);
    const dirs = new Set(narrowedByLock.map((s) => s.genusDataDir));
    if (dirs.size !== 1) continue;
    const dir = [...dirs][0]!;
    const sid = resolveLockToSpeciesId(lock, dir, db);
    if (sid && dir.trim().toLowerCase() !== "bacterium") return true;
  }
  return false;
}
