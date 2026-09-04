/**
 * Load the genus co-occurrence table the feeder builds.
 *
 * One small JSON beside the price list, read once and cached per project root. Absent is a normal
 * state — a checkout without the table still matches, ranks and pays out exactly as before, it just
 * cannot say which of the candidate genera are the likely ones. Nothing downstream may treat a
 * missing table as a reason to change a candidate list.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GenusCooccurrenceTable } from "../shared/genusCooccurrence.js";

const cache = new Map<string, GenusCooccurrenceTable | null>();

export function genusCooccurrenceTablePath(projectRoot: string): string {
  return join(projectRoot, "data", "exomastery", "genus-cooccurrence.json");
}

function parse(raw: string): GenusCooccurrenceTable | null {
  const parsed = JSON.parse(raw) as Partial<GenusCooccurrenceTable>;
  if (parsed.formatVersion !== 1) return null;
  if (typeof parsed.bodies !== "number" || parsed.bodies <= 0) return null;
  if (!parsed.genera || typeof parsed.genera !== "object") return null;
  return {
    formatVersion: 1,
    builtAt: typeof parsed.builtAt === "string" ? parsed.builtAt : "",
    bodies: parsed.bodies,
    genera: parsed.genera,
    pairs: parsed.pairs ?? {},
    setSizes: parsed.setSizes ?? {},
    unmappedLabels: parsed.unmappedLabels ?? [],
  };
}

export function loadGenusCooccurrenceTable(projectRoot: string): GenusCooccurrenceTable | null {
  const hit = cache.get(projectRoot);
  if (hit !== undefined) return hit;
  let table: GenusCooccurrenceTable | null = null;
  try {
    table = parse(readFileSync(genusCooccurrenceTablePath(projectRoot), "utf8"));
  } catch {
    table = null;
  }
  cache.set(projectRoot, table);
  return table;
}

/** Test seam — the loader caches per root, and a test that writes a table needs the next read to see it. */
export function clearGenusCooccurrenceCacheForTests(): void {
  cache.clear();
}
