/**
 * A varied journal for the end-to-end tests (owner, 2026-09-28: "separate dataset, but with a lot of
 * variety"). Synthetic, from public data only: the commander's own journals stay private, so the
 * systems come from the known-spawn fixture (`tests/fixtures/species-spawn-bodies.json.gz`, Spansh's
 * galaxy dump) and the commander is a made-up one.
 *
 * Each Spansh body goes through the app's own converter (`mapEdsmBodyToExplorationRecord`, which
 * already writes journal units) and out as a journal `Scan`; the rest of a visit is the events the game
 * writes around it — FSDJump, the honk, FSSBodySignals, FSSAllBodiesFound, and a DSS
 * (`SAASignalsFound` with genera) on half the bio bodies, so both FSS-only and post-DSS paths run.
 *
 *   npx tsx scripts/build-e2e-journal.ts      → tests/fixtures/journal-variety/
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { mapEdsmBodyToExplorationRecord } from "../src/server/edsmSystemHydration.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";
import { genusNameForCodexToken } from "../src/shared/codexGenusNames.js";

interface Sample {
  species: string;
  bodyId: number;
  bodyName: string;
  system: {
    id64: string;
    name: string;
    coords: { x: number; y: number; z: number };
    bodies: Record<string, unknown>[];
  };
}

/** One system per line of variety: the odd species first, then ordinary genera from other regions. */
const WANT = [
  "ingensradices_",
  "crystalline_shards_",
  "anemone_",
  "brain_trees_",
  "sinuous_tuber_sinuous_tubers_blatteum",
  "bark_mounds_",
  "stratum_stratum_tectonicas",
  "bacterium_bacterium_tela",
  "fonticulua_",
  "concha_",
  "electricae_electricae_radialem",
  "tussock_",
];

const OUT = path.join("tests", "fixtures", "journal-variety");
const doc = JSON.parse(
  gunzipSync(readFileSync("tests/fixtures/species-spawn-bodies.json.gz")).toString("utf8"),
) as {
  samples: Sample[];
};

const picked: Sample[] = [];
const seen = new Set<string>();
for (const w of WANT) {
  const s = doc.samples.find((x) => x.species.startsWith(w) && !seen.has(x.system.id64));
  if (!s) throw new Error(`no sample for ${w}`);
  seen.add(s.system.id64);
  picked.push(s);
}

let clock = Date.parse("2026-09-01T10:00:00Z");
const tick = (s = 20) => new Date((clock += s * 1000)).toISOString().replace(/\.\d{3}Z$/, "Z");
const lines: string[] = [];
const push = (o: Record<string, unknown>) => lines.push(JSON.stringify({ timestamp: tick(), ...o }));

push({
  event: "Fileheader",
  part: 1,
  language: "English/UK",
  Odyssey: true,
  gameversion: "4.2.0.0",
  build: "e2e",
});
push({ event: "Commander", FID: "F0000000", Name: "E2E Tester" });
push({
  event: "LoadGame",
  FID: "F0000000",
  Commander: "E2E Tester",
  Horizons: true,
  Odyssey: true,
  Ship: "Mandalay",
  FuelCapacity: 32,
});

const pct = (m: unknown) =>
  m && typeof m === "object"
    ? Object.entries(m as Record<string, number>).map(([Name, Percent]) => ({ Name, Percent }))
    : undefined;

function scanLine(
  rec: ExplorationScanRecord,
  raw: Record<string, unknown>,
  system: Sample["system"],
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    event: "Scan",
    ScanType: "Detailed",
    BodyName: rec.bodyName,
    BodyID: rec.bodyId,
    Parents: rec.parents,
    StarSystem: system.name,
    SystemAddress: Number(system.id64),
    DistanceFromArrivalLS: rec.distanceFromArrivalLs ?? 0,
    WasDiscovered: true,
    WasMapped: false,
  };
  if (rec.bodyType === "Star") {
    return {
      ...base,
      StarType: rec.starType,
      Subclass: rec.subclass ?? 0,
      StellarMass: rec.stellarMass,
      Radius: rec.radius,
      AbsoluteMagnitude: rec.absoluteMagnitude,
      Luminosity: rec.luminosity,
      SurfaceTemperature: rec.surfaceTemperature,
      SemiMajorAxis: rec.semiMajorAxis,
    };
  }
  const comp = raw.solidComposition as Record<string, number> | undefined;
  return {
    ...base,
    PlanetClass: rec.planetClass,
    TerraformState: rec.terraformState ?? "",
    Atmosphere: rec.atmosphere ?? "",
    AtmosphereType: rec.atmosphereType ?? "None",
    AtmosphereComposition: pct(raw.atmosphereComposition),
    Volcanism: rec.volcanism ?? "",
    MassEM: rec.massEM,
    Radius: rec.radius,
    SurfaceGravity: rec.surfaceGravity,
    SurfaceTemperature: rec.surfaceTemperature,
    SurfacePressure: rec.surfacePressure ?? 0,
    Landable: rec.landable === true,
    Materials: rec.landable ? pct(raw.materials) : undefined,
    Composition: comp
      ? { Ice: (comp.Ice ?? 0) / 100, Rock: (comp.Rock ?? 0) / 100, Metal: (comp.Metal ?? 0) / 100 }
      : undefined,
    SemiMajorAxis: rec.semiMajorAxis,
    Eccentricity: rec.eccentricity,
    OrbitalInclination: rec.orbitalInclination,
    Periapsis: rec.periapsis,
    OrbitalPeriod: rec.orbitalPeriod,
    RotationPeriod: rec.rotationPeriod,
    TidalLock: rec.tidalLock === true,
  };
}

