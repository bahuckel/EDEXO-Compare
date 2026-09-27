/**
 * System map layout, rebuilt to read like the game's own map (owner, 2026-09-27, with a screenshot of
 * Tegnae IJ-A b58-0 as the reference). Replaces the rule-by-rule `systemMapGeometry.ts`.
 *
 * What the game draws, and so what this lays out:
 * - **Stars in one column**, top to bottom in designation order. Pairs and their nesting are joined
 *   by brackets on the column's **left**: each member has a short tick to a vertical rail, and the
 *   rail's own tick goes one step further left to the parent's rail.
 * - A **barycentre that has planets** shows as an × in the column, between its members (the game's
 *   A, B, ×ABC, C, D); its planets run right from the ×.
 * - **Planets** run right from their star on one line, in designation order.
 *   Planet pairs get the same bracket turned sideways: ticks **up** to a rail above the pair.
 * - **Moons** hang under their planet in a column; moon pairs get the column bracket on the left.
 *
 * Everything is measured before it is placed: a planet's slot holds its label, its moons, their
 * brackets and marks; a row holds its slots; the column stacks rows. Nothing is positioned by a
 * special case, so nothing can overlap — the constants below are gaps, not fixes.
 *
 * Pure: tree in, geometry out. The drawing (`SystemMapDrawing.tsx`) decides how things look.
 */
import type { SystemMapBodyDetailDTO, SystemMapNodeDTO } from "@shared/types";
import {
  compareByParsedDesignationOrBodyId,
  parseDesignationTailFromFullBodyName,
  parseShortDesignation,
} from "@shared/eliteDesignation";

export type MapItemKind = "star" | "hub" | "planet" | "moon" | "bary";

/** Star families the drawing colours and sizes by (the game's own grouping). */
export type StarClassKey =
  | "O"
  | "B"
  | "A"
  | "F"
  | "G"
  | "K"
  | "M"
  | "L"
  | "T"
  | "Y"
  | "TTS"
  | "AeBe"
  | "W"
  | "C"
  | "S"
  | "D"
  | "N"
  | "H"
  | "X";

export interface MapItem {
  id: number;
  node: SystemMapNodeDTO;
  /**
   * `star` a star in the column; `hub` the × of a barycentre with planets (in the column, or an
   * inferred one); `planet` on a row; `moon` in a planet's column; `bary` the × on a pair bracket.
   */
  kind: MapItemKind;
  cx: number;
  cy: number;
  r: number;
  /** Stars, and star-like bodies in a planet slot (brown dwarfs, protostars). */
  starClass?: StarClassKey;
  giant?: boolean;
  /** Where the name goes: under the icon (column, rows) or to its right (moons). */
  nameX: number;
  nameY: number;
  nameAnchor: "middle" | "start";
  /** Second name line under a star: its full class ("M7 VA"). */
  subName?: string;
  /** The body this one orbits on the map (a barycentre id when it orbits one). */
  parentId: number | null;
  /** An × the layout made up from designations ("ABC 1") because the journal had no barycentre. */
  inferred?: boolean;
}

export interface MapLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "orbit" | "bracket";
  /** Bodies this piece of line connects — lit when any of them is on the hovered chain. */
  ids: number[];
}

export interface MapBelt {
  cx: number;
  cy: number;
  w: number;
}

