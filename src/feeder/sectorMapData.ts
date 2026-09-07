/**
 * Turning the stores into sector-map evidence — INCLUDE-BODY-IDS Phase 10, step 2.
 *
 * The aggregation itself is pure and lives in `shared/sectorAggregate.ts`. This is the adapter: it
 * knows which store column means which kind of evidence, and nothing else.
 *
 * ## What each source can and cannot say
 *
 * | source | strongest kind | why not stronger |
 * |---|---|---|
 * | corpus sightings | `confirmed` | it *is* a species identification, from Spansh's exobiology export |
 * | EDDN, genus list present | `genus` | `SAASignalsFound` names the genus, never the species |
 * | EDDN, signal count only | `signal` | the FSS counts, it does not identify |
 * | the matcher | `predicted` | **not built here** — see below |
 *
 * `predicted` is deliberately absent. It would mean running the matcher across bodies the app has
 * never seen, which needs the Spansh export loaded at scale; today the importer is update-only and
 * has matched 182 bodies. Emitting a `predicted` count from the 10,371 corpus bodies would be
 * near-meaningless — those are the bodies we already have *confirmed* answers for. It arrives with
 * the export, and until then the map draws three kinds honestly rather than four kinds badly.
 */
import {
  aggregateBySector,
  type BodyEvidence,
  type SectorAggregateEntry,
} from "../shared/sectorAggregate.js";
import type { FeederStore } from "./feederDb.js";

/**
 * Genus keys arrive from EDDN in the game's internal form. Stripping the wrapper gives a token that
 * reads, and that lines up with the corpus's genus column — `$Codex_Ent_Bacterial_Genus_Name;`
 * becomes `bacterial`.
 *
 * It is **not** a species name and must not be presented as one. §23.4 is the standing warning about
 * what a naming mismatch costs, which is why this returns a normalised key rather than a label.
 */
export function genusKeyFromCodex(codexGenus: string): string {
  const m = /^\$Codex_Ent_(.+?)(?:_Genus)?_Name;$/i.exec(codexGenus.trim());
  return (m?.[1] ?? codexGenus.trim()).toLowerCase();
}

/** The corpus's species label, as a taxon key. */
export function taxonFromSpeciesLabel(label: string): string {
  return label.trim().toLowerCase();
}

export interface SectorMapBuild {
  entries: SectorAggregateEntry[];
  sources: { confirmed: number; genus: number; signal: number };
}

/** Read both stores and aggregate. Everything is in memory already; this is a fold, not a query plan. */
export function buildSectorMapData(store: FeederStore): SectorMapBuild {
  const evidence: BodyEvidence[] = [];
  let confirmed = 0;
  let genus = 0;
  let signal = 0;

  for (const s of store.sightingPositions()) {
    evidence.push({
      x: s.x,
      y: s.y,
      z: s.z,
      bodyKey: s.bodyKey,
      taxon: taxonFromSpeciesLabel(s.speciesLabel),
      kind: "confirmed",
    });
    confirmed += 1;
  }

  for (const b of store.eddnBodyPositions()) {
    if (b.genuses.length > 0) {
      for (const g of b.genuses) {
        evidence.push({ x: b.x, y: b.y, z: b.z, bodyKey: b.bodyKey, taxon: genusKeyFromCodex(g), kind: "genus" });
        genus += 1;
      }
      continue;
    }
    // A signal with no genus says "something is here" and nothing about what. It is recorded against
    // a wildcard taxon so the map can show "biology, unidentified" without pretending to a species.
    if ((b.bioSignalCount ?? 0) > 0) {
      evidence.push({ x: b.x, y: b.y, z: b.z, bodyKey: b.bodyKey, taxon: "*", kind: "signal" });
      signal += 1;
    }
  }

  return { entries: aggregateBySector(evidence), sources: { confirmed, genus, signal } };
}
