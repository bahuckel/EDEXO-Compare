/**
 * System map layout (clean pass):
 * 1) Stars A,B,C,… in a vertical column (left), alphabetical by primary letter.
 * 2) Stellar mutual barycentres (✕) between their stars on that column, with label clearance.
 *    Inferred multi-letter ✕ (from “ABC n” designations) share the same ✕ column, stacked under the longest
 *    existing bary prefix (e.g. ABCD under journal AB) so they do not collide with planet-row ✕ markers.
 * 3) Planets in one horizontal row per hub (sun or stellar bary), Y = hub’s row; sorted by designation.
 * 4) World–world mutual bary markers sit between their two planets without extra column slots.
 * 5) Moons stack under their parent hub planet (vertical), sorted by designation; nested moons (sub-satellites) are
 *    flattened into that column in sort order with edges from their immediate parent moon (or planet). Moon–moon
 *    mutual barycentres (journal ✕, no star children) are not drawn; their moons are hoisted into this column and
 *    sorted by name like other moons, with edges from the hub planet as a failsafe if the parent disc is missing.
 */
import type { SystemMapNodeDTO } from "@shared/types";
import {
  compareByParsedDesignationOrBodyId,
  parseDesignationTailFromFullBodyName,
  parseShortDesignation,
} from "@shared/eliteDesignation";
import { shortBodyLabel } from "@shared/systemMapLabels";

const R = 22;
const R_BARY = 10;
const PAD = 32;
const COL_PLANET = 104;
const ROW_STAR = 82;
const MOON_V = 56;
const MOON_STACK_GAP = 72;
const SUBSYSTEM_GAP = 36;
/** Minimum vertical gap between one hub’s lowest drawn content and the next hub’s planet row */
const VERTICAL_STACK_GAP = 10;
/** Must match name offset under non-bary nodes in SystemMapModal (approx. below disc). */
const MAP_NAME_UNDER = 13;
/** Extra air under labels so the next row/hub does not clip text. */
const MAP_LABEL_EXTRA_PAD = 10;
const STAR_COLUMN_CX_BASE = PAD + 160;
const HUB_GAP_X = 40;
/** Stellar / multi-letter ✕ markers share this column (to the right of star discs). */
function baryColumnCx(starColumnCx: number): number {
  return starColumnCx + STELLAR_BARY_SHIFT_X;
}
/** Extra right margin when stellar bary hubs extend planets eastward (avoids tight bbox clip) */
const STELLAR_BARY_RIGHT_SLOP = 56;
const BARY_RIM_GAP = 11;
/** Nudge ✕ away from star discs so labels/readout stay legible */
const STELLAR_BARY_SHIFT_X = 2 * R_BARY;
const LINE_OCCLUSION_PAD = 2.8;

export type LayoutSegment = { x1: number; y1: number; x2: number; y2: number };

export type LayoutItem = {
  bodyId: number;
  cx: number;
  cy: number;
  r: number;
  mapLabel: string;
  /** Plain short name under the node */
  bodyName: string;
  /** Includes leading * when terraformable (from journal map label heuristics). */
  displayBodyName?: string;
  namePlus: boolean;
  exoValueTier: 0 | 1 | 2;
  isStar: boolean;
  /** Journal stellar (incl. planet-slot): sun-style map glyph + rays; column hubs still use isStar only. */
  journalStellar?: boolean;
  starVisual: "default" | "neutron";
  ringClass: "exo" | "plain" | "placeholder";
  baseLabel: string;
  isPlaceholder?: boolean;
  isBarycentre?: boolean;
  isArrivalBody?: boolean;
  wasDiscoveredFalse?: boolean;
};

export type LayoutResult = {
  items: LayoutItem[];
  segments: LayoutSegment[];
  bracketSegments: LayoutSegment[];
  minX: number;
  minY: number;
  width: number;
  height: number;
};

type EdgePair = { from: LayoutItem; to: LayoutItem };

function ringClassOf(n: SystemMapNodeDTO): "exo" | "plain" | "placeholder" {
  if (n.isInferredPlaceholder) return "placeholder";
  if (n.isStar || n.journalStellar === true) return "plain";
  return n.hasExobiology ? "exo" : "plain";
}

function effectiveDesignationKey(bodyName: string, starSystemName: string): string {
  const s = shortBodyLabel(bodyName, starSystemName);
  if (parseShortDesignation(s)) return s;
  const t = parseDesignationTailFromFullBodyName(bodyName);
  if (!t) return s;
  const core = t.starLetters ? `${t.starLetters} ${t.major}` : `${t.major}`;
  return t.moon ? `${core} ${t.moon}` : core;
}

function parsedDesignation(bodyName: string, starSystemName: string) {
  const s = shortBodyLabel(bodyName, starSystemName);
  return parseShortDesignation(s) ?? parseDesignationTailFromFullBodyName(bodyName);
}

function compareWorldDesignation(a: SystemMapNodeDTO, b: SystemMapNodeDTO, starSystemName: string): number {
  const sa = effectiveDesignationKey(a.bodyName, starSystemName);
  const sb = effectiveDesignationKey(b.bodyName, starSystemName);
  return compareByParsedDesignationOrBodyId(sa, sb, a.bodyId, b.bodyId);
}

function walkNodes(roots: SystemMapNodeDTO[], fn: (n: SystemMapNodeDTO) => void): void {
  for (const r of roots) {
    inner(r);
  }
  function inner(n: SystemMapNodeDTO) {
    fn(n);
    for (const c of n.children) inner(c);
  }
}

function isStellarBary(n: SystemMapNodeDTO): boolean {
  return n.isBarycentre === true && n.children.some((c) => c.isStar);
}

/** Journal stellar ✕ rendered only when both ends are known stars (≥2 star children on the map). */
function countStellarBaryStarChildren(b: SystemMapNodeDTO): number {
  return b.children.filter((c) => c.isStar).length;
}

