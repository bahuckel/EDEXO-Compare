import type { BodyComputed, SystemMapBodyDetailDTO, SystemMapSnapshot } from "@shared/types";
import { compareByParsedDesignationOrBodyId } from "@shared/eliteDesignation";
import { shortBodyLabel } from "@shared/systemMapLabels";

export type BodyOrbitGroup = {
  key: string;
  label: string;
  bodyKeys: Set<string>;
};

/** Group bio bodies by journal/map parent body id when system map details exist. */
export function buildBodyOrbitGroups(
  bodies: BodyComputed[],
  systemMap: SystemMapSnapshot | null | undefined,
): BodyOrbitGroup[] {
  if (!bodies.length) {
    return [{ key: "all", label: "Bodies", bodyKeys: new Set() }];
  }
  const map = systemMap?.detailsByBodyId;
  if (!map) {
    return [{ key: "all", label: "Bodies", bodyKeys: new Set(bodies.map((b) => b.state.key)) }];
  }
  const byGroup = new Map<string, BodyComputed[]>();
  for (const b of bodies) {
    const pid = map[String(b.state.bodyId)]?.parentBodyId;
    const gKey = pid == null ? "root" : `p-${pid}`;
    const arr = byGroup.get(gKey) ?? [];
    arr.push(b);
    byGroup.set(gKey, arr);
  }
  const labelFor = (gKey: string): string => {
    if (gKey === "root") return "Primary orbits";
    const pid = Number(gKey.slice(2));
    if (!Number.isFinite(pid)) return gKey;
    const p = map[String(pid)];
    return p?.bodyName?.trim() ? `Near ${p.bodyName}` : `Parent body ${pid}`;
  };
  return [...byGroup.entries()].map(([key, bs]) => ({
    key,
    label: labelFor(key),
    bodyKeys: new Set(bs.map((x) => x.state.key)),
  }));
}

/** Innermost world that is still under the same “planet + moons” subtree (parent chain until star / YSO / mutual bary). */
function rootClusterBodyId(bodyId: number, map: Record<string, SystemMapBodyDetailDTO>): number {
  let cur = bodyId;
  for (let depth = 0; depth < 64; depth++) {
    const d = map[String(cur)];
    if (!d || d.parentBodyId == null) return cur;
    const p = d.parentBodyId;
    const pd = map[String(p)];
    if (!pd) return cur;
    if (pd.isStar === true || pd.journalStellar === true || pd.isMutualBarycentre === true) return cur;
    cur = p;
  }
  return cur;
}

function compareNameDesignation(
  bodyNameA: string,
  idA: number,
  bodyNameB: string,
  idB: number,
  starSys: string,
): number {
  const sa = shortBodyLabel(bodyNameA, starSys);
  const sb = shortBodyLabel(bodyNameB, starSys);
  return compareByParsedDesignationOrBodyId(sa, sb, idA, idB);
}

/**
 * One outlined strip card per host world + its moons (map parents). Order: hub first, then moons by designation.
 * Without system map details, returns a single group so tabs still work.
 */
export function groupTabBodiesIntoHostCards(
  bodies: BodyComputed[],
  systemMap: SystemMapSnapshot | null | undefined,
): BodyComputed[][] {
  if (bodies.length === 0) return [];
  if (bodies.length === 1) return [bodies];
  const map = systemMap?.detailsByBodyId;
  const starSys = systemMap?.starSystem?.trim() || bodies[0]!.state.starSystem?.trim() || "";
  if (!map) return [bodies];

  const rootOf = (id: number) => rootClusterBodyId(id, map);

  const buckets = new Map<number, BodyComputed[]>();
  for (const b of bodies) {
    const r = rootOf(b.state.bodyId);
    const arr = buckets.get(r) ?? [];
    arr.push(b);
    buckets.set(r, arr);
  }

  const sortGroup = (arr: BodyComputed[]): BodyComputed[] => {
    const root = rootOf(arr[0]!.state.bodyId);
    return [...arr].sort((a, b) => {
      if (a.state.bodyId === root) return -1;
      if (b.state.bodyId === root) return 1;
      return compareNameDesignation(a.state.bodyName, a.state.bodyId, b.state.bodyName, b.state.bodyId, starSys);
    });
  };

  const groups = [...buckets.values()].map(sortGroup);
  groups.sort((ga, gb) => {
    const ra = rootOf(ga[0]!.state.bodyId);
    const rb = rootOf(gb[0]!.state.bodyId);
    const na = map[String(ra)]?.bodyName ?? ga[0]!.state.bodyName;
    const nb = map[String(rb)]?.bodyName ?? gb[0]!.state.bodyName;
    return compareNameDesignation(na, ra, nb, rb, starSys);
  });

  return groups;
}
