/**
 * How many bodies in the commander's own history the chain-order fix actually touches.
 *
 * The fix is measured correct on the corpus — 99.51 % → 100.00 % agreement with Spansh over 17,487
 * bodies — and the accuracy probe moved by nothing at all. Both can be true: the probe scores the
 * bodies he has *sampled*, and a correction only shows there if it lands on one of those.
 *
 * Two different populations change, and the first version of this script conflated them by comparing
 * "nearest star" against "lowest star id" for every chain naming two stars. That is not the old rule.
 * The old rule walked `Parents[0]` first, so a chain *starting* with a star returned it immediately
 * and never reached the fallback at all. Both rules are therefore run here in full — the current one
 * from the source, the old one replicated below — rather than sketched.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJournalMergeCacheForTool } from "./probeCache.js";
import {
  allStarParentIds,
  hostStarBodyIdsForExobiology,
  parseJournalParentEntry,
  resolveHostStarBodyId,
} from "../src/server/orbitUtils.js";
import type { BodyExoState, ExplorationScanRecord } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
void root;

/** The rule as it stood before the ordering fix: walk `Parents[0]`, else the **lowest** star id. */
function oldResolveHostStarBodyId(
  rec: ExplorationScanRecord,
  byBodyId: Map<number, ExplorationScanRecord>,
): number | null {
  const visitedPlanets = new Set<number>();
  let cur: ExplorationScanRecord | null = rec;
  for (let d = 0; d < 24 && cur; d++) {
    const parents = cur.parents;
    if (!Array.isArray(parents) || parents.length === 0) break;
    const im = parseJournalParentEntry(parents[0]);
    if (!im) break;
    if (im.kind === "Star") return im.id;
    if (im.kind === "Planet") {
      if (visitedPlanets.has(im.id)) break;
      visitedPlanets.add(im.id);
      cur = byBodyId.get(im.id) ?? null;
      continue;
    }
    break;
  }
  const stars = allStarParentIds(rec.parents);
  if (!stars.length) return null;
  return stars.reduce((a, b) => Math.min(a, b));
}

/** The set as it stood before: every star at the first level of the chain that named any. */
function oldHostStarSet(
  rec: ExplorationScanRecord,
  byBodyId: Map<number, ExplorationScanRecord>,
): number[] | null {
  const found = new Set<number>();
  const visitedPlanets = new Set<number>();
  let cur: ExplorationScanRecord | null = rec;
  for (let d = 0; d < 24 && cur; d++) {
    for (const id of allStarParentIds(cur.parents)) found.add(id);
    if (found.size > 0) break;
    const parents = cur.parents;
    if (!Array.isArray(parents) || parents.length === 0) break;
    const im = parseJournalParentEntry(parents[0]);
    if (!im || im.kind !== "Planet") break;
    if (visitedPlanets.has(im.id)) break;
    visitedPlanets.add(im.id);
    cur = byBodyId.get(im.id) ?? null;
  }
  // Null means "the chain named no star" — the designation path, which this fix does not touch.
  return found.size > 0 ? [...found] : null;
}

const payload = loadJournalMergeCacheForTool();
const bodies: BodyExoState[] = payload.bodies.map(([, b]) => b);
const bioKeys = new Set(bodies.filter((b) => (b.biologicalSignals ?? 0) > 0).map((b) => b.key));

const bySystem = new Map<number, Map<number, ExplorationScanRecord>>();
const all: ExplorationScanRecord[] = [];
for (const [, r] of [...(payload.soldExplorationScans ?? []), ...payload.explorationScans]) {
  all.push(r);
  const m = bySystem.get(r.systemAddress) ?? new Map<number, ExplorationScanRecord>();
  m.set(r.bodyId, r);
  bySystem.set(r.systemAddress, m);
}

const cls = (systemAddress: number, id: number | null) =>
  (id == null ? "" : bySystem.get(systemAddress)?.get(id)?.starType?.trim()) || "?";

let singleChanged = 0;
let singleChangedClass = 0;
let singleChangedBio = 0;
let setChanged = 0;
let setChangedBio = 0;
const examples: string[] = [];

for (const r of all) {
  const byId = bySystem.get(r.systemAddress) ?? new Map<number, ExplorationScanRecord>();
  const isBio = bioKeys.has(`${r.systemAddress}:${r.bodyId}`);

  const oldOne = oldResolveHostStarBodyId(r, byId);
  const newOne = resolveHostStarBodyId(r, byId);
  if (oldOne !== newOne) {
    singleChanged += 1;
    if (isBio) singleChangedBio += 1;
    const a = cls(r.systemAddress, oldOne);
    const b = cls(r.systemAddress, newOne);
    if (a !== b) {
      singleChangedClass += 1;
      if (isBio && examples.length < 12) {
        examples.push(`${(r.bodyName ?? "").padEnd(30)} ${a} -> ${b}   chain ${JSON.stringify(r.parents)}`);
      }
    }
  }

  const oldSet = oldHostStarSet(r, byId);
  if (oldSet) {
    const newSet = hostStarBodyIdsForExobiology(r, byId);
    if (JSON.stringify([...oldSet].sort()) !== JSON.stringify([...newSet].sort())) {
      setChanged += 1;
      if (isBio) setChangedBio += 1;
    }
  }
}

console.log(`exploration scans in the cache          ${all.length}`);
console.log("");
console.log(`single host star changes                ${singleChanged}`);
console.log(`  ... to a different star class         ${singleChangedClass}`);
console.log(`  ... on a body carrying biology        ${singleChangedBio}`);
console.log("");
console.log(`host-star *set* narrows                 ${setChanged}`);
console.log(`  ... on a body carrying biology        ${setChangedBio}`);

if (examples.length) {
  console.log("\nbio bodies whose single host star changes class:");
  for (const e of examples) console.log(`  ${e}`);
}