function journalStellarBaryForLayout(n: SystemMapNodeDTO): boolean {
  return isStellarBary(n) && countStellarBaryStarChildren(n) >= 2;
}

/** Client-only hubs for “ABC 1” worlds when journal does not expose a named multi-star ✕. */
const SYNTHETIC_INFERRED_STELLAR_BARY_ID = -800_000_000;

function syntheticInferredStellarHub(starLetters: string, bodyId: number): SystemMapNodeDTO {
  return {
    bodyId,
    bodyName: starLetters,
    label: starLetters,
    mapLabel: "×",
    isStar: false,
    hasExobiology: false,
    valuePlus: false,
    maxExoHeuristicCredits: 0,
    exoValueTier: 0,
    namePlus: false,
    starVisual: "default",
    orbitPrimaryKey: "",
    children: [],
    isBarycentre: true,
    semiMajorAxis: null,
    isInferredPlaceholder: false,
  };
}

function isWorldOnlyBary(n: SystemMapNodeDTO): boolean {
  return n.isBarycentre === true && !n.children.some((c) => c.isStar);
}

function flattenWorldsUnderWorldBary(b: SystemMapNodeDTO): SystemMapNodeDTO[] {
  const out: SystemMapNodeDTO[] = [];
  for (const c of b.children) {
    if (c.isStar) continue;
    if (c.isBarycentre && !c.children.some((x) => x.isStar)) out.push(...flattenWorldsUnderWorldBary(c));
    else if (!c.isBarycentre) out.push(c);
  }
  return out;
}

function worldOnlyBaryHasOrbitMoons(b: SystemMapNodeDTO): boolean {
  for (const w of flattenWorldsUnderWorldBary(b)) {
    if (countFlattenedMoonsUnderWorld(w) > 0) return true;
  }
  return false;
}

function starColumnLetterRank(n: SystemMapNodeDTO, starSystemName: string): string {
  const sh = shortBodyLabel(n.bodyName, starSystemName);
  if (sh === "★") return "\uFFFD";
  const p = parseShortDesignation(sh) ?? parseDesignationTailFromFullBodyName(n.bodyName);
  if (p?.starLetters && p.starLetters.length === 1) return p.starLetters;
  const m = sh.match(/^([A-Z])$/i);
  if (m) return m[1]!.toUpperCase();
  return sh;
}

function compareStarsVertical(a: SystemMapNodeDTO, b: SystemMapNodeDTO, starSystemName: string): number {
  const la = starColumnLetterRank(a, starSystemName);
  const lb = starColumnLetterRank(b, starSystemName);
  const c = la.localeCompare(lb, "en", { sensitivity: "base" });
  if (c !== 0) return c;
  return a.bodyId - b.bodyId;
}

/** Depth from planet hub row (disc centerline) to bottom of this planet’s stack, including name under last circle. */
function countFlattenedMoonsUnderWorld(planetNode: SystemMapNodeDTO): number {
  let n = 0;
  function walk(p: SystemMapNodeDTO) {
    for (const c of p.children) {
      if (c.isStar) continue;
      if (isWorldOnlyBary(c)) {
        walk(c);
        continue;
      }
      if (c.isBarycentre) continue;
      n += 1;
      walk(c);
    }
  }
  walk(planetNode);
  return n;
}

function estimatePlanetMoonDepthBelow(planetNode: SystemMapNodeDTO): number {
  const n = countFlattenedMoonsUnderWorld(planetNode);
  const labelPad = MAP_NAME_UNDER + MAP_LABEL_EXTRA_PAD;
  if (n === 0) return R + labelPad;
  const rMoon = R * 0.92;
  return R + MOON_STACK_GAP * 0.82 + (n - 1) * MOON_V + rMoon + labelPad;
}

/**
 * All moons under this planet hub (skipping undrawn moon–moon ✕ nodes), with a layout parent id for edges:
 * direct moon/planet parent, or the hub planet when hoisted from under a world-only barycentre.
 */
function flattenMoonsWithOrbitParent(
  planet: SystemMapNodeDTO,
): { node: SystemMapNodeDTO; orbitParentId: number }[] {
  const rows: { node: SystemMapNodeDTO; orbitParentId: number }[] = [];
  /** `attachId` is the layout parent for orbit lines: planet id when hoisting from a moon–moon bary, else direct parent. */
  function walk(parent: SystemMapNodeDTO, attachId: number) {
    for (const c of parent.children) {
      if (c.isStar) continue;
      if (isWorldOnlyBary(c)) {
        walk(c, attachId);
        continue;
      }
      if (c.isBarycentre) continue;
      rows.push({ node: c, orbitParentId: attachId });
      walk(c, c.bodyId);
    }
  }
  walk(planet, planet.bodyId);
  return rows;
}

function estimateHubMoonDepthBelow(worlds: SystemMapNodeDTO[]): number {
  let maxD = 0;
  for (const w of worlds) maxD = Math.max(maxD, estimatePlanetMoonDepthBelow(w));
  return maxD;
}

/**
 * When a stellar ✕ joins exactly two stars that are adjacent in the vertical column, return the lower star index
 * (i such that the pair is stars[i] & stars[i + 1]). Otherwise null.
 */
function adjacentStellarBaryLowerStarIndex(
  b: SystemMapNodeDTO,
  starsOrdered: SystemMapNodeDTO[],
  starSystemName: string,
): number | null {
  const starChildren = b.children
    .filter((c) => c.isStar)
    .sort((a, b2) => compareStarsVertical(a, b2, starSystemName));
  if (starChildren.length !== 2) return null;
  const i0 = starsOrdered.findIndex((s) => s.bodyId === starChildren[0]!.bodyId);
  const i1 = starsOrdered.findIndex((s) => s.bodyId === starChildren[1]!.bodyId);
  if (i0 < 0 || i1 < 0) return null;
  const lo = Math.min(i0, i1);
  const hi = Math.max(i0, i1);
  if (hi !== lo + 1) return null;
  return lo;
}

