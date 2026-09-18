/**
 * Restoring the kelvin EDSM truncated — `feeder/numericRehydration.ts`.
 *
 * The profiles' temperatures are whole numbers because 80.2 % of the sample packs arrive that way
 * from EDSM, while gravity is 0.0 % integer and pressure 0.1 %. `histogramBin` walks
 * `value > edges[i]`, so a corpus `159` and a live `159.864456` fall in different bins and the live
 * float scores against an empty one.
 *
 * Two things here are worth a test rather than a comment, because both were discovered the hard way
 * and both would silently produce a plausible-looking wrong answer:
 *
 * **The join cannot use `id64`.** EDSM serialises it as a bare JSON number above 2^53, so the low
 * bits — which are exactly the `systemId64` half of `id64 == systemId64 + (bodyId << 55)` — are
 * already gone in the cached file. The damage is close to invisible, because `String()` on the
 * rounded double prints the original digits back. Joining on it matched 68 of 10,779 bodies;
 * joining on `(systemName, bodyId)` matches 10,752.
 *
 * **Only truncation is repaired.** A dump reading is accepted only if it truncates back to the
 * pack's integer. Anything else is a different measurement — a re-survey, a changed value, the
 * wrong body — and must be left alone and counted, because that count is the only way anyone would
 * learn the truncation story was wrong. On the real corpus it is **0 across 10,661 repairs**.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectIntegerTemperatureBodies,
  rehydrateNumericsFromDump,
  type NumericOverlay,
} from "../src/feeder/numericRehydration.js";

let root: string;
let planets: string;
let outFile: string;
let dumpFile: string;

/** A sample pack as EDSM's cache actually stores one — id64 as a bare number, rounded and all. */
function pack(
  slug: string,
  n: number,
  body: { systemName: string; name: string; bodyId: number; surfaceTemperature: number; id64?: string },
): void {
  const dir = path.join(planets, slug);
  mkdirSync(dir, { recursive: true });
  const id64 = body.id64 ?? "864691242448492200";
  writeFileSync(
    path.join(dir, `sample_${n}.json`),
    `{"systemName":${JSON.stringify(body.systemName)},"bodyName":${JSON.stringify(body.name)},"context":{"targetBody":{"id64":${id64},"bodyId":${body.bodyId},"name":${JSON.stringify(body.name)},"surfaceTemperature":${body.surfaceTemperature}}}}`,
    "utf8",
  );
}

/** The dump's own shape: JSONL, gzipped, **no spaces after colons**, ids as decimal strings. */
function writeDump(rows: object[]): void {
  const lines = rows.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(dumpFile, gzipSync(Buffer.from(`${lines}\n`, "utf8")));
}

const system = (id64: string, name: string) => ({ kind: "system", id64, name });
const dumpBody = (systemId64: string, bodyId: number, name: string, surfaceTemperature: number) => ({
  kind: "body",
  id64: "1",
  systemId64,
  bodyId,
  name,
  surfaceTemperature,
});

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-rehydrate-"));
  planets = path.join(root, "planets");
  mkdirSync(planets, { recursive: true });
  outFile = path.join(root, "numeric-overlay.json");
  dumpFile = path.join(root, "dump.jsonl.gz");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = async () =>
  rehydrateNumericsFromDump(dumpFile, { apply: true, planetsDir: planets, outFile });

const overlay = (): NumericOverlay => JSON.parse(readFileSync(outFile, "utf8")) as NumericOverlay;

describe("choosing what to repair", () => {
  it("takes the integer temperatures and leaves the floats alone", () => {
    /*
      A pack that already holds a float came from a source with the resolution. Replacing it with
      another source's float is not a repair, it is a preference between measurements.
    */
    pack("stratum_tectonicas", 0, { systemName: "Sys A", name: "Sys A 1 a", bodyId: 4, surfaceTemperature: 159 });
    pack("stratum_tectonicas", 1, {
      systemName: "Sys A",
      name: "Sys A 1 b",
      bodyId: 5,
      surfaceTemperature: 160.25,
    });
    const { wanted, bodyCount } = collectIntegerTemperatureBodies(planets);
    expect(bodyCount).toBe(1);
    expect(wanted.get("Sys A")?.get(4)?.packTemp).toBe(159);
    expect(wanted.get("Sys A")?.get(5)).toBeUndefined();
  });

  it("counts one body once, however many species were sampled on it", () => {
    // The same rock appears in every species' folder it grew. It is still one repair.
    pack("stratum_tectonicas", 0, { systemName: "Sys A", name: "Sys A 1 a", bodyId: 4, surfaceTemperature: 159 });
    pack("bacterium_aurasus", 0, { systemName: "Sys A", name: "Sys A 1 a", bodyId: 4, surfaceTemperature: 159 });
    expect(collectIntegerTemperatureBodies(planets).bodyCount).toBe(1);
  });
});

