/**
 * Who says this species is here — answered at read time, from the two stores that actually hold it.
 *
 * The corpus and the commander's own scans are deliberately **not** merged. The corpus is the shipped
 * evidence base, built from Spansh exobiology exports and tracked in git; `data/foot_scanned.json` is
 * the commander's own record, gitignored, rebuilt from their journals on every launch. Joining them
 * on disk would put personal observations into a published model and make the model depend on how
 * one commander flies. Joining them here costs a map lookup and keeps both meanings intact.
 *
 * ## The two sides answer at different resolutions, and saying so is the point
 *
 * | source | what it can say | resolution |
 * |---|---|---|
 * | `foot_scanned.json` | you scanned this species, on this exact body | **body** — `(systemAddress, bodyId)` |
 * | `sector-systems.json` | somebody confirmed this species in this system | **system** — `id64` |
 *
 * The corpus ships as aggregates: profiles carry statistics, `sector-systems.json` carries per-system
 * taxon counts. Neither says which body in the system, because the per-body table is the feeder's and
 * the feeder is a build input, not something the app opens. So "confirmed in this system" is the
 * strongest honest claim the shipped data supports, and the UI must not round it up to "confirmed
 * here" — on a system with nine landable bodies that would be eight lies.
 *
 * The commander's own row has no such problem: the journal names the body, so it is exact.
 *
 * ## Why the join key is safe
 *
 * The journal's `SystemAddress` **is** the system id64 that `sector-systems.json` is keyed by — the
 * same identity `bodyId64 = systemId64 + (bodyId << 55)` was verified against earlier. No name
 * matching anywhere in this path, which is the bug class §23.4 cost 16 species rows to.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SectorSystemsFile } from "../shared/sectorMapFile.js";
import type { SpeciesEntry, SpeciesProvenance } from "../shared/types.js";
import { loadFootScannedCatalog } from "./footScannedCatalog.js";

let cached: Map<string, Record<string, number>> | null | undefined;

export function sectorSystemsPath(projectRoot: string): string {
  return path.join(projectRoot, "data", "exomastery", "sector-systems.json");
}

/**
 * `systemId64 -> { taxon -> confirmed body count }`, loaded once.
 *
 * The shipped file groups systems under sector cells, which is what the map needs and the wrong
 * shape for a per-system lookup. Flattening it once at load beats walking 241 cells per body.
 */
function systemTaxa(projectRoot: string): Map<string, Record<string, number>> | null {
  if (cached !== undefined) return cached;
  const file = sectorSystemsPath(projectRoot);
  if (!existsSync(file)) {
    cached = null;
    return cached;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as SectorSystemsFile;
    const out = new Map<string, Record<string, number>>();
    for (const systems of Object.values(parsed.cells ?? {})) {
      for (const s of systems ?? []) {
        const counts: Record<string, number> = {};
        for (const [taxon, packed] of Object.entries(s.taxa ?? {})) {
          // `[confirmed, genus, signal, predicted]` — only the first is an identification.
          const confirmed = Array.isArray(packed) ? Number(packed[0]) || 0 : 0;
          // Keyed by the sorted word bag so the lookup does not depend on name order — see
          // `wordBag`. Summed rather than assigned: two taxa can share a bag only if they are the
          // same species written differently, and losing one to an overwrite would be silent.
          if (confirmed > 0) {
            const k = wordBag(taxon);
            counts[k] = (counts[k] ?? 0) + confirmed;
          }
        }
        out.set(String(s.key), counts);
      }
    }
    cached = out;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test seam — the table is process-wide, so a test that swaps it must be able to put it back. */
export function setSectorSystemsForTests(m: Map<string, Record<string, number>> | null | undefined): void {
  cached = m;
}

/**
 * A species name reduced to a key both sides agree on: its words, sorted.
 *
 * The obvious key — genus then name — is wrong, and wrong in a way that would have failed silently
 * on exactly the species this app has already been bitten by. The corpus takes its taxon from
 * Spansh's landmark label, and structures are named the other way round from bacteria:
 *
 * | species tree | corpus taxon |
 * |---|---|
 * | `Aleoida arcus` | `aleoida arcus` |
 * | `Sinuous Tubers Albidum` | `albidum sinuous tubers` |
 * | `Roseum Brain Tree` | `roseum brain tree` |
 *
 * Sorting the words makes the order irrelevant. Measured against the shipped file: **100 of the 110
 * corpus taxa resolve to a species entry, with zero collisions** across all 108 entries. The other
 * ten are taxa with no species row at all — `*`, `bacterial` and `stratum` are signal-level rows,
 * and `bark mounds` plus the six Anemone colour variants have sightings but no entry in the tree.
 * Those fall through to the genus lookup below, which is the honest answer for them.
 */
function wordBag(name: string): string {
  return name.trim().toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
}

function taxonKeyFor(entry: SpeciesEntry): string {
  // `displayName` already carries the genus for both orders — "Aleoida arcus", "Sinuous Tubers
  // Albidum" — so it is the whole name, not a half to be recombined.
  return wordBag(entry.displayName);
}

export function speciesProvenance(
  projectRoot: string,
  systemAddress: number | null | undefined,
  bodyId: number | null | undefined,
  entry: SpeciesEntry,
): SpeciesProvenance {
  const table = systemTaxa(projectRoot);
  const sysKey = systemAddress != null ? String(systemAddress) : null;
  const counts = sysKey != null ? table?.get(sysKey) : undefined;

  let corpusInSystem = counts?.[taxonKeyFor(entry)] ?? 0;
  if (corpusInSystem === 0 && counts) {
    // The corpus records some taxa at genus resolution — `bark mounds`, and the bare genus rows a
    // signal without a species produces. A genus-level hit is still the corpus saying something
    // about this system, so it counts when the species-level key finds nothing.
    corpusInSystem = counts[wordBag(entry.genus)] ?? 0;
  }

  let firstHand = false;
  let firstHandAt: string | undefined;
  if (systemAddress != null && bodyId != null) {
    for (const row of loadFootScannedCatalog(projectRoot).entries) {
      if (row.systemAddress === systemAddress && row.bodyId === bodyId && row.speciesEntryId === entry.id) {
        firstHand = true;
        firstHandAt = row.recordedAt;
        break;
      }
    }
  }

  return { firstHand, firstHandAt, corpusInSystem, systemInCorpus: counts !== undefined };
}
