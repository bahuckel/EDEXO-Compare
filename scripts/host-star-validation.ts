/**
 * Does our host-star resolver agree with Spansh's, on twenty thousand bodies?
 *
 * `resolveHostStarBodyId` decides which star a body orbits by walking `Parents[0]`: a `Star` entry
 * wins, a `Planet` entry hops to that planet's record and continues, and anything else stops the
 * walk, after which it falls back to the lowest star id among the body's own parents. That answer
 * drives the host-star gates, the colour tables that read the parent star, and the corpus's own
 * `exo.host_star_spectral_primary`.
 *
 * It has been wrong before in a way that cost real accuracy: a body orbiting an M + L **barycentre**
 * names no star at all, the fallback picked one, and the shipped Electricae pluma profile ended up
 * carrying an `M3` host in a system whose primary is a neutron star — which licensed pluma on every
 * M-class body in the game. `hostStarBodyIdsForExobiology` exists because of that.
 *
 * The Spansh galaxy dump publishes `hostStarBodyId`, its own answer to the same question. That is a
 * **second derivation, not ground truth**: where the two differ, one of them is wrong and the case
 * has to be read. What makes the comparison worth running is that our rule has never been checked
 * against anything but its own tests.
 *
 * The comparison is kept honest by splitting on whether the two sources even describe the same body:
 * EDSM's `parents` and Spansh's can differ, and a disagreement about the *data* is not a disagreement
 * about the *rule*. Only bodies where both chains are identical test the rule.
 *
 *   npx tsx scripts/host-star-validation.ts <hoststar-rows.jsonl> <name-to-cache.json>
 *
 * Both inputs come from the scratchpad: one streaming pass over the dump, and a map from body name
 * to the local EDSM system cache that holds it.
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { resolveHostStarBodyId, hostStarBodyIdsForExobiology } from "../src/server/orbitUtils.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

const [rowsPath, cacheMapPath] = process.argv.slice(2);
if (!rowsPath || !cacheMapPath) {
  console.error("usage: host-star-validation.ts <hoststar-rows.jsonl> <name-to-cache.json>");
  process.exit(1);
}

const feederDir =
  process.env.EXOMASTERY_FEEDER_DIR?.trim() || path.resolve(process.cwd(), "..", "exomastery-feeder");
const systemsDir = path.join(feederDir, "data", "raw", "systems");

interface DumpRow {
  name: string;
  bodyId: number | null;
  systemId64: string | null;
  parents: Record<string, number>[] | null;
  hostStarBodyId: number | null;
  mainStar: boolean | null;
  spectralClass: string | null;
  type: string | null;
  subType: string | null;
}

interface CacheBody {
  name?: string;
  bodyId?: number;
  type?: string;
  subType?: string;
  spectralClass?: string;
  parents?: Record<string, number>[];
}

const nameToCache = JSON.parse(readFileSync(cacheMapPath, "utf8")) as Record<string, string>;

const rows: DumpRow[] = [];
for (const line of readFileSync(rowsPath, "utf8").split(/\r?\n/)) {
  if (line.trim()) rows.push(JSON.parse(line) as DumpRow);
}

const cacheCache = new Map<string, Map<number, CacheBody>>();
function systemBodies(file: string): Map<number, CacheBody> {
  const hit = cacheCache.get(file);
  if (hit) return hit;
  const out = new Map<number, CacheBody>();
  const p = path.join(systemsDir, file);
  if (existsSync(p)) {
    try {
      const j = JSON.parse(readFileSync(p, "utf8")) as { bodies?: CacheBody[] };
      for (const b of j.bodies ?? []) {
        if (typeof b.bodyId === "number") out.set(b.bodyId, b);
      }
    } catch {
      /* unreadable cache: treated as absent */
    }
  }
  cacheCache.set(file, out);
  return out;
}

/** An `ExplorationScanRecord` with only the fields the resolver reads. */
function asRecord(b: CacheBody): ExplorationScanRecord {
  return {
    systemAddress: 0,
    bodyId: b.bodyId ?? -1,
    bodyName: b.name ?? "",
    starSystem: "",
    updatedAt: "",
    parents: b.parents,
    starType: b.spectralClass ? b.spectralClass[0] : undefined,
  } as unknown as ExplorationScanRecord;
}

const sameChain = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

