/**
 * The galaxy map's filters (owner, 2026-10-04, overnight Q14): shop-style facets over stars, bodies and
 * exobio, answered as bits over bio-index ordinals.
 */
import { describe, expect, it } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  BODY_TRAITS,
  STAR_CLASSES,
  isGiantStar,
  planetClassIndex,
  starClassIndex,
} from "../src/shared/galaxyTraits.js";
import { galaxyFilterMask, parseSystemTraits, TRAITS_MAGIC, type SystemTraits } from "../src/server/galaxyTraits.js";

const key = (list: readonly { key: string }[], i: number) => list[i]?.key;

describe("folding star and planet names onto the filter's classes", () => {
  it("reads the Spansh dump's names and the journal's", () => {
    const cases: [string, string][] = [
      ["K (Yellow-Orange) Star", "K"],
      ["B (Blue-White super giant) Star", "B"],
      ["White Dwarf (DAV) Star", "D"],
      ["Neutron Star", "N"],
      ["Black Hole", "H"],
      ["Wolf-Rayet O Star", "W"],
      ["T Tauri Star", "TTS"],
      ["Herbig Ae/Be Star", "AeBe"],
      ["MS-type Star", "C"],
      ["CN Star", "C"],
      ["Y (Brown dwarf) Star", "Y"],
      // the journal's StarType
      ["K", "K"],
      ["M_RedGiant", "M"],
      ["DA", "D"],
      ["WNC", "W"],
      ["SupermassiveBlackHole", "H"],
    ];
    for (const [name, want] of cases) expect([name, key(STAR_CLASSES, starClassIndex(name))]).toEqual([name, want]);
    expect(isGiantStar("B (Blue-White super giant) Star")).toBe(true);
    expect(isGiantStar("K (Yellow-Orange) Star")).toBe(false);
    expect(starClassIndex("")).toBe(-1);
  });

  it("planets, both spellings", () => {
    const cases: [string, string][] = [
      ["High metal content world", "hmc"],
      ["High metal content body", "hmc"],
      ["Metal-rich body", "metal_rich"],
      ["Metal rich body", "metal_rich"],
      ["Rocky Ice world", "rocky_ice"],
      ["Rocky ice body", "rocky_ice"],
      ["Earth-like world", "elw"],
      ["Earthlike body", "elw"],
      ["Gas giant with water-based life", "gg_water_life"],
      ["Gas giant with ammonia based life", "gg_ammonia_life"],
      ["Class III gas giant", "gg3"],
      ["Sudarsky class IV gas giant", "gg4"],
      ["Sudarsky class V gas giant", "gg5"],
      ["Helium rich gas giant", "helium_gg"],
      ["Water giant", "water_giant"],
    ];
    for (const [name, want] of cases) expect([name, key(BODY_TRAITS, planetClassIndex(name))]).toEqual([name, want]);
  });
});

/** Four systems: 0 neutron + ELW, 1 K + HMC terraformable, 2 M main with a white dwarf, icy, 3 nothing known. */
function fixture(): { traits: SystemTraits; index: Parameters<typeof galaxyFilterMask>[1] } {
  const s = (k: string) => STAR_CLASSES.findIndex((c) => c.key === k);
  const b = (k: string) => 1 << BODY_TRAITS.findIndex((c) => c.key === k);
  const traits: SystemTraits = {
    count: 4,
    main: Uint8Array.from([s("N"), s("K"), s("M"), 255]),
    stars: Uint32Array.from([1 << s("N"), 1 << s("K"), (1 << s("M")) | (1 << s("D")), 0]),
    bodies: Uint32Array.from([b("elw"), b("hmc") | b("terraformable"), b("icy") | b("landable"), 0]),
  };
  const runs: [number, number][] = [
    [0, 0], // stratum_tectonicas in system 0
    [2, 1], // bacterium_vesicula in system 2
  ];
  const index = {
    systemCount: 4,
    species: ["stratum_stratum_tectonicas", "bacterium_bacterium_vesicula"],
    forEachRegionSpecies: (cb: (i: number, r: number, s: number, t: number) => void) => {
      for (let i = 0; i < 4; i++) {
        const mine = runs.filter((r) => r[0] === i);
        if (!mine.length) cb(i, 0, -1, 0);
        for (const r of mine) cb(i, 0, r[1], 0);
      }
    },
  };
  return { traits, index };
}
const genus = (id: string) => id.split("_")[0]!;
const on = (bits: Uint8Array) => [0, 1, 2, 3].filter((i) => (bits[i >> 3]! >> (i & 7)) & 1);

describe("the filter's answer", () => {
  const { traits, index } = fixture();
  it("one facet: any of its ticks", () => {
    expect(on(galaxyFilterMask({ stars: ["N", "D"] }, index, traits, genus).bits)).toEqual([0, 2]);
    expect(on(galaxyFilterMask({ mainStars: ["M"] }, index, traits, genus).bits)).toEqual([2]);
    expect(on(galaxyFilterMask({ planets: ["elw", "hmc"] }, index, traits, genus).bits)).toEqual([0, 1]);
  });
  it("two facets: all of them", () => {
    const r = galaxyFilterMask({ planets: ["elw", "hmc"], features: ["terraformable"] }, index, traits, genus);
    expect(on(r.bits)).toEqual([1]);
    expect(r.matched).toBe(1);
  });
  it("exobio by genus or species, and with a star facet", () => {
    expect(on(galaxyFilterMask({ genera: ["stratum"] }, index, traits, genus).bits)).toEqual([0]);
    expect(on(galaxyFilterMask({ species: ["bacterium_bacterium_vesicula"] }, index, traits, genus).bits)).toEqual([2]);
    expect(on(galaxyFilterMask({ genera: ["stratum", "bacterium"], stars: ["D"] }, index, traits, genus).bits)).toEqual([2]);
    // A genus nobody recorded narrows to nothing rather than being ignored.
    expect(galaxyFilterMask({ genera: ["anemone"] }, index, traits, genus).matched).toBe(0);
  });
  it("without the traits file, star and body ticks match nothing; exobio still works", () => {
    expect(galaxyFilterMask({ stars: ["N"] }, index, null, genus).matched).toBe(0);
    expect(galaxyFilterMask({ genera: ["stratum"] }, index, null, genus).matched).toBe(1);
  });
});

describe("the file", () => {
  it("round-trips", () => {
    const { traits } = fixture();
    const n = traits.count;
    const pad = (12 + n) % 4 ? 4 - ((12 + n) % 4) : 0;
    const buf = Buffer.alloc(12 + n + pad + n * 8);
    buf.write(TRAITS_MAGIC, 0, "ascii");
    buf.writeUInt32LE(n, 8);
    buf.set(traits.main, 12);
    Buffer.from(traits.stars.buffer).copy(buf, 12 + n + pad);
    Buffer.from(traits.bodies.buffer).copy(buf, 12 + n + pad + n * 4);
    const back = parseSystemTraits(gunzipSync(gzipSync(buf)));
    expect([...back.main]).toEqual([...traits.main]);
    expect([...back.stars]).toEqual([...traits.stars]);
    expect([...back.bodies]).toEqual([...traits.bodies]);
  });
});