for (const s of picked) {
  const addr = Number(s.system.id64);
  const bodies = s.system.bodies;
  const main =
    bodies.find((b) => b.type === "Star" && Number(b.distanceToArrival ?? 1) === 0) ??
    bodies.find((b) => b.type === "Star");
  push({
    event: "FSDJump",
    StarSystem: s.system.name,
    SystemAddress: addr,
    StarPos: [s.system.coords.x, s.system.coords.y, s.system.coords.z],
    Body: s.system.name,
    BodyID: main?.bodyId ?? 0,
    BodyType: "Star",
    Population: 0,
    JumpDist: 42.1,
    FuelUsed: 2.1,
    FuelLevel: 28.4,
  });
  const recs = bodies
    .map((b) => ({ raw: b, rec: mapEdsmBodyToExplorationRecord(b, addr, s.system.name) }))
    .filter((x) => x.rec) as {
    raw: Record<string, unknown>;
    rec: ExplorationScanRecord;
  }[];
  push({
    event: "FSSDiscoveryScan",
    Progress: 1.0,
    BodyCount: recs.length,
    NonBodyCount: 0,
    SystemName: s.system.name,
    SystemAddress: addr,
  });
  let dss = 0;
  for (const { raw, rec } of recs) {
    // Spansh lists barycentres as bodies; the game writes them as `ScanBaryCentre`, never as a `Scan`.
    if (raw.type === "Barycentre") {
      push({
        event: "ScanBaryCentre",
        StarSystem: s.system.name,
        SystemAddress: addr,
        BodyID: rec.bodyId,
        SemiMajorAxis: rec.semiMajorAxis,
        Eccentricity: rec.eccentricity,
        OrbitalInclination: rec.orbitalInclination,
        Periapsis: rec.periapsis,
        OrbitalPeriod: rec.orbitalPeriod,
      });
      continue;
    }
    push(scanLine(rec, raw, s.system));
    const sig = (raw.signals ?? {}) as { signals?: Record<string, number>; genuses?: string[] };
    const bio = sig.signals?.["$SAA_SignalType_Biological;"] ?? 0;
    if (bio > 0) {
      push({
        event: "FSSBodySignals",
        BodyName: rec.bodyName,
        BodyID: rec.bodyId,
        SystemAddress: addr,
        Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: bio }],
      });
      // Every other bio body gets its DSS, so the panel shows both the FSS-only and the post-DSS state.
      if (dss++ % 2 === 0 && sig.genuses?.length) {
        push({
          event: "SAAScanComplete",
          BodyName: rec.bodyName,
          SystemAddress: addr,
          BodyID: rec.bodyId,
          ProbesUsed: 5,
          EfficiencyTarget: 7,
        });
        push({
          event: "SAASignalsFound",
          BodyName: rec.bodyName,
          SystemAddress: addr,
          BodyID: rec.bodyId,
          Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: bio }],
          // The names the game prints ("Fonticulua", "Anemone"), from the app's own token table.
          Genuses: sig.genuses.map((g) => ({ Genus: g, Genus_Localised: genusNameForCodexToken(g) ?? g })),
        });
      }
    }
  }
  push({ event: "FSSAllBodiesFound", SystemName: s.system.name, SystemAddress: addr, Count: recs.length });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "Journal.2026-09-01T100000.01.log"), lines.join("\r\n") + "\r\n", "utf8");
console.log(`${picked.length} systems, ${lines.length} journal lines → ${OUT}`);
for (const s of picked) console.log(`  ${s.system.name.padEnd(34)} ${s.species}`);