let noCache = 0;
let notInCache = 0;
let noDumpAnswer = 0;
let chainDiffers = 0;
let compared = 0;
let agree = 0;
const disagreements: {
  name: string;
  ours: number | null;
  theirs: number | null;
  parents: unknown;
  oursIsFallback: boolean;
  setSize: number;
}[] = [];

let ourNull = 0;
let fallbackUsed = 0;
let setBiggerThanOne = 0;
/* Where a set larger than one comes from: an ordered chain naming several stars, or no star at all. */
let setFromChain = 0;
let setFromDesignation = 0;
let chainNamesTwoPlusStars = 0;

for (const r of rows) {
  const file = nameToCache[r.name];
  if (!file) {
    noCache += 1;
    continue;
  }
  const byId = systemBodies(file);
  const mine = [...byId.values()].find((b) => b.name === r.name);
  if (!mine) {
    notInCache += 1;
    continue;
  }

  const rec = asRecord(mine);
  const recMap = new Map<number, ExplorationScanRecord>();
  for (const [id, b] of byId) recMap.set(id, asRecord(b));

  const ours = resolveHostStarBodyId(rec, recMap);
  const set = hostStarBodyIdsForExobiology(rec, recMap);
  if (ours == null) ourNull += 1;
  if (set.length > 1) {
    setBiggerThanOne += 1;
    const inChain = (mine.parents ?? []).filter((p) => Object.keys(p)[0] === "Star").length;
    if (inChain > 1) {
      chainNamesTwoPlusStars += 1;
      setFromChain += 1;
    } else if (inChain === 0) {
      setFromDesignation += 1;
    }
  }

  // Did the walk find a star, or did the lowest-star fallback answer?
  const firstParent = (mine.parents ?? [])[0];
  const walkedToStar = firstParent != null && Object.keys(firstParent)[0] === "Star";
  if (ours != null && !walkedToStar) fallbackUsed += 1;

  if (r.hostStarBodyId == null) {
    noDumpAnswer += 1;
    continue;
  }
  if (!sameChain(mine.parents, r.parents)) {
    chainDiffers += 1;
    continue;
  }

  compared += 1;
  if (ours === r.hostStarBodyId) {
    agree += 1;
  } else if (disagreements.length < 4000) {
    disagreements.push({
      name: r.name,
      ours,
      theirs: r.hostStarBodyId,
      parents: mine.parents,
      oursIsFallback: !walkedToStar,
      setSize: set.length,
    });
  }
}

console.log(`dump rows                     ${rows.length}`);
console.log(`  no local system cache       ${noCache}`);
console.log(`  body absent from its cache  ${notInCache}`);
console.log(`  dump has no hostStarBodyId  ${noDumpAnswer}`);
console.log(`  parents chains differ       ${chainDiffers}   <- a data difference, not a rule one`);
console.log(`  comparable on identical chains ${compared}`);
console.log("");
console.log(
  `agree                         ${agree} (${((agree / Math.max(1, compared)) * 100).toFixed(2)} %)`,
);
console.log(`disagree                      ${compared - agree}`);
console.log("");
console.log(`our rule returned null        ${ourNull}`);
console.log(`answered by the fallback      ${fallbackUsed}   <- the chain named no star directly`);
console.log(`host-star *set* larger than 1 ${setBiggerThanOne}`);
console.log(
  `  chain itself names 2+ stars ${setFromChain}   <- ordered: the nearest is the host, the rest are its ancestors`,
);
console.log(
  `  chain names none (designation) ${setFromDesignation}   <- genuinely ambiguous, the pluma case`,
);
console.log(`bodies whose chain names 2+ stars ${chainNamesTwoPlusStars}`);

if (disagreements.length) {
  const byShape = new Map<string, number>();
  for (const d of disagreements) {
    const shape =
      ((d.parents as Record<string, number>[] | null) ?? []).map((p) => Object.keys(p)[0]).join(">") ||
      "(no parents)";
    byShape.set(shape, (byShape.get(shape) ?? 0) + 1);
  }
  console.log("\ndisagreements by parent-chain shape:");
  for (const [shape, n] of [...byShape].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(5)}  ${shape}`);
  }
  console.log("\nfirst ten:");
  for (const d of disagreements.slice(0, 10)) {
    console.log(
      `  ${d.name.padEnd(36)} ours ${String(d.ours).padStart(4)}  spansh ${String(d.theirs).padStart(4)}  ` +
        `${d.oursIsFallback ? "fallback" : "walked  "}  set=${d.setSize}  ${JSON.stringify(d.parents)}`,
    );
  }
}