export interface MapLayout {
  items: MapItem[];
  lines: MapLine[];
  belts: MapBelt[];
  /** What each body (and each barycentre, drawn or not) orbits on the map. */
  parents: Map<number, number | null>;
  minX: number;
  minY: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------------------------
// Sizes and gaps (map units; the view scales them all together).

/** Name font size; the drawing uses the same value. */
export const NAME_FONT = 9.5;
/** Room round an icon for its atmosphere ring and landable arc. */
export const MARK_PAD = 7;
/** Room above an icon for the bio badge and the you-are-here marker. */
const TOP_MARKS = 15;
const LABEL_GAP = 4;
const LABEL_H = 11;
const PLANET_GAP = 16;
const MIN_SLOT = 40;
const MOON_GAP = 6;
const ROW_GAP = 16;
/** From the widest hub's edge to the first planet. */
const ROW_LEAD = 34;
const BELT_W = 26;
/** One bracket nesting level. */
const STEP = 9;
/** First rail's distance from the icons it joins. */
const RAIL_OUT = 7;
export const R_BARY = 4.5;
const R_HUB = 6;
const PAD = 28;

export function textWidth(s: string, font = NAME_FONT): number {
  return s.length * font * 0.58;
}

/** Star family from the journal's `StarType` (e.g. `M`, `DA`, `K_OrangeGiant`, `SupermassiveBlackHole`). */
export function starClassOf(
  starType: string | undefined,
  glyph?: string,
): { key: StarClassKey; giant: boolean } {
  const raw = (starType ?? "").trim();
  const giant = /giant/i.test(raw);
  if (raw) {
    if (/^(H|SupermassiveBlackHole)$/i.test(raw)) return { key: "H", giant: false };
    if (/^N$/i.test(raw)) return { key: "N", giant: false };
    if (/^D/i.test(raw)) return { key: "D", giant: false };
    if (/^TTS$/i.test(raw)) return { key: "TTS", giant };
    if (/^AeBe$/i.test(raw)) return { key: "AeBe", giant };
    if (/^W/i.test(raw)) return { key: "W", giant };
    if (/^(C|CN|CJ|CH|CHd|CS)$/i.test(raw)) return { key: "C", giant };
    if (/^(MS|S)$/i.test(raw)) return { key: "S", giant };
    const first = raw.charAt(0).toUpperCase();
    if ("OBAFGKMLTY".includes(first)) return { key: first as StarClassKey, giant };
    return { key: "X", giant };
  }
  const g = (glyph ?? "").replace(/\+/g, "").trim().toUpperCase();
  if (g && "OBAFGKMLTYDNW".includes(g.charAt(0))) return { key: g.charAt(0) as StarClassKey, giant: false };
  return { key: "X", giant: false };
}

const STAR_R: Record<StarClassKey, number> = {
  O: 30,
  B: 28,
  A: 27,
  F: 26,
  G: 25,
  K: 24,
  M: 23,
  L: 21,
  T: 20,
  Y: 19,
  TTS: 22,
  AeBe: 24,
  W: 26,
  C: 26,
  S: 26,
  D: 15,
  N: 13,
  H: 16,
  X: 22,
};

export function starRadius(key: StarClassKey, giant: boolean): number {
  return STAR_R[key] + (giant ? 6 : 0);
}

function bodyRadius(n: SystemMapNodeDTO, moon: boolean, starLike: boolean): number {
  let r: number;
  if (n.isInferredPlaceholder) r = 11;
  else if (starLike) r = 16;
  else if (/GG/.test(n.label)) r = 16;
  else if (n.label === "ELW" || n.label === "WW" || n.label === "AW") r = 13;
  else r = 12;
  return moon ? Math.round(r * 0.8) : r;
}

// ---------------------------------------------------------------------------------------------
// Tree helpers

function isStellar(n: SystemMapNodeDTO): boolean {
  return n.isStar || (n.isBarycentre === true && n.children.some(isStellar));
}

function designationKey(n: SystemMapNodeDTO): string {
  const s = n.bodyName;
  if (parseShortDesignation(s)) return s;
  const t = parseDesignationTailFromFullBodyName(s);
  if (!t) return s;
  const core = t.starLetters ? `${t.starLetters} ${t.major}` : `${t.major}`;
  return t.moon ? `${core} ${t.moon}` : core;
}

/**
 * The leaf a node sorts by: itself, or a barycentre's first member. A barycentre of stars sorts by
 * its stars only — its planets ("BC 1") must not decide where B and C go in the column.
 */
function repLeaf(n: SystemMapNodeDTO): SystemMapNodeDTO {
  if (!n.isBarycentre || n.children.length === 0) return n;
  const pool = isStellar(n) ? n.children.filter(isStellar) : n.children;
  let best: SystemMapNodeDTO | null = null;
  for (const c of pool) {
    const l = repLeaf(c);
    if (best == null || compareLeaves(l, best) < 0) best = l;
  }
  return best ?? n;
}

function compareLeaves(a: SystemMapNodeDTO, b: SystemMapNodeDTO): number {
  const la = starLetterOf(a);
  const lb = starLetterOf(b);
  if (a.isStar && b.isStar && la && lb && la !== lb) return la.localeCompare(lb);
  return compareByParsedDesignationOrBodyId(designationKey(a), designationKey(b), a.bodyId, b.bodyId);
}

function bySiblingOrder(a: SystemMapNodeDTO, b: SystemMapNodeDTO): number {
  return compareLeaves(repLeaf(a), repLeaf(b)) || a.bodyId - b.bodyId;
}

/** A star's own letter ("A") from its short name; the system's main star alone is named "★". */
function starLetterOf(n: SystemMapNodeDTO): string {
  if (!n.isStar) return "";
  const s = n.bodyName.trim();
  if (/^[A-Z]$/.test(s)) return s;
  if (s === "★") return "A";
  return "";
}

/** The star letters a barycentre joins, sorted ("ABC"). */
function starLettersUnder(n: SystemMapNodeDTO): string {
  const out = new Set<string>();
  const walk = (m: SystemMapNodeDTO) => {
    if (m.isStar) {
      const l = starLetterOf(m);
      if (l) out.add(l);
    }
    for (const c of m.children) if (isStellar(c)) walk(c);
  };
  walk(n);
  return [...out].sort().join("");
}

/** Multi-letter designations ("ABC 1") of a world, or "" — used when the journal lost its barycentre. */
function multiLetters(n: SystemMapNodeDTO): string {
  const p = parseShortDesignation(n.bodyName) ?? parseDesignationTailFromFullBodyName(n.bodyName);
  if (!p || p.moon || p.starLetters.length < 2) return "";
  return p.starLetters;
}

// ---------------------------------------------------------------------------------------------
// Groups: geometry built at a local origin, then moved into place.

interface Group {
  items: MapItem[];
  lines: MapLine[];
  belts: MapBelt[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function newGroup(): Group {
  return {
    items: [],
    lines: [],
    belts: [],
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
}

function grow(g: Group, x0: number, y0: number, x1: number, y1: number): void {
  g.minX = Math.min(g.minX, x0, x1);
  g.minY = Math.min(g.minY, y0, y1);
  g.maxX = Math.max(g.maxX, x0, x1);
  g.maxY = Math.max(g.maxY, y0, y1);
}

function shift(g: Group, dx: number, dy: number): void {
  for (const it of g.items) {
    it.cx += dx;
    it.cy += dy;
    it.nameX += dx;
    it.nameY += dy;
  }
  for (const l of g.lines) {
    l.x1 += dx;
    l.x2 += dx;
    l.y1 += dy;
    l.y2 += dy;
  }
  for (const b of g.belts) {
    b.cx += dx;
    b.cy += dy;
  }
  g.minX += dx;
  g.maxX += dx;
  g.minY += dy;
  g.maxY += dy;
}

function merge(into: Group, g: Group): void {
  into.items.push(...g.items);
  into.lines.push(...g.lines);
  into.belts.push(...g.belts);
  if (Number.isFinite(g.minX)) grow(into, g.minX, g.minY, g.maxX, g.maxY);
}

function line(
  g: Group,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  kind: MapLine["kind"],
  ids: number[],
): void {
  if (Math.hypot(x2 - x1, y2 - y1) < 0.5) return;
  g.lines.push({ x1, y1, x2, y2, kind, ids });
  grow(g, x1, y1, x2, y2);
}

function displayName(n: SystemMapNodeDTO): string {
  const tf = !n.isStar && !n.isBarycentre && !n.isInferredPlaceholder && n.mapLabel.includes("*");
  let s = tf ? `*${n.bodyName}` : n.bodyName;
  const starLike = n.isStar || n.journalStellar === true;
  if (starLike && n.namePlus) s += "+";
  else if (!starLike && !n.isBarycentre) s += n.exoValueTier === 2 ? "++" : n.exoValueTier === 1 ? "+" : "";
  return s;
}

type Details = Record<string, SystemMapBodyDetailDTO> | undefined;

interface Ctx {
  details: Details;
  parentOf: Map<number, number | null>;
}

function starLook(n: SystemMapNodeDTO, ctx: Ctx): { key: StarClassKey; giant: boolean } {
  const d = ctx.details?.[String(n.bodyId)];
  return starClassOf(d?.starType, n.mapLabel);
}

function makeItem(
  n: SystemMapNodeDTO,
  kind: MapItemKind,
  cx: number,
  cy: number,
  r: number,
  parentId: number | null,
  ctx: Ctx,
): MapItem {
  ctx.parentOf.set(n.bodyId, parentId);
  const it: MapItem = {
    id: n.bodyId,
    node: n,
    kind,
    cx,
    cy,
    r,
    nameX: cx,
    nameY: cy,
    nameAnchor: "middle",
    parentId,
  };
  if (kind === "star" || ((kind === "planet" || kind === "moon") && n.journalStellar === true)) {
    const s = starLook(n, ctx);
    it.starClass = s.key;
    if (s.giant) it.giant = true;
  }
  return it;
}

// ---------------------------------------------------------------------------------------------
// A planet's slot: the planet at (0, 0), its name under it, its moons in a column below.

interface Sat {
  node: SystemMapNodeDTO;
  parentId: number;
  depth: number;
}

/** Moons in column order, barycentres opened out (they are drawn as brackets beside the column). */
function flattenSatellites(children: SystemMapNodeDTO[], parentId: number, depth: number, out: Sat[]): void {
  for (const c of [...children].sort(bySiblingOrder)) {
    if (c.isBarycentre) {
      flattenSatellites(c.children, c.bodyId, depth, out);
      continue;
    }
    out.push({ node: c, parentId, depth });
    flattenSatellites(c.children, c.bodyId, depth + 1, out);
  }
}

function baryLevel(b: SystemMapNodeDTO): number {
  let inner = 0;
  for (const c of b.children) if (c.isBarycentre) inner = Math.max(inner, baryLevel(c));
  return inner + 1;
}

function buildSlot(n: SystemMapNodeDTO, parentId: number | null, ctx: Ctx): { g: Group; planet: MapItem } {
  const g = newGroup();
  const starLike = n.journalStellar === true;
  const r = bodyRadius(n, false, starLike);
  const planet = makeItem(n, "planet", 0, 0, r, parentId, ctx);
  const name = displayName(n);
  const nameW = textWidth(name);
  planet.nameY = r + LABEL_GAP + 8;
  g.items.push(planet);
  grow(g, -r - MARK_PAD, -r - MARK_PAD - TOP_MARKS, r + MARK_PAD, r + MARK_PAD);
  grow(g, -nameW / 2, r, nameW / 2, r + LABEL_GAP + LABEL_H);

  const sats: Sat[] = [];
  flattenSatellites(n.children, n.bodyId, 1, sats);
  if (sats.length === 0) return { g, planet };

  const byId = new Map<number, MapItem>();
  let y = r + LABEL_GAP + LABEL_H + MOON_GAP;
  let lineFrom = r + LABEL_GAP + LABEL_H;
  let maxMoonR = 0;
  let maxHalfName = 0;
  const moonIds = sats.map((s) => s.node.bodyId);
  sats.forEach((s, i) => {
    const mr = bodyRadius(s.node, true, s.node.journalStellar === true) - (s.depth > 1 ? 2 : 0);
    maxMoonR = Math.max(maxMoonR, mr);
    const cy = y + TOP_MARKS * 0.8 + mr;
    const moon = makeItem(s.node, "moon", 0, cy, mr, s.parentId, ctx);
    const half = textWidth(displayName(s.node), NAME_FONT - 0.5) / 2;
    maxHalfName = Math.max(maxHalfName, half);
    moon.nameY = cy + mr + LABEL_GAP + 8;
    g.items.push(moon);
    byId.set(s.node.bodyId, moon);
    grow(g, -mr - MARK_PAD, cy - mr - MARK_PAD - TOP_MARKS * 0.8, mr + MARK_PAD, cy + mr + MARK_PAD);
    grow(g, -half, cy + mr, half, cy + mr + LABEL_GAP + LABEL_H);
    // The column's line, from under the planet's (or the moon above's) name to this moon.
    line(g, 0, lineFrom, 0, cy - mr - 2, "orbit", moonIds.slice(i));
    lineFrom = cy + mr + LABEL_GAP + LABEL_H;
    y = lineFrom + MOON_GAP;
  });

  // Moon pairs: the column bracket, on the left, one step further out per nesting level.
  const railBase = -(Math.max(maxMoonR + MARK_PAD, maxHalfName + 2) + RAIL_OUT);
  const drawBary = (b: SystemMapNodeDTO, parent: number): { x: number; y: number } | null => {
    ctx.parentOf.set(b.bodyId, parent);
    const anchors: { x: number; y: number; id: number }[] = [];
    for (const c of b.children) {
      if (c.isBarycentre) {
        const a = drawBary(c, b.bodyId);
        if (a) anchors.push({ ...a, id: c.bodyId });
        continue;
      }
      const it = byId.get(c.bodyId);
      if (it) anchors.push({ x: -it.r - 2, y: it.cy, id: c.bodyId });
    }
    if (anchors.length === 0) return null;
    if (anchors.length === 1) return { x: anchors[0]!.x, y: anchors[0]!.y };
    const x = railBase - (baryLevel(b) - 1) * STEP;
    const ys = anchors.map((a) => a.y);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    for (const a of anchors) line(g, a.x, a.y, x, a.y, "bracket", [a.id]);
    line(g, x, lo, x, hi, "bracket", [b.bodyId]);
    const mid = (lo + hi) / 2;
    const bi = makeItem(b, "bary", x, mid, R_BARY, parent, ctx);
    bi.nameX = x - R_BARY - 3;
    bi.nameY = mid + 3;
    g.items.push(bi);
    grow(g, x - R_BARY - 2, lo, x, hi);
    return { x, y: mid };
  };
  // Only the outermost barycentre of a nest starts a bracket; the nested ones are drawn by it.
  const visit = (node: SystemMapNodeDTO): void => {
    for (const c of node.children) {
      if (c.isBarycentre && !node.isBarycentre) drawBary(c, node.bodyId);
      visit(c);
    }
  };
  visit(n);
  return { g, planet };
}

// ---------------------------------------------------------------------------------------------
// A row: a hub (star, or a barycentre's ×) at (0, 0) and its planets to the right.

interface Row {
  g: Group;
  hub: MapItem | null;
  /** Where a column bracket's tick meets this row's hub (its left edge). */
  attachX: number;
  cy: number;
}

function buildRow(
  hubNode: SystemMapNodeDTO | null,
  hubKind: "star" | "hub",
  members: SystemMapNodeDTO[],
  firstX: number,
  ctx: Ctx,
  opts: { inferred?: boolean; parentId?: number | null } = {},
): Row {
  const g = newGroup();
  let hub: MapItem | null = null;
  let hubR = 0;
  if (hubNode) {
    if (hubKind === "star") {
      const s = starLook(hubNode, ctx);
      hubR = starRadius(s.key, s.giant);
    } else {
      hubR = R_HUB;
    }
    hub = makeItem(hubNode, hubKind, 0, 0, hubR, opts.parentId ?? null, ctx);
    if (opts.inferred) hub.inferred = true;
    g.items.push(hub);
    grow(
      g,
      -hubR - MARK_PAD,
      -hubR - MARK_PAD - (hubKind === "star" ? TOP_MARKS : 0),
      hubR + MARK_PAD,
      hubR + MARK_PAD,
    );
    if (hubKind === "star") {
      hub.nameY = hubR + LABEL_GAP + 8;
      const spectral = ctx.details?.[String(hubNode.bodyId)]?.fullSpectralNotation?.trim();
      if (spectral) hub.subName = spectral;
      const w = Math.max(textWidth(displayName(hubNode)), spectral ? textWidth(spectral, NAME_FONT - 1) : 0);
      grow(g, -w / 2, hubR, w / 2, hubR + LABEL_GAP + LABEL_H * (spectral ? 2 : 1));
    }
  }

  const hubId = hubNode?.bodyId ?? null;
  let cursor = firstX;
  if (hubKind === "star" && hubNode && (hubNode.beltClusters ?? 0) > 0) {
    g.belts.push({ cx: cursor + BELT_W / 2 - 6, cy: 0, w: BELT_W });
    grow(g, cursor - 6, -14, cursor + BELT_W - 6, 14);
    cursor += BELT_W;
  }

  // Planets in order, with row-level barycentres opened out (their brackets go above the row).
  const planets: { node: SystemMapNodeDTO; parentId: number | null }[] = [];
  const topBaries: SystemMapNodeDTO[] = [];
  const open = (list: SystemMapNodeDTO[], parent: number | null, top: boolean) => {
    for (const c of [...list].sort(bySiblingOrder)) {
      if (c.isBarycentre) {
        if (top) topBaries.push(c);
        ctx.parentOf.set(c.bodyId, parent);
        open(c.children, c.bodyId, false);
      } else planets.push({ node: c, parentId: parent });
    }
  };
  open(members, hubId, true);

  const planetItems = new Map<number, MapItem>();
  let maxPlanetR = 0;
  const placed: MapItem[] = [];
  // One pitch for the whole row, like the game's evenly spaced planets: the widest slot's.
  const slots = planets.map((p) => buildSlot(p.node, p.parentId, ctx));
  const pitch = Math.max(MIN_SLOT, ...slots.map(({ g: sg }) => sg.maxX - sg.minX));
  slots.forEach(({ g: slot, planet }) => {
    // The planet in the middle of its pitch, moved only as far as its slot needs to fit inside it.
    const px = Math.min(Math.max(cursor + pitch / 2, cursor - slot.minX), cursor + pitch - slot.maxX);
    shift(slot, px, 0);
    merge(g, slot);
    planetItems.set(planet.id, planet);
    placed.push(planet);
    maxPlanetR = Math.max(maxPlanetR, planet.r);
    cursor += pitch + PLANET_GAP;
  });

  // The row's line: hub → first planet → … → last planet, broken at every icon.
  const rowIds = placed.map((p) => p.id);
  let from = hub ? hubR + 2 : null;
  placed.forEach((p, i) => {
    if (from != null) line(g, from, 0, p.cx - p.r - 2, 0, "orbit", rowIds.slice(i));
    from = p.cx + p.r + 2;
  });

  // Planet pairs: ticks up to a rail above the row, one step higher per nesting level.
  const railBase = -(maxPlanetR + MARK_PAD + TOP_MARKS + RAIL_OUT);
  const drawBary = (b: SystemMapNodeDTO, parent: number | null): { x: number; y: number } | null => {
    const anchors: { x: number; y: number; id: number }[] = [];
    for (const c of b.children) {
      if (c.isBarycentre) {
        const a = drawBary(c, b.bodyId);
        if (a) anchors.push({ ...a, id: c.bodyId });
        continue;
      }
      const it = planetItems.get(c.bodyId);
      if (it) anchors.push({ x: it.cx, y: -it.r - MARK_PAD - TOP_MARKS + 2, id: c.bodyId });
    }
    if (anchors.length === 0) return null;
    if (anchors.length === 1) return { x: anchors[0]!.x, y: anchors[0]!.y };
    const y = railBase - (baryLevel(b) - 1) * STEP;
    const xs = anchors.map((a) => a.x);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    for (const a of anchors) line(g, a.x, a.y, a.x, y, "bracket", [a.id]);
    line(g, lo, y, hi, y, "bracket", [b.bodyId]);
    const mid = (lo + hi) / 2;
    const bi = makeItem(b, "bary", mid, y, R_BARY, parent, ctx);
    bi.nameY = y - R_BARY - 3;
    g.items.push(bi);
    grow(g, lo, y - R_BARY - 2, hi, y);
    return { x: mid, y };
  };
  for (const b of topBaries) drawBary(b, hubId);

  return { g, hub, attachX: -(hubR + 2), cy: 0 };
}

// ---------------------------------------------------------------------------------------------
// The column: stars and barycentre ×s, top to bottom, with their brackets on the left.

type ColNode =
  | { kind: "leaf"; row: Row; id: number | null }
  | { kind: "group"; id: number; members: ColNode[]; xRow: Row | null; level: number }
  | { kind: "seq"; nodes: ColNode[] };

function colLevel(c: ColNode): number {
  if (c.kind === "leaf") return 0;
  if (c.kind === "group") return c.level;
  return Math.max(0, ...c.nodes.map(colLevel));
}

function colRows(c: ColNode, out: Row[]): Row[] {
  if (c.kind === "leaf") out.push(c.row);
  else if (c.kind === "seq") for (const n of c.nodes) colRows(n, out);
  else {
    const at = Math.ceil(c.members.length / 2);
    c.members.forEach((m, i) => {
      colRows(m, out);
      if (c.xRow && i === at - 1) out.push(c.xRow);
    });
    if (c.xRow && c.members.length === 0) out.push(c.xRow);
  }
  return out;
}

export function computeSystemMapLayout(
  roots: SystemMapNodeDTO[],
  _starSystemName: string,
  details?: Record<string, SystemMapBodyDetailDTO>,
): MapLayout {
  const ctx: Ctx = { details, parentOf: new Map() };
  const empty: MapLayout = {
    items: [],
    lines: [],
    belts: [],
    parents: ctx.parentOf,
    minX: 0,
    minY: 0,
    width: 0,
    height: 0,
  };
  if (roots.length === 0) return empty;

  // Every hub's radius first, so all rows start their planets on one line (the game's grid).
  let maxHubR = R_HUB;
  const walkAll = (n: SystemMapNodeDTO) => {
    if (n.isStar) {
      const s = starLook(n, ctx);
      maxHubR = Math.max(maxHubR, starRadius(s.key, s.giant));
    }
    for (const c of n.children) walkAll(c);
  };
  roots.forEach(walkAll);
  const firstX = maxHubR + ROW_LEAD;

  /*
    Worlds the journal could not place: an "ABC 1" with no Parents is parked on star A by the
    server. It belongs to the ABC barycentre's row when the journal has one, otherwise to an ×
    of its own under the star (drawn dashed: inferred).
  */
  const stellarBaryByLetters = new Map<string, SystemMapNodeDTO>();
  const indexBaries = (n: SystemMapNodeDTO) => {
    if (n.isBarycentre && isStellar(n)) {
      const L = starLettersUnder(n);
      if (L.length >= 2 && !stellarBaryByLetters.has(L)) stellarBaryByLetters.set(L, n);
    }
    for (const c of n.children) if (isStellar(c)) indexBaries(c);
  };
  roots.forEach(indexBaries);
  const moved = new Set<number>();
  const extraRowKids = new Map<number, SystemMapNodeDTO[]>();
  const inferredByStar = new Map<number, Map<string, SystemMapNodeDTO[]>>();
  const collect = (n: SystemMapNodeDTO) => {
    if (n.isStar) {
      const own = starLetterOf(n);
      for (const c of n.children) {
        if (isStellar(c)) continue;
        const L = multiLetters(c);
        if (!L || L === own) continue;
        moved.add(c.bodyId);
        const bary = stellarBaryByLetters.get(L);
        if (bary) {
          const list = extraRowKids.get(bary.bodyId) ?? [];
          list.push(c);
          extraRowKids.set(bary.bodyId, list);
        } else {
          const byL = inferredByStar.get(n.bodyId) ?? new Map<string, SystemMapNodeDTO[]>();
          const list = byL.get(L) ?? [];
          list.push(c);
          byL.set(L, list);
          inferredByStar.set(n.bodyId, byL);
        }
      }
    }
    for (const c of n.children) if (isStellar(c)) collect(c);
  };
  roots.forEach(collect);

  const build = (n: SystemMapNodeDTO, parentId: number | null): ColNode => {
    const kids = [...n.children].sort(bySiblingOrder);
    const colKids = kids.filter(isStellar);
    const rowKids = kids.filter((c) => !isStellar(c) && !moved.has(c.bodyId));

    if (n.isStar) {
      const leaf: ColNode = {
        kind: "leaf",
        row: buildRow(n, "star", rowKids, firstX, ctx, { parentId }),
        id: n.bodyId,
      };
      let head: ColNode = leaf;
      if (colKids.length > 0) {
        const members = [leaf, ...colKids.map((c) => build(c, n.bodyId))];
        head = {
          kind: "group",
          id: n.bodyId,
          members,
          xRow: null,
          level: 1 + Math.max(...members.map(colLevel)),
        };
      }
      const inferred = inferredByStar.get(n.bodyId);
      if (!inferred) return head;
      const extra: ColNode[] = [...inferred.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([L, worlds], i): ColNode => {
          const synth: SystemMapNodeDTO = {
            bodyId: -800_000_000 - n.bodyId * 32 - i,
            bodyName: L,
            label: "×",
            mapLabel: "×",
            isStar: false,
            hasExobiology: false,
            valuePlus: false,
            maxExoHeuristicCredits: 0,
            exoValueTier: 0,
            namePlus: false,
            starVisual: "default",
            orbitPrimaryKey: "",
            children: worlds,
            isBarycentre: true,
            semiMajorAxis: null,
          };
          const row = buildRow(synth, "hub", worlds, firstX, ctx, { inferred: true, parentId: null });
          return { kind: "leaf", row, id: synth.bodyId };
        });
      return { kind: "seq", nodes: [head, ...extra] };
    }

    // A stellar barycentre: its members in the column, its own planets (if any) on an × row.
    ctx.parentOf.set(n.bodyId, parentId);
    const members = colKids.map((c) => build(c, n.bodyId));
    const baryWorlds = [...rowKids, ...(extraRowKids.get(n.bodyId) ?? [])];
    const xRow = baryWorlds.length > 0 ? buildRow(n, "hub", baryWorlds, firstX, ctx, { parentId }) : null;
    if (members.length === 1 && !xRow) return members[0]!;
    return { kind: "group", id: n.bodyId, members, xRow, level: 1 + Math.max(0, ...members.map(colLevel)) };
  };

  const cols = roots
    .filter(isStellar)
    .sort(bySiblingOrder)
    .map((r) => build(r, null));
  // Bodies with no star at all (partial scans): one row at the bottom, with no hub.
  const orphans = roots.filter((r) => !isStellar(r)).sort(bySiblingOrder);
  if (orphans.length > 0)
    cols.push({ kind: "leaf", row: buildRow(null, "hub", orphans, firstX, ctx), id: null });

  // Stack the rows, each below everything the one above it holds.
  const out = newGroup();
  const rows: Row[] = [];
  for (const c of cols) colRows(c, rows);
  let cursor = 0;
  for (const row of rows) {
    const dy = cursor - row.g.minY;
    shift(row.g, 0, dy);
    row.cy = dy;
    merge(out, row.g);
    cursor = row.g.maxY + ROW_GAP;
  }

  // Column brackets, left of the widest hub, one step further left per nesting level.
  const colLeft = -(maxHubR + RAIL_OUT);
  const attach = (c: ColNode): { x: number; y: number; id: number | null } => {
    if (c.kind === "leaf") return { x: c.row.attachX, y: c.row.cy, id: c.id };
    if (c.kind === "seq") {
      for (const n of c.nodes.slice(1)) attach(n);
      return attach(c.nodes[0]!);
    }
    const anchors = c.members.map(attach);
    if (c.xRow) anchors.push({ x: c.xRow.attachX, y: c.xRow.cy, id: c.id });
    const x = colLeft - (c.level - 1) * STEP;
    const ys = anchors.map((a) => a.y);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    for (const a of anchors) line(out, a.x, a.y, x, a.y, "bracket", a.id != null ? [a.id] : []);
    line(out, x, lo, x, hi, "bracket", [c.id]);
    return { x, y: c.xRow ? c.xRow.cy : (lo + hi) / 2, id: c.id };
  };
  for (const c of cols) attach(c);

  if (!Number.isFinite(out.minX)) return empty;
  const minX = out.minX - PAD;
  const minY = out.minY - PAD;
  return {
    items: out.items,
    lines: out.lines,
    belts: out.belts,
    parents: ctx.parentOf,
    minX,
    minY,
    width: out.maxX + PAD - minX,
    height: out.maxY + PAD - minY,
  };
}

/** A body's chain to the top of the map: itself, what it orbits, what that orbits, and so on. */
export function orbitChain(layout: MapLayout, id: number | null): Set<number> {
  const chain = new Set<number>();
  let cur: number | null | undefined = id;
  for (let guard = 0; cur != null && guard < 64 && !chain.has(cur); guard++) {
    chain.add(cur);
    cur = layout.parents.get(cur);
  }
  return chain;
}

/** The nearest body in a direction, the way the game's map moves its cursor. */
export function neighbourInDirection(
  items: MapItem[],
  from: MapItem,
  dir: "left" | "right" | "up" | "down",
): MapItem | null {
  const horizontal = dir === "left" || dir === "right";
  const sign = dir === "right" || dir === "down" ? 1 : -1;
  let best: MapItem | null = null;
  let bestScore = Infinity;
  for (const it of items) {
    if (it === from || it.kind === "bary") continue;
    const along = horizontal ? it.cx - from.cx : it.cy - from.cy;
    const across = horizontal ? it.cy - from.cy : it.cx - from.cx;
    if (along * sign <= 1) continue;
    // Straight ahead first; off the line only when nothing is on it.
    const score = Math.abs(along) + Math.abs(across) * (Math.abs(across) < 1 ? 0 : 6);
    if (score < bestScore) {
      bestScore = score;
      best = it;
    }
  }
  return best;
}