describe("the walk", () => {
  it("restores a truncated temperature", async () => {
    pack("stratum_tectonicas", 0, { systemName: "Sys A", name: "Sys A 1 a", bodyId: 4, surfaceTemperature: 159 });
    writeDump([system("100", "Sys A"), dumpBody("100", 4, "Sys A 1 a", 159.864456)]);

    const r = await run();
    expect(r.accepted).toBe(1);
    expect(r.rejectedMismatch).toBe(0);
    expect(overlay().bodies["Sys A 1 a"]?.surfaceTemperature).toBe(159.864456);
  });

  it("joins on (systemName, bodyId), not on the packs' broken id64", async () => {
    /*
      The pack's id64 here is EDSM's rounded value and the dump's is the real one — they differ, as
      they do on the real corpus. The repair must still land. This is the test that fails if anyone
      "simplifies" the walk back to an id64 comparison.
    */
    pack("stratum_tectonicas", 0, {
      systemName: "Sys A",
      name: "Sys A 1 a",
      bodyId: 4,
      surfaceTemperature: 179,
      id64: "864691242448492200",
    });
    writeDump([system("113993356899", "Sys A"), dumpBody("113993356899", 4, "Sys A 1 a", 179.810226)]);

    const r = await run();
    expect(r.accepted).toBe(1);
    expect(overlay().bodies["Sys A 1 a"]?.surfaceTemperature).toBe(179.810226);
  });

  it("keys the overlay by body name, which is what the profile builder can look up", async () => {
    // The builder holds the rounded id64; the name is the only identifier both sides agree on.
    pack("stratum_tectonicas", 0, { systemName: "Sys A", name: "Sys A 1 a", bodyId: 4, surfaceTemperature: 159 });
    writeDump([system("100", "Sys A"), dumpBody("100", 4, "Sys A 1 a", 159.5)]);
    await run();
    expect(Object.keys(overlay().bodies)).toEqual(["Sys A 1 a"]);
  });

  it("refuses a reading that does not truncate back to the pack's", async () => {
    /*
      Truncation is the hypothesis. 401 against 221.078812 is not a rounding artefact, it is a
      different measurement — and it is reported, because a count climbing here is how the
      hypothesis gets falsified.
    */
    pack("stratum_tectonicas", 0, { systemName: "Sys A", name: "Sys A 1 a", bodyId: 4, surfaceTemperature: 401 });
    writeDump([system("100", "Sys A"), dumpBody("100", 4, "Sys A 1 a", 221.078812)]);

    const r = await run();
    expect(r.accepted).toBe(0);
    expect(r.rejectedMismatch).toBe(1);
    expect(r.mismatchExamples[0]).toEqual({ body: "Sys A 1 a", pack: 401, dump: 221.078812 });
    expect(overlay().bodies).toEqual({});
  });

  it("leaves a body the dump also records as an integer", async () => {
    pack("stratum_tectonicas", 0, { systemName: "Sys A", name: "Sys A 1 a", bodyId: 4, surfaceTemperature: 159 });
    writeDump([system("100", "Sys A"), dumpBody("100", 4, "Sys A 1 a", 159)]);

    const r = await run();
    expect(r.accepted).toBe(0);
    expect(r.rejectedIntegerInDump).toBe(1);
  });

  it("refuses a bodyId whose name disagrees", async () => {
    // A bodyId is only unique within its system; if the name differs, the system match was wrong.
    pack("stratum_tectonicas", 0, { systemName: "Sys A", name: "Sys A 1 a", bodyId: 4, surfaceTemperature: 159 });
    writeDump([system("100", "Sys A"), dumpBody("100", 4, "Sys A 2 c", 159.7)]);

    const r = await run();
    expect(r.accepted).toBe(0);
    expect(r.rejectedNameMismatch).toBe(1);
  });

  it("ignores bodies in systems it was not looking for", async () => {
    pack("stratum_tectonicas", 0, { systemName: "Sys A", name: "Sys A 1 a", bodyId: 4, surfaceTemperature: 159 });
    writeDump([
      system("100", "Sys A"),
      dumpBody("100", 4, "Sys A 1 a", 159.9),
      system("200", "Sys B"),
      dumpBody("200", 4, "Sys B 1 a", 77.7),
    ]);

    const r = await run();
    expect(r.systemsFoundInDump).toBe(1);
    expect(r.accepted).toBe(1);
    expect(overlay().bodies["Sys B 1 a"]).toBeUndefined();
  });

  it("writes nothing without --apply", async () => {
    // A half-applied repair looks finished; the report has to be readable before anything changes.
    pack("stratum_tectonicas", 0, { systemName: "Sys A", name: "Sys A 1 a", bodyId: 4, surfaceTemperature: 159 });
    writeDump([system("100", "Sys A"), dumpBody("100", 4, "Sys A 1 a", 159.9)]);

    const r = await rehydrateNumericsFromDump(dumpFile, { apply: false, planetsDir: planets, outFile });
    expect(r.accepted).toBe(1);
    expect(() => readFileSync(outFile, "utf8")).toThrow();
  });
});
