/**
 * Other players' finds as a standing test (owner, 2026-10-05: "keep some EDDN sourced data, that
 * others or we would need"). `tests/fixtures/eddn-set-sample.json.gz`: 48 systems from the owner's EDDN
 * collector (2026-10-03) — the eight fixed that day, and forty more — with each system's EDDN Scan /
 * FSSBodySignals / SAASignalsFound messages, its stars, and per body the species other players logged
 * (ScanOrganic). Body facts and codex tokens only, no commander names.
 *
 * Each system is replayed through the store as a flight (as docs/perf/eddn-set-probe.mts does) and
 * read after the DSS: every species logged on a scanned body must be shown, not demoted.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { buildSnapshot, loadSpeciesDatabase } from "../src/server/snapshot.js";
import { codexSpeciesKey, gameOrderSpeciesName } from "../src/shared/codexLog.js";
import { genusNameForCodexToken } from "../src/shared/codexGenusNames.js";

interface Star {
  bodyId: number;
  name: string | null;
  starType: string | null;
  subclass: number | null;
  luminosity: string | null;
  massSol: number | null;
  radiusM: number | null;
  tempK: number | null;
  ageMy: number | null;
  absMag: number | null;
  distanceLs: number | null;
}
interface Rec {
  id64: string;
  name: string;
  pos: [number, number, number] | null;
  stars: Record<string, Star>;
  events: Record<string, unknown>[];
  truth: Record<string, Record<string, { variants: Record<string, number> }>>;
}

const recs = (
  JSON.parse(gunzipSync(readFileSync("tests/fixtures/eddn-set-sample.json.gz")).toString("utf8")) as {
    systems: Rec[];
  }
).systems;
const db = loadSpeciesDatabase();
const nameKey = (n: string) =>
  codexSpeciesKey(gameOrderSpeciesName(n)).replace(/^amphora plants$/, "amphora plant");
const byKey = new Map(db.species.map((e) => [nameKey(e.displayName), e]));
const types = new Map(
  (
    JSON.parse(readFileSync("data/codex/edsm-codex-regions.json", "utf8")) as {
      types: [string, string, string][];
    }
  ).types.map(([k, n]) => [k, n]),
);
const tokenKey = (t: string) =>
  t
    .replace(/^\$/, "")
    .replace(/_name;?$/i, "")
    .toLowerCase();

/** Replays one system after the DSS; per logged species: was it shown, and in which colour. */
function replay(rec: Rec) {
  const addr = Number(rec.id64);
  const scannedIds = new Set(rec.events.filter((e) => e.event === "Scan").map((e) => e.BodyID));
  const fssIds = new Set(rec.events.filter((e) => e.event === "FSSBodySignals").map((e) => e.BodyID));
  const fix = (e: Record<string, unknown>) => {
    const o: Record<string, unknown> = { ...e, SystemAddress: addr };
    if (Array.isArray(o.Genuses))
      o.Genuses = (o.Genuses as Record<string, unknown>[]).map((g) => ({
        ...g,
        Genus_Localised: genusNameForCodexToken(String(g.Genus ?? "")) ?? g.Genus,
      }));
    return o;
  };
  const store = new GameStateStore();
  store.setIncludeBacteriumInSearch(true);
  const lines: Record<string, unknown>[] = [
    {
      event: "FSDJump",
      timestamp: "2026-09-27T00:00:00Z",
      StarSystem: rec.name,
      SystemAddress: addr,
      StarPos: rec.pos ?? undefined,
    },
    ...Object.values(rec.stars ?? {})
      .filter((s) => !scannedIds.has(s.bodyId))
      .map((s) => ({
        event: "Scan",
        ScanType: "AutoScan",
        timestamp: "2026-09-27T00:00:00Z",
        StarSystem: rec.name,
        SystemAddress: addr,
        BodyID: s.bodyId,
        BodyName: s.name ?? `${rec.name} ${s.bodyId}`,
        DistanceFromArrivalLS: s.distanceLs ?? 0,
        StarType: s.starType,
        Subclass: s.subclass,
        Luminosity: s.luminosity,
        StellarMass: s.massSol,
        Radius: s.radiusM,
        SurfaceTemperature: s.tempK,
        Age_MY: s.ageMy,
        AbsoluteMagnitude: s.absMag,
      })),
    ...rec.events.map(fix),
    // Not every uploader sends FSSBodySignals; the game writes it before a DSS with the same counts.
    ...rec.events
      .filter((e) => e.event === "SAASignalsFound" && !fssIds.has(e.BodyID))
      .map((e) =>
        fix({
          event: "FSSBodySignals",
          timestamp: e.timestamp,
          BodyName: e.BodyName,
          BodyID: e.BodyID,
          Signals: e.Signals,
        }),
      ),
  ];
  for (const l of lines) store.apply(l as never);
  store.setViewingSystemAddress(addr);
  const snap = buildSnapshot(store, null, "", "127.0.0.1", 0, [], 1);
  const out: {
    body: number;
    species: string;
    shown: boolean;
    colourTrue: string | null;
    colourPred: string | null;
  }[] = [];
  for (const [bodyIdStr, spp] of Object.entries(rec.truth)) {
    const bodyId = Number(bodyIdStr);
    if (!scannedIds.has(bodyId)) continue;
    const body = snap.bodies.find((b) => b.state.bodyId === bodyId);
    for (const [spToken, t] of Object.entries(spp)) {
      const variantToken = Object.keys(t.variants).sort((a, b) => t.variants[b]! - t.variants[a]!)[0] ?? "";
      const variantName = types.get(tokenKey(variantToken)) ?? null;
      const speciesName =
        variantName?.split(" - ")[0] ??
        tokenKey(spToken)
          .replace(/^codex_ent_/, "")
          .replace(/_/g, " ");
      const entry = byKey.get(nameKey(speciesName));
      if (!entry) continue;
      const m = body?.matches.find((x) => x.entry.id === entry.id);
      out.push({
        body: bodyId,
        species: entry.id,
        shown: !!m && !m.unlikely,
        colourTrue: variantName?.split(" - ")[1] ?? null,
        colourPred: m?.predictedColour ?? null,
      });
    }
  }
  return out;
}

describe("other players' finds (EDDN sample)", () => {
  let all: { name: string; rows: ReturnType<typeof replay> }[] = [];
  beforeAll(() => {
    all = recs.map((r) => ({ name: r.name, rows: replay(r) }));
  }, 120_000);

  it("shows every species logged on a scanned body, after the DSS", () => {
    const missed = all.flatMap((s) =>
      s.rows.filter((r) => !r.shown).map((r) => `${s.name} ${r.body}: ${r.species}`),
    );
    expect(all.reduce((t, s) => t + s.rows.length, 0)).toBeGreaterThan(150);
    expect(missed).toEqual([]);
  });

  it("keeps the colours fixed on 2026-10-03", () => {
    // Clookia TZ-W d2-562 3 b: Tussock catena round a neutron star is Yellow (ef3528c).
    const clookia = all
      .find((s) => s.name === "Clookia TZ-W d2-562")!
      .rows.find((r) => r.species.includes("catena"));
    expect(clookia?.colourTrue).toBe("Yellow");
    expect(clookia?.colourPred).toBe("Yellow");
  });
});