function layoutItemFromNode(n: SystemMapNodeDTO, cx: number, cy: number, radius: number): LayoutItem {
  const terraformable = !n.isStar && !n.isBarycentre && !n.isInferredPlaceholder && n.mapLabel.includes("*");
  const displayBodyName = terraformable ? `*${n.bodyName}` : n.bodyName;
  return {
    bodyId: n.bodyId,
    cx,
    cy,
    r: radius,
    mapLabel: n.mapLabel,
    bodyName: n.bodyName,
    displayBodyName,
    namePlus: n.namePlus,
    exoValueTier: n.exoValueTier,
    isStar: n.isStar,
    journalStellar: n.journalStellar === true,
    starVisual: n.starVisual,
    ringClass: ringClassOf(n),
    baseLabel: n.label,
    isPlaceholder: n.isInferredPlaceholder === true,
    isBarycentre: n.isBarycentre === true,
    isArrivalBody: n.isArrivalBody === true,
    wasDiscoveredFalse: n.isUnexplored === true,
  };
}

function effectiveLayoutRadius(it: LayoutItem): number {
  return Math.max(it.r, 2);
}

function layoutDiscsOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
  pad: number,
): boolean {
  const tr = ar + br + pad;
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy < tr * tr;
}

/** Nudge a world–world ✕ downward until its disc does not intersect laid-out planets/moons (hub row shares Y with planets). */
function resolveWorldBaryCyAvoidingItems(cx: number, baseCy: number, items: LayoutItem[]): number {
  const pad = LINE_OCCLUSION_PAD;
  let cy = baseCy;
  for (let step = 0; step < 120; step++) {
    let hit = false;
    for (const it of items) {
      if (layoutDiscsOverlap(cx, cy, R_BARY, it.cx, it.cy, it.r, pad)) {
        hit = true;
        break;
      }
    }
    if (!hit) return cy;
    cy += 6;
  }
  return baseCy + MOON_V;
}

function baryAnchorBetweenTwoDiscs(
  a: LayoutItem,
  b: LayoutItem,
  anchorToStarColumn: boolean,
): { cx: number; cy: number } {
  const gap = BARY_RIM_GAP;
  const shift = anchorToStarColumn ? STELLAR_BARY_SHIFT_X : 0;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    return { cx: a.cx + shift, cy: a.cy - (effectiveLayoutRadius(a) + R_BARY + gap) };
  }
  const ux = dx / len;
  const uy = dy / len;
  const dMin = effectiveLayoutRadius(a) + R_BARY + gap;
  const dMax = len - (effectiveLayoutRadius(b) + R_BARY + gap);
  const half = len * 0.5;
  let d: number;
  if (dMin <= dMax) {
    d = half;
    if (d < dMin) d = dMin;
    if (d > dMax) d = dMax;
  } else {
    d = half;
  }
  return { cx: a.cx + ux * d + shift, cy: a.cy + uy * d };
}

function pushVerticalMoonBracket(
  planetItem: LayoutItem,
  moonItems: LayoutItem[],
  bracketSegments: LayoutSegment[],
): void {
  if (moonItems.length < 2) return;
  const xStem = planetItem.cx - planetItem.r - 12;
  const yTop = moonItems[0]!.cy - moonItems[0]!.r;
  const yBot = moonItems[moonItems.length - 1]!.cy + moonItems[moonItems.length - 1]!.r;
  const hook = 11;
  bracketSegments.push(
    { x1: xStem, y1: yTop, x2: xStem, y2: yBot },
    { x1: xStem, y1: yTop, x2: xStem + hook, y2: yTop },
    { x1: xStem, y1: yBot, x2: xStem + hook, y2: yBot },
  );
}

function layoutMoonsUnderPlanet(
  planetItem: LayoutItem,
  planetNode: SystemMapNodeDTO,
  items: LayoutItem[],
  edges: EdgePair[],
  starSystemName: string,
  bracketSegments: LayoutSegment[],
): number {
  const rows = flattenMoonsWithOrbitParent(planetNode);
  rows.sort((a, b) => compareWorldDesignation(a.node, b.node, starSystemName));
  const itemByBodyId = new Map<number, LayoutItem>();
  itemByBodyId.set(planetNode.bodyId, planetItem);

  let y = planetItem.cy + planetItem.r + MOON_STACK_GAP * 0.82;
  let lowest = planetItem.cy + planetItem.r;
  const moonItems: LayoutItem[] = [];
  for (const { node, orbitParentId } of rows) {
    const parentIt = itemByBodyId.get(orbitParentId) ?? planetItem;
    const moonItem = layoutItemFromNode(node, planetItem.cx, y, R * 0.92);
    items.push(moonItem);
    edges.push({ from: parentIt, to: moonItem });
    itemByBodyId.set(node.bodyId, moonItem);
    moonItems.push(moonItem);
    lowest = Math.max(lowest, y + moonItem.r);
    y += MOON_V;
  }
  moonItems.sort((a, b) => a.cy - b.cy);
  pushVerticalMoonBracket(planetItem, moonItems, bracketSegments);
  const labelPad = MAP_NAME_UNDER + MAP_LABEL_EXTRA_PAD;
  if (moonItems.length === 0) {
    lowest = Math.max(lowest, planetItem.cy + planetItem.r + labelPad);
  } else {
    const last = moonItems[moonItems.length - 1]!;
    lowest = Math.max(lowest, last.cy + last.r + labelPad);
  }
  return lowest;
}

