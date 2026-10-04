/**
 * The commander's own systems for the 3D galaxy map (G3, docs/galaxy-plan-28092026.md): where they
 * have been, what they did there, and what is still waiting for them — from their journals, joined to
 * nothing else. The galaxy index is other commanders' records; this is theirs.
 *
 * "Analysed" is his rule (owner, 2026-09-28): a DSS **or** organic scans on foot in a system count;
 * the Next target of G5 skips both.
 */
import type { GameStateStore } from "./gameState.js";
import { footOrganicLocks } from "./organicLocks.js";
import type { BioIndex } from "./bioIndex.js";
import type { BacklogMapDTO, GalaxyMineDTO, GalaxyMySystemDTO, GalaxyRouteDTO } from "../shared/dto/galaxy.js";

/** Bit flags per system (GalaxyMineDTO rows). */
export const MINE_VISITED = 1;
export const MINE_FSS_COMPLETE = 2;
export const MINE_DSS = 4;
export const MINE_ORGANIC = 8;
export const MINE_UNFINISHED = 16;
export const MINE_FIRST_DISCOVERY = 32;
export const MINE_FIRST_FOOTFALL = 64;

interface PerSystem {
  bioBodies: number;
  species: number;
  dss: boolean;
  firstFootfall: boolean;
}

/** One pass over the bodies and the DSS set, per system address. */
function perSystem(store: GameStateStore): Map<number, PerSystem> {
  const out = new Map<number, PerSystem>();
  const get = (addr: number) => {
    let s = out.get(addr);
    if (!s) out.set(addr, (s = { bioBodies: 0, species: 0, dss: false, firstFootfall: false }));
    return s;
  };
  for (const b of store.bodies.values()) {
    const s = get(b.systemAddress);
    if ((b.biologicalSignals ?? 0) > 0) s.bioBodies++;
    s.species += footOrganicLocks(b.organicGenusLocks).length;
    if (store.firstFootfallBodies.has(b.key)) s.firstFootfall = true;
  }
  for (const key of store.dssMappedBodyKeys) {
    const addr = Number(key.slice(0, key.indexOf(":")));
    if (Number.isFinite(addr)) get(addr).dss = true;
  }
  return out;
}

export function mySystemsDto(store: GameStateStore, backlog: BacklogMapDTO): GalaxyMineDTO {
  const per = perSystem(store);
  const unfinished = new Map(backlog.systems.map((s) => [s.systemAddress, s.floorCr]));
  const addrs = new Set<number>([...store.visitedSystems.keys(), ...store.systemPositions.keys()]);
  const systems: GalaxyMineDTO["systems"] = [];
  let unplaceable = 0;
  for (const addr of addrs) {
    const pos = store.systemPositions.get(addr);
    if (!pos) {
      unplaceable++;
      continue;
    }
    const p = per.get(addr);
    let flags = MINE_VISITED;
    if (store.fssAllBodiesCompleteSystems.has(addr)) flags |= MINE_FSS_COMPLETE;
    if (p?.dss) flags |= MINE_DSS;
    if (p && p.species > 0) flags |= MINE_ORGANIC;
    if (unfinished.has(addr)) flags |= MINE_UNFINISHED;
    if (store.commanderDiscoveredSystem(addr) === true) flags |= MINE_FIRST_DISCOVERY;
    if (p?.firstFootfall) flags |= MINE_FIRST_FOOTFALL;
    systems.push({
      addr,
      name: store.visitedSystems.get(addr) ?? "",
      x: pos.x,
      y: pos.y,
      z: pos.z,
      flags,
      bioBodies: p?.bioBodies ?? 0,
      speciesScanned: p?.species ?? 0,
      unfinishedFloorCr: unfinished.get(addr) ?? null,
    });
  }
  return { available: true, systems, unplaceable };
}

/** One of the commander's systems, body by body, and the galaxy index's record of it if it has one. */
export function mySystemDetail(
  store: GameStateStore,
  addr: number,
  backlog: BacklogMapDTO,
  index: BioIndex | null,
): GalaxyMySystemDTO | null {
  const pos = store.systemPositions.get(addr);
  const name = store.visitedSystems.get(addr);
  if (!pos && !name) return null;
  const row = mySystemsDto(store, backlog).systems.find((s) => s.addr === addr);
  const bodies: GalaxyMySystemDTO["bodies"] = [];
  for (const b of store.bodies.values()) {
    if (b.systemAddress !== addr) continue;
    const locks = footOrganicLocks(b.organicGenusLocks);
    if ((b.biologicalSignals ?? 0) === 0 && !locks.length) continue;
    bodies.push({
      name: b.scan?.BodyName ?? `Body ${b.bodyId}`,
      signals: b.biologicalSignals ?? 0,
      dss: store.dssMappedBodyKeys.has(b.key),
      firstFootfall: store.firstFootfallBodies.has(b.key),
      species: locks.map((l) => ({
        name: [l.speciesLocalised, l.variantLocalised && l.variantLocalised !== l.speciesLocalised ? l.variantLocalised : ""]
          .filter(Boolean)
          .join(" — "),
        analysed: l.analysed === true || (l.samples ?? 0) >= 3,
      })),
    });
  }
  bodies.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let indexOrdinal: number | null = null;
  if (index) {
    try {
      const i = index.ordinalOf(BigInt(addr));
      if (i >= 0) indexOrdinal = i;
    } catch {
      /* an address beyond 2^53 does not survive as a number; no join then */
    }
  }
  return {
    addr,
    name: name ?? row?.name ?? "",
    x: pos?.x ?? null,
    y: pos?.y ?? null,
    z: pos?.z ?? null,
    flags: row?.flags ?? MINE_VISITED,
    unfinishedFloorCr: row?.unfinishedFloorCr ?? null,
    bodies,
    indexOrdinal,
  };
}

/**
 * This session's jumps as a line on the map: the session log names the systems, the journal store
 * knows where each one is. The log starts when the app does (no history before that: the store keeps
 * none), and a system whose position was never written is left out rather than guessed.
 */
export function sessionRouteDto(store: GameStateStore, sessionSystems: readonly { name: string; at: string }[]): GalaxyRouteDTO {
  const byName = new Map<string, number>();
  for (const [addr, n] of store.visitedSystems) byName.set(n.toLowerCase(), addr);
  const route: GalaxyRouteDTO["route"] = [];
  for (const s of sessionSystems) {
    const addr = byName.get(s.name.toLowerCase());
    const pos = addr != null ? store.systemPositions.get(addr) : undefined;
    if (pos) route.push({ name: s.name, at: s.at, x: pos.x, y: pos.y, z: pos.z });
  }
  const navRoute: GalaxyRouteDTO["navRoute"] = (store.liveNavRoute ?? []).map((w) => ({
    address: w.systemAddress,
    name: w.starSystem,
    starClass: w.starClass ?? "",
    x: w.starPos[0],
    y: w.starPos[1],
    z: w.starPos[2],
    visited: store.visitedSystems.has(w.systemAddress),
  }));
  return {
    position: store.commanderPos ?? null,
    system: store.currentSystem ?? null,
    route,
    mineRev: `${store.visitedSystems.size}:${store.explorationScansRevision}:${store.dssMappedBodyKeys.size}:${store.bodies.size}`,
    navRoute,
  };
}
