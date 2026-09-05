/**
 * The two small files the ranking model reads, cached per project root.
 *
 * Both are written by the feeder beside the co-occurrence table and ship with `data/`. Both are
 * optional: without them the model declines to rank and the app falls back to the ordering it had
 * before, which is the same rule the co-occurrence table follows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HistogramEdgesFile } from "../shared/likelihoodBins.js";
import type { SpeciesPrevalenceFile } from "../shared/speciesPrior.js";

const edgesCache = new Map<string, HistogramEdgesFile | null>();
const prevalenceCache = new Map<string, SpeciesPrevalenceFile | null>();

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function histogramEdgesPath(projectRoot: string): string {
  return join(projectRoot, "data", "exomastery", "histogram-edges.json");
}

export function speciesPrevalencePath(projectRoot: string): string {
  return join(projectRoot, "data", "exomastery", "species-prevalence.json");
}

export function loadHistogramEdges(projectRoot: string): HistogramEdgesFile | null {
  const hit = edgesCache.get(projectRoot);
  if (hit !== undefined) return hit;
  const parsed = readJson<Partial<HistogramEdgesFile>>(histogramEdgesPath(projectRoot));
  const ok =
    parsed?.formatVersion === 1 &&
    typeof parsed.bins === "number" &&
    parsed.bins > 1 &&
    parsed.edges != null &&
    typeof parsed.edges === "object";
  const value = ok ? (parsed as HistogramEdgesFile) : null;
  edgesCache.set(projectRoot, value);
  return value;
}

export function loadSpeciesPrevalence(projectRoot: string): SpeciesPrevalenceFile | null {
  const hit = prevalenceCache.get(projectRoot);
  if (hit !== undefined) return hit;
  const parsed = readJson<Partial<SpeciesPrevalenceFile>>(speciesPrevalencePath(projectRoot));
  const ok =
    parsed?.formatVersion === 1 &&
    typeof parsed.bodies === "number" &&
    parsed.bodies > 0 &&
    parsed.species != null &&
    typeof parsed.species === "object";
  const value = ok ? (parsed as SpeciesPrevalenceFile) : null;
  prevalenceCache.set(projectRoot, value);
  return value;
}

/** Test seam — both files are cached per root, and a test that writes one needs the next read to see it. */
export function clearLikelihoodDataCacheForTests(): void {
  edgesCache.clear();
  prevalenceCache.clear();
}