function segmentInsideCircleT(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  cx: number,
  cy: number,
  rad: number,
): [number, number] | null {
  const vx = p2x - p1x;
  const vy = p2y - p1y;
  const wx = p1x - cx;
  const wy = p1y - cy;
  const a = vx * vx + vy * vy;
  if (a < 1e-18) return null;
  const b = 2 * (wx * vx + wy * vy);
  const c = wx * wx + wy * wy - rad * rad;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let t0 = (-b - s) / (2 * a);
  let t1 = (-b + s) / (2 * a);
  if (t0 > t1) [t0, t1] = [t1, t0];
  const lo = Math.max(0, t0);
  const hi = Math.min(1, t1);
  if (hi - lo < 1e-6) return null;
  return [lo, hi];
}

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (intervals.length === 0) return [];
  const s = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cs = s[0]![0];
  let ce = s[0]![1];
  for (let i = 1; i < s.length; i++) {
    const [ns, ne] = s[i]!;
    if (ns <= ce + 1e-9) ce = Math.max(ce, ne);
    else {
      out.push([cs, ce]);
      cs = ns;
      ce = ne;
    }
  }
  out.push([cs, ce]);
  return out;
}

function visibleSegmentsT(blocked: [number, number][]): [number, number][] {
  if (blocked.length === 0) return [[0, 1]];
  const m = mergeIntervals(blocked);
  const vis: [number, number][] = [];
  let cur = 0;
  for (const [bs, be] of m) {
    if (bs > cur + 1e-9) vis.push([cur, Math.min(bs, 1)]);
    cur = Math.max(cur, be);
    if (cur >= 1 - 1e-9) break;
  }
  if (cur < 1 - 1e-9) vis.push([cur, 1]);
  return vis.filter(([a, b]) => b - a > 1e-6);
}

function visibleStraightSegments(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  a: LayoutItem,
  b: LayoutItem,
  obstacles: LayoutItem[],
): LayoutSegment[] {
  const blocked: [number, number][] = [];
  for (const o of obstacles) {
    if (o === a || o === b) continue;
    const hit = segmentInsideCircleT(
      p1x,
      p1y,
      p2x,
      p2y,
      o.cx,
      o.cy,
      effectiveLayoutRadius(o) + LINE_OCCLUSION_PAD,
    );
    if (hit) blocked.push(hit);
  }
  const vx = p2x - p1x;
  const vy = p2y - p1y;
  const parts: LayoutSegment[] = [];
  for (const [ta, tb] of visibleSegmentsT(blocked)) {
    parts.push({
      x1: p1x + ta * vx,
      y1: p1y + ta * vy,
      x2: p1x + tb * vx,
      y2: p1y + tb * vy,
    });
  }
  return parts;
}

function edgeToSegments(a: LayoutItem, b: LayoutItem, obstacles: LayoutItem[]): LayoutSegment[] {
  const ax = a.cx;
  const ay = a.cy;
  const bx = b.cx;
  const by = b.cy;
  const ar = effectiveLayoutRadius(a);
  const br = effectiveLayoutRadius(b);
  const dx = bx - ax;
  const dy = by - ay;
  const ux = dx >= 0 ? 1 : -1;
  const uy = dy >= 0 ? 1 : -1;

  if (Math.abs(dx) < 1.2) {
    const p1x = ax;
    const p1y = ay + ar * uy;
    const p2x = bx;
    const p2y = by - br * uy;
    return visibleStraightSegments(p1x, p1y, p2x, p2y, a, b, obstacles);
  }

  if (Math.abs(dy) < 1.2) {
    const p1x = ax + ar * ux;
    const p1y = ay;
    const p2x = bx - br * ux;
    const p2y = by;
    return visibleStraightSegments(p1x, p1y, p2x, p2y, a, b, obstacles);
  }

  const goHorizontalFirst = Math.abs(dx) >= Math.abs(dy);
  if (goHorizontalFirst) {
    const midX = bx;
    const p1x = ax + ar * ux;
    const p1y = ay;
    const p2x = midX;
    const p2y = ay;
    const leg1 = visibleStraightSegments(p1x, p1y, p2x, p2y, a, b, obstacles);
    const q1x = midX;
    const q1y = ay;
    const q2x = midX;
    const q2y = by - br * uy;
    const leg2 = visibleStraightSegments(q1x, q1y, q2x, q2y, a, b, obstacles);
    return [...leg1, ...leg2];
  }

  const midY = by;
  const p1x = ax;
  const p1y = ay + ar * uy;
  const p2x = ax;
  const p2y = midY;
  const leg1 = visibleStraightSegments(p1x, p1y, p2x, p2y, a, b, obstacles);
  const q1x = ax;
  const q1y = midY;
  const q2x = bx - br * ux;
  const q2y = midY;
  const leg2 = visibleStraightSegments(q1x, q1y, q2x, q2y, a, b, obstacles);
  return [...leg1, ...leg2];
}

function routeAllEdges(items: LayoutItem[], edges: EdgePair[]): LayoutSegment[] {
  const out: LayoutSegment[] = [];
  for (const e of edges) {
    out.push(...edgeToSegments(e.from, e.to, items));
  }
  return out;
}

/** Extra vertical space below a journal ✕ from inferred hubs nested under it (AB → ABCD → …). */
function stackDepthUnderBaryParent(
  parentId: number,
  inferredLetterHubs: { L: string; bodyId: number; hostStarId: number }[],
  multiLetterToBaryId: Map<string, number>,
  hubToWorlds: Map<number, SystemMapNodeDTO[]>,
): number {
  const direct = inferredLetterHubs
    .filter((h) => {
      const pr = longestMultiLetterBaryPrefix(h.L, multiLetterToBaryId);
      return pr != null && multiLetterToBaryId.get(pr) === parentId;
    })
    .sort((a, b) => a.L.length - b.L.length || a.L.localeCompare(b.L));
  let acc = 0;
  for (const h of direct) {
    const w = hubToWorlds.get(h.bodyId) ?? [];
    const chunk =
      VERTICAL_STACK_GAP + R_BARY + estimateHubMoonDepthBelow(w) + MAP_NAME_UNDER + MAP_LABEL_EXTRA_PAD;
    acc += chunk + stackDepthUnderBaryParent(h.bodyId, inferredLetterHubs, multiLetterToBaryId, hubToWorlds);
  }
  return acc;
}

function resolveHubIdForWorld(
  n: SystemMapNodeDTO,
  starSystemName: string,
  letterToStarId: Map<string, number>,
  multiLetterToBaryId: Map<string, number>,
  primaryStarId: number | null,
): number | null {
  const p = parsedDesignation(n.bodyName, starSystemName);
  if (!p || p.moon) return null;
  const L = p.starLetters;
  if (L.length >= 2) return multiLetterToBaryId.get(L) ?? null;
  if (L.length === 1) return letterToStarId.get(L) ?? null;
  return primaryStarId;
}

function buildLetterStarMap(sortedStars: SystemMapNodeDTO[]): Map<string, number> {
  const m = new Map<string, number>();
  sortedStars.forEach((s, i) => {
    m.set(String.fromCharCode(65 + i), s.bodyId);
  });
  return m;
}

function stellarBaryLetterKey(
  bary: SystemMapNodeDTO,
  starSystemName: string,
  starById: Map<number, SystemMapNodeDTO>,
): string {
  const stars = bary.children
    .filter((c) => c.isStar)
    .sort((a, b) => compareStarsVertical(a, b, starSystemName));
  return stars
    .map((s) => starColumnLetterRank(s, starSystemName))
    .join("")
    .toUpperCase();
}

/** Longest `multiLetterToBaryId` key that is a strict prefix of L (e.g. AB for ABCD). */
function longestMultiLetterBaryPrefix(L: string, multiLetterToBaryId: Map<string, number>): string | null {
  let best: string | null = null;
  for (const k of multiLetterToBaryId.keys()) {
    if (k.length >= L.length) continue;
    if (!L.startsWith(k)) continue;
    if (best == null || k.length > best.length) best = k;
  }
  return best;
}

function isRootInferredMultiLetterHub(L: string, multiLetterToBaryId: Map<string, number>): boolean {
  return longestMultiLetterBaryPrefix(L, multiLetterToBaryId) == null;
}

/** Bottom Y of hub + its planet row / moon stack (estimate), including label padding below. */
function hubSubtreeEstimatedBottom(hubCy: number, worlds: SystemMapNodeDTO[]): number {
  return hubCy + estimateHubMoonDepthBelow(worlds) + MAP_NAME_UNDER + MAP_LABEL_EXTRA_PAD;
}

/**
 * Lay one hub’s planets: sorted bodies, optional mutual ✕ between the two planets of a world-only bary.
 */
function layoutHubPlanetRow(params: {
  hubItem: LayoutItem;
  worlds: SystemMapNodeDTO[];
  mutualBaries: SystemMapNodeDTO[];
  starSystemName: string;
  items: LayoutItem[];
  edges: EdgePair[];
  bracketSegments: LayoutSegment[];
  starColumnCx: number;
}): number {
  const { hubItem, worlds, mutualBaries, starSystemName, items, edges, bracketSegments, starColumnCx } =
    params;
  const cy = hubItem.cy;
  const sorted = [...new Map(worlds.map((w) => [w.bodyId, w])).values()].sort((a, b) =>
    compareWorldDesignation(a, b, starSystemName),
  );

  const worldIdsWithDrawableBary = new Set<number>();
  for (const b of mutualBaries) {
    if (!worldOnlyBaryHasOrbitMoons(b)) continue;
    for (const w of flattenWorldsUnderWorldBary(b)) worldIdsWithDrawableBary.add(w.bodyId);
  }

  const x0 = starColumnCx + R + HUB_GAP_X;
  const labelPad = MAP_NAME_UNDER + MAP_LABEL_EXTRA_PAD;
  let bottom = cy + R + labelPad;
  if (sorted.length === 0) return bottom;

  const planetItems: LayoutItem[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i]!;
    const pit = layoutItemFromNode(w, x0 + i * COL_PLANET, cy, R);
    items.push(pit);
    planetItems.push(pit);
    if (!worldIdsWithDrawableBary.has(w.bodyId)) edges.push({ from: hubItem, to: pit });
    bottom = Math.max(bottom, layoutMoonsUnderPlanet(pit, w, items, edges, starSystemName, bracketSegments));
  }

  const idToItem = new Map<number, LayoutItem>();
  for (let i = 0; i < sorted.length; i++) idToItem.set(sorted[i]!.bodyId, planetItems[i]!);

  for (const b of mutualBaries) {
    const inner = flattenWorldsUnderWorldBary(b);
    if (inner.length < 2) continue;
    if (!worldOnlyBaryHasOrbitMoons(b)) continue;
    const idx = inner.map((w) => sorted.findIndex((x) => x.bodyId === w.bodyId)).filter((j) => j >= 0);
    if (idx.length < 2) continue;
    const iLo = Math.min(...idx);
    const iHi = Math.max(...idx);
    const leftIt = planetItems[iLo]!;
    const rightIdx = inner.length > 2 ? Math.min(iLo + 1, iHi) : iHi;
    const rightIt = planetItems[rightIdx]!;
    const raw = baryAnchorBetweenTwoDiscs(leftIt, rightIt, false);
    const baryCy = resolveWorldBaryCyAvoidingItems(raw.cx, cy, items);
    const bIt = layoutItemFromNode(b, raw.cx, baryCy, R_BARY);
    items.push(bIt);
    edges.push({ from: hubItem, to: bIt });
    for (const w of inner) {
      const pt = idToItem.get(w.bodyId);
      if (pt) edges.push({ from: bIt, to: pt });
    }
    bottom = Math.max(bottom, baryCy + R_BARY + 28 + MAP_LABEL_EXTRA_PAD);
  }

  return Math.max(bottom, cy + R + labelPad);
}

/**
 * When {@link explorationRecordIsStellar} temporarily yields zero `isStar` nodes (partial FSS: companions
 * with `BodyType: Planet`, empty `PlanetClass`, no `StellarMass` yet), the main hub layout adds no discs.
 * Collect baries + non-moon worlds (+ any `isStar` nodes) and stack them so the map never goes blank.
 */
function collectFallbackDrawableNodes(all: SystemMapNodeDTO[], sys: string): SystemMapNodeDTO[] {
  const byId = new Map<number, SystemMapNodeDTO>();
  for (const n of all) {
    if (n.isStar) {
      byId.set(n.bodyId, n);
      continue;
    }
    if (n.isBarycentre) {
      byId.set(n.bodyId, n);
      continue;
    }
    const p = parsedDesignation(n.bodyName, sys);
    if (p && !p.moon) byId.set(n.bodyId, n);
  }
  let nodes = [...byId.values()];
  if (nodes.length === 0 && all.length > 0) {
    byId.clear();
    for (const n of all) byId.set(n.bodyId, n);
    nodes = [...byId.values()];
  }
  nodes.sort((a, b) => {
    const ra = a.isBarycentre ? 0 : a.isStar ? 1 : 2;
    const rb = b.isBarycentre ? 0 : b.isStar ? 1 : 2;
    if (ra !== rb) return ra - rb;
    return compareWorldDesignation(a, b, sys) || a.bodyId - b.bodyId;
  });
  return nodes;
}

function computeFallbackSystemMapLayout(
  all: SystemMapNodeDTO[],
  sys: string,
  starColumnCx: number,
): LayoutResult {
  const nodes = collectFallbackDrawableNodes(all, sys);
  const items: LayoutItem[] = [];
  let y = PAD + R;
  const x = starColumnCx;
  for (const n of nodes) {
    const rad = n.isBarycentre ? R_BARY : R;
    items.push(layoutItemFromNode(n, x, y, rad));
    y += n.isBarycentre ? MOON_V * 0.9 : ROW_STAR;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    minX = Math.min(minX, it.cx - it.r);
    minY = Math.min(minY, it.cy - it.r);
    maxX = Math.max(maxX, it.cx + it.r);
    maxY = Math.max(maxY, it.cy + it.r + MAP_NAME_UNDER + MAP_LABEL_EXTRA_PAD + 6);
  }
  if (!Number.isFinite(minX) || items.length === 0) {
    minX = 0;
    minY = 0;
    maxX = starColumnCx + COL_PLANET * 2;
    maxY = 240;
  }
  minX -= PAD;
  minY -= PAD;
  maxX += PAD;
  maxY += PAD;
  return {
    items,
    segments: [],
    bracketSegments: [],
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function computeSystemMapLayout(roots: SystemMapNodeDTO[], starSystemName: string): LayoutResult {
  const sys = starSystemName.trim();
  const items: LayoutItem[] = [];
  const edges: EdgePair[] = [];
  const bracketSegments: LayoutSegment[] = [];
  const starColumnCx = STAR_COLUMN_CX_BASE;

  const all: SystemMapNodeDTO[] = [];
  walkNodes(roots, (n) => all.push(n));

  const stars = all.filter((n) => n.isStar).sort((a, b) => compareStarsVertical(a, b, sys));
  /** Journal ✕ with exactly two (or more) known suns; single-end “stellar” journal nodes stay in the DTO tree but are not drawn. */
  const journalStellarLayout = all.filter(journalStellarBaryForLayout);
  const worldOnlyBariesAll = all.filter(isWorldOnlyBary);
  const worldsAll = all.filter((n) => {
    if (n.isStar || n.isBarycentre) return false;
    const p = parsedDesignation(n.bodyName, sys);
    return p != null && !p.moon;
  });

  const starById = new Map(stars.map((s) => [s.bodyId, s]));
  const letterToStarId = buildLetterStarMap(stars);
  const primaryStarId =
    stars.find((s) => s.isArrivalBody)?.bodyId ??
    (stars.length === 1 ? (stars[0]?.bodyId ?? null) : null) ??
    stars[0]?.bodyId ??
    null;

  const multiLetterToBaryId = new Map<string, number>();
  for (const b of journalStellarLayout) {
    const key = stellarBaryLetterKey(b, sys, starById);
    if (/^[A-Z]{2,}$/.test(key)) {
      multiLetterToBaryId.set(key, b.bodyId);
    }
  }

  type InferredLetterHub = { L: string; bodyId: number; hostStarId: number };
  const inferredLetterHubs: InferredLetterHub[] = [];
  let nextSyntheticId = SYNTHETIC_INFERRED_STELLAR_BARY_ID - 1;

  const worldsWithMultiLetters = worldsAll
    .filter((w) => {
      const p = parsedDesignation(w.bodyName, sys);
      return p != null && !p.moon && p.starLetters.length >= 2;
    })
    .sort((a, b) => compareWorldDesignation(a, b, sys));

  const seenLetterGroup = new Set<string>();
  for (const w of worldsWithMultiLetters) {
    const p = parsedDesignation(w.bodyName, sys)!;
    const L = p.starLetters;
    if (!/^[A-Z]{2,}$/.test(L)) continue;
    if (seenLetterGroup.has(L)) continue;
    seenLetterGroup.add(L);
    if (multiLetterToBaryId.has(L)) continue;
    const first = L[0]!;
    if (first < "A" || first > "Z") continue;
    const hostStarId = letterToStarId.get(first) ?? primaryStarId;
    if (hostStarId == null) continue;
    const bodyId = nextSyntheticId--;
    multiLetterToBaryId.set(L, bodyId);
    inferredLetterHubs.push({ L, bodyId, hostStarId });
  }

  /** Worlds → hub (needed before vertical packing of stars / baries) */
  const hubToWorlds = new Map<number, SystemMapNodeDTO[]>();
  const hubToMutual = new Map<number, SystemMapNodeDTO[]>();
  for (const w of worldsAll) {
    const hid = resolveHubIdForWorld(w, sys, letterToStarId, multiLetterToBaryId, primaryStarId);
    if (hid == null) continue;
    let list = hubToWorlds.get(hid);
    if (!list) {
      list = [];
      hubToWorlds.set(hid, list);
    }
    list.push(w);
  }

  for (const b of worldOnlyBariesAll) {
    const inner = flattenWorldsUnderWorldBary(b);
    const h0 = inner[0];
    if (!h0) continue;
    const hid = resolveHubIdForWorld(h0, sys, letterToStarId, multiLetterToBaryId, primaryStarId);
    if (hid == null) continue;
    let list = hubToMutual.get(hid);
    if (!list) {
      list = [];
      hubToMutual.set(hid, list);
    }
    list.push(b);
  }

  /** Vertical reservation under a star for inferred hubs that stack from the star (not under a longer bary prefix). */
  function totalInferredStackDepthBelowStar(hostStarId: number): number {
    const mine = inferredLetterHubs.filter(
      (h) => h.hostStarId === hostStarId && isRootInferredMultiLetterHub(h.L, multiLetterToBaryId),
    );
    if (mine.length === 0) return 0;
    let acc = 0;
    for (const h of mine) {
      const dW = estimateHubMoonDepthBelow(hubToWorlds.get(h.bodyId) ?? []);
      acc += VERTICAL_STACK_GAP + R_BARY + dW;
    }
    return acc;
  }

  const baryBetweenAdjacentStars = new Map<number, SystemMapNodeDTO>();
  for (const b of journalStellarLayout) {
    const lo = adjacentStellarBaryLowerStarIndex(b, stars, sys);
    if (lo != null) baryBetweenAdjacentStars.set(lo, b);
  }

  const starY: number[] = [];
  /** Precomputed Y for stellar ✕ when it sits between two adjacent column stars (not geometric midpoint). */
  const stellarBaryCyById = new Map<number, number>();

  for (let i = 0; i < stars.length; i++) {
    if (i === 0) {
      starY[i] = PAD + R;
      continue;
    }
    const prevStar = stars[i - 1]!;
    const dPlanets = estimateHubMoonDepthBelow(hubToWorlds.get(prevStar.bodyId) ?? []);
    const dInferred = totalInferredStackDepthBelowStar(prevStar.bodyId);
    const dPrev = dPlanets + dInferred;
    const baryNode = baryBetweenAdjacentStars.get(i - 1);

    if (baryNode) {
      const dBaryBase = estimateHubMoonDepthBelow(hubToWorlds.get(baryNode.bodyId) ?? []);
      const dBaryNested = stackDepthUnderBaryParent(
        baryNode.bodyId,
        inferredLetterHubs,
        multiLetterToBaryId,
        hubToWorlds,
      );
      const dBary = dBaryBase + dBaryNested;
      /** Clear only the upper star’s moon column; tight when that star has no moons. */
      const baryCy = starY[i - 1]! + 2 * R + dPrev + VERTICAL_STACK_GAP;
      stellarBaryCyById.set(baryNode.bodyId, baryCy);
      /** Lower star clears the bary’s moon column only. */
      let nextStarY = baryCy + 2 * R + dBary + VERTICAL_STACK_GAP;
      nextStarY = Math.max(nextStarY, starY[i - 1]! + ROW_STAR);
      starY[i] = nextStarY;
    } else {
      let nextY = starY[i - 1]! + 2 * R + dPrev + VERTICAL_STACK_GAP;
      nextY = Math.max(nextY, starY[i - 1]! + ROW_STAR);
      starY[i] = nextY;
    }
  }

  /** Star layout items by bodyId */
  const itemById = new Map<number, LayoutItem>();
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i]!;
    const it = layoutItemFromNode(s, starColumnCx, starY[i]!, R);
    items.push(it);
    itemById.set(s.bodyId, it);
  }

  const baryCx = baryColumnCx(starColumnCx);
  /** Next center-Y available for a ✕ stacked under this parent hub (star or bary bodyId). */
  const stackNextCyByParentId = new Map<number, number>();

  for (const s of stars) {
    const it = itemById.get(s.bodyId);
    if (!it) continue;
    const sw = hubToWorlds.get(s.bodyId) ?? [];
    stackNextCyByParentId.set(s.bodyId, hubSubtreeEstimatedBottom(it.cy, sw) + VERTICAL_STACK_GAP + R_BARY);
  }

  /** Journal stellar ✕ first so inferred multi-letter hubs can nest under them (same column as other ✕). */
  for (const b of journalStellarLayout) {
    const starChildren = b.children.filter((c) => c.isStar);
    const starItems = starChildren
      .map((s) => itemById.get(s.bodyId))
      .filter((x): x is LayoutItem => x != null)
      .sort((a, c) => a.cy - c.cy);

    if (starItems.length < 2) continue;

    let bx: number;
    let by: number;

    const presetCy = stellarBaryCyById.get(b.bodyId);
    if (presetCy != null) {
      bx = baryCx;
      by = presetCy;
    } else {
      const lo = starItems[0]!;
      const hi = starItems[starItems.length - 1]!;
      const p = baryAnchorBetweenTwoDiscs(lo, hi, true);
      bx = p.cx;
      by = p.cy;
    }

    const bit = layoutItemFromNode(b, bx, by, R_BARY);
    items.push(bit);
    itemById.set(b.bodyId, bit);
    for (const s of starItems) edges.push({ from: bit, to: s });

    const bw = hubToWorlds.get(b.bodyId) ?? [];
    stackNextCyByParentId.set(b.bodyId, hubSubtreeEstimatedBottom(by, bw) + VERTICAL_STACK_GAP + R_BARY);
  }

  /**
   * Inferred “ABC” hubs: same ✕ column as journal stellar baries; nested under longest bary prefix
   * (ABCD under AB). Root inferred hubs stack from their host star.
   */
  const hubsSorted = [...inferredLetterHubs].sort(
    (a, b) => a.L.length - b.L.length || a.L.localeCompare(b.L) || a.hostStarId - b.hostStarId,
  );
  for (const h of hubsSorted) {
    const starIt = itemById.get(h.hostStarId);
    if (!starIt) continue;
    const prefix = longestMultiLetterBaryPrefix(h.L, multiLetterToBaryId);
    let inferY: number;
    if (prefix != null) {
      const pid = multiLetterToBaryId.get(prefix)!;
      const queued = stackNextCyByParentId.get(pid);
      if (queued != null) {
        inferY = queued;
      } else {
        const pit = itemById.get(pid);
        const pw = hubToWorlds.get(pid) ?? [];
        if (pit != null) {
          inferY = hubSubtreeEstimatedBottom(pit.cy, pw) + VERTICAL_STACK_GAP + R_BARY;
        } else {
          const hostWorlds = hubToWorlds.get(h.hostStarId) ?? [];
          const dHost =
            hostWorlds.length > 0 ? estimateHubMoonDepthBelow(hostWorlds) : starIt.r + MOON_STACK_GAP * 0.82;
          inferY = starIt.cy + dHost + VERTICAL_STACK_GAP + R_BARY;
        }
      }
    } else {
      const queued = stackNextCyByParentId.get(h.hostStarId);
      if (queued != null) {
        inferY = queued;
      } else {
        const hostWorlds = hubToWorlds.get(h.hostStarId) ?? [];
        const dHost =
          hostWorlds.length > 0 ? estimateHubMoonDepthBelow(hostWorlds) : starIt.r + MOON_STACK_GAP * 0.82;
        inferY = starIt.cy + dHost + VERTICAL_STACK_GAP + R_BARY;
      }
    }
    const dto = syntheticInferredStellarHub(h.L, h.bodyId);
    const bit = layoutItemFromNode(dto, baryCx, inferY, R_BARY);
    items.push(bit);
    itemById.set(h.bodyId, bit);
    const hw = hubToWorlds.get(h.bodyId) ?? [];
    const fullTail = hubSubtreeEstimatedBottom(inferY, hw);
    stackNextCyByParentId.set(h.bodyId, fullTail + VERTICAL_STACK_GAP + R_BARY);
    if (prefix != null) {
      const pid = multiLetterToBaryId.get(prefix)!;
      stackNextCyByParentId.set(pid, fullTail + VERTICAL_STACK_GAP + R_BARY);
    } else {
      stackNextCyByParentId.set(h.hostStarId, fullTail + VERTICAL_STACK_GAP + R_BARY);
    }
  }

  let maxBottom = PAD;
  for (const s of stars) {
    const it = itemById.get(s.bodyId);
    if (!it) continue;
    const ws = hubToWorlds.get(s.bodyId) ?? [];
    const mb = hubToMutual.get(s.bodyId) ?? [];
    const btm = layoutHubPlanetRow({
      hubItem: it,
      worlds: ws,
      mutualBaries: mb,
      starSystemName: sys,
      items,
      edges,
      bracketSegments,
      starColumnCx,
    });
    maxBottom = Math.max(maxBottom, btm);
  }
  for (const b of journalStellarLayout) {
    const it = itemById.get(b.bodyId);
    if (!it) continue;
    const ws = hubToWorlds.get(b.bodyId) ?? [];
    const mb = hubToMutual.get(b.bodyId) ?? [];
    const btm = layoutHubPlanetRow({
      hubItem: it,
      worlds: ws,
      mutualBaries: mb,
      starSystemName: sys,
      items,
      edges,
      bracketSegments,
      starColumnCx,
    });
    maxBottom = Math.max(maxBottom, btm);
  }
  for (const h of inferredLetterHubs) {
    const it = itemById.get(h.bodyId);
    if (!it) continue;
    const ws = hubToWorlds.get(h.bodyId) ?? [];
    const btm = layoutHubPlanetRow({
      hubItem: it,
      worlds: ws,
      mutualBaries: [],
      starSystemName: sys,
      items,
      edges,
      bracketSegments,
      starColumnCx,
    });
    maxBottom = Math.max(maxBottom, btm);
  }

  if (items.length === 0 && all.length > 0) {
    return computeFallbackSystemMapLayout(all, sys, starColumnCx);
  }

  let maxRight = starColumnCx + 400;
  for (const it of items) maxRight = Math.max(maxRight, it.cx + it.r + COL_PLANET);
  const stellarBaryHasPlanets =
    journalStellarLayout.some((b) => (hubToWorlds.get(b.bodyId)?.length ?? 0) > 0) ||
    inferredLetterHubs.some((h) => (hubToWorlds.get(h.bodyId)?.length ?? 0) > 0);
  if (stellarBaryHasPlanets) maxRight += STELLAR_BARY_RIGHT_SLOP;

  const segments = routeAllEdges(items, edges);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    minX = Math.min(minX, it.cx - it.r);
    minY = Math.min(minY, it.cy - it.r);
    maxX = Math.max(maxX, it.cx + it.r);
    maxY = Math.max(maxY, it.cy + it.r + MAP_NAME_UNDER + MAP_LABEL_EXTRA_PAD + 6);
  }
  for (const s of [...segments, ...bracketSegments]) {
    minX = Math.min(minX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxX = Math.max(maxX, s.x1, s.x2);
    maxY = Math.max(maxY, s.y1, s.y2);
  }
  maxX = Math.max(maxX, maxRight);
  minX -= PAD;
  minY -= PAD;
  maxX += PAD;
  maxY += PAD;

  return {
    items,
    segments,
    bracketSegments,
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
