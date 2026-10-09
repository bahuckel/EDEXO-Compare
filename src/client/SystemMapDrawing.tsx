/**
 * The system map drawing: the layout from `systemMapLayout.ts`, drawn to look like the game's map
 * (owner, 2026-09-27). No rendered planets or backdrops — a schematic with the game's language:
 * - stars coloured and sized by class, the class letter inside, their full class under the name;
 * - planets and moons tinted by type with the type letter inside (I, RI, HMC…);
 * - a **full ring = atmosphere**, a **⅔ arc = landable** (the game's two blue marks);
 * - a badge with the biological signal count, orange with ×5 when first footfall pays;
 * - ▼ where the ship is, the planet's rings, and a faint grid behind it all;
 * - a green ring on a green gas giant: solid when confirmed or catalogued, dashed for a guess.
 *
 * Every colour and stroke is an SVG attribute, never a CSS class: the snapshot camera clones the
 * SVG without its stylesheet, and a class-only stroke is why snapshots used to lose every line.
 */
import type { SystemMapBodyDetailDTO, SystemMapSnapshot } from "@shared/types";
import { RECORD_GOLD } from "./noticesClient";
import { MARK_PAD, NAME_FONT, type MapItem, type MapLayout, type StarClassKey } from "./systemMapLayout";
import { atmosphereRingColor } from "./planetDisplayUtils";
import { greenGiantLabel, type GreenGiantVerdict } from "@shared/greenGasGiant";

/** The game's blue for the landable arc (and the atmosphere ring when its gas has no colour). */
export const MAP_BLUE = "#4aa3ff";
const LINE = "#7b8496";
const LINE_LIT = "#ffb347";
const NAME = "#a9a6b8";
const HALO = "#07080c";
export const MAP_BG = "#07080c";
/** The green gas giant ring (owner, 2026-10-09: "Mark GGGs on system map"). */
export const GGG_GREEN = "#6dff8f";

/** Solid for a confirmed or catalogued green, dashed for a likely one, dotted and fainter for a possible one. */
export function gggRingStyle(v: Pick<GreenGiantVerdict, "level">): { dash?: string; opacity: number } {
  if (v.level === "likely") return { dash: "5 3", opacity: 0.95 };
  if (v.level === "possible") return { dash: "2 3", opacity: 0.7 };
  return { opacity: 1 };
}

export const STAR_COLOURS: Record<StarClassKey, { core: string; edge: string; label: string }> = {
  O: { core: "#e2e8ff", edge: "#7f9cff", label: "O" },
  B: { core: "#e8eeff", edge: "#9fb4ff", label: "B" },
  A: { core: "#ffffff", edge: "#c9d6ff", label: "A" },
  F: { core: "#fffbe8", edge: "#f3e2a0", label: "F" },
  G: { core: "#fff3b0", edge: "#f0c23c", label: "G" },
  K: { core: "#ffd9a0", edge: "#f0923a", label: "K" },
  M: { core: "#ffc27e", edge: "#e8672c", label: "M" },
  L: { core: "#ff6d80", edge: "#c21a40", label: "L" },
  T: { core: "#e27ab8", edge: "#8e2a74", label: "T" },
  Y: { core: "#a2649a", edge: "#4c2049", label: "Y" },
  TTS: { core: "#ffcf8a", edge: "#c9782e", label: "TT" },
  AeBe: { core: "#eaf0ff", edge: "#9fb4ff", label: "Ae" },
  W: { core: "#dcf2ff", edge: "#5fb4ff", label: "W" },
  C: { core: "#ff9070", edge: "#b8321e", label: "C" },
  S: { core: "#ffab80", edge: "#c2552e", label: "S" },
  D: { core: "#ffffff", edge: "#b8c8e8", label: "D" },
  N: { core: "#dcf7ff", edge: "#38bdf8", label: "N" },
  H: { core: "#0c0b14", edge: "#a78bfa", label: "BH" },
  X: { core: "#fff0b0", edge: "#e0b040", label: "?" },
};

/** Dark text on bright stars, light text on dark ones. */
function starText(core: string): string {
  const n = parseInt(core.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#1a1420" : "#f4f0ff";
}

/** Body tints by type — the colours the old map and the body pills already use. */
export function bodyColours(label: string): { fill: string; stroke: string; text: string } {
  const bl = label.replace(/[*+]/g, "");
  if (bl === "ELW") return { fill: "#123d1f", stroke: "#4ade80", text: "#c6f6d5" };
  if (bl === "WW") return { fill: "#14305e", stroke: "#60a5fa", text: "#cfe2ff" };
  if (bl === "AW") return { fill: "#40340c", stroke: "#facc15", text: "#fff0a0" };
  if (bl === "I" || bl === "RI") return { fill: "#123a44", stroke: "#22d3ee", text: "#c9f6ff" };
  /*
    Owner, 2026-10-01 (D3): no accent orange for rock — a slight tint difference instead, rocky
    darker, HMC grey-brown; metal-rich a steel grey beside them.
  */
  if (bl === "R") return { fill: "#241c16", stroke: "#8f7258", text: "#dcc6ae" };
  if (bl === "HMC") return { fill: "#2b2925", stroke: "#a69a88", text: "#e4ddd2" };
  if (bl === "MR") return { fill: "#26272c", stroke: "#a9aebb", text: "#e2e4ea" };
  if (/GG/.test(bl)) return { fill: "#3a3022", stroke: "#c4a574", text: "#f0e0c4" };
  if (bl === "?") return { fill: "#1c1d24", stroke: "#8b909c", text: "#d4d6dc" };
  return { fill: "#33240f", stroke: "#fb923c", text: "#fdba74" };
}

function hasAtmosphere(det: SystemMapBodyDetailDTO | undefined): string | null {
  if (!det) return null;
  const raw = det.atmosphereType || det.atmosphere;
  const s = (raw ?? "").trim();
  if (!s || /^no\s*atmosphere/i.test(s) || s.toLowerCase() === "none") return null;
  return atmosphereRingColor(s) ?? MAP_BLUE;
}

/** The ⅔ arc, open on the right like the game's. */
function arcPath(cx: number, cy: number, r: number): string {
  const a0 = (60 * Math.PI) / 180;
  const a1 = (300 * Math.PI) / 180;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Gradients for every star class and the grid. Put once inside each <svg> that draws a map. */
export function SystemMapDefs() {
  return (
    <defs>
      {(Object.keys(STAR_COLOURS) as StarClassKey[]).map((k) => (
        <radialGradient key={k} id={`smStar-${k}`} cx="40%" cy="38%" r="65%">
          <stop offset="0%" stopColor={STAR_COLOURS[k].core} />
          <stop offset="100%" stopColor={STAR_COLOURS[k].edge} />
        </radialGradient>
      ))}
      <radialGradient id="smStarGlow" cx="50%" cy="50%" r="50%">
        <stop offset="55%" stopColor="#ffffff" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>
      <pattern id="smGrid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#5a7aa8" strokeOpacity="0.16" strokeWidth="1" />
      </pattern>
    </defs>
  );
}

/** The dark backdrop and its grid, reaching well past the map so panning never shows an edge. */
export function SystemMapGrid({ layout }: { layout: MapLayout }) {
  const m = Math.max(layout.width, layout.height) * 3 + 400;
  return (
    <g pointerEvents="none">
      <rect
        x={layout.minX - m}
        y={layout.minY - m}
        width={layout.width + 2 * m}
        height={layout.height + 2 * m}
        fill={MAP_BG}
      />
      <rect
        x={layout.minX - m}
        y={layout.minY - m}
        width={layout.width + 2 * m}
        height={layout.height + 2 * m}
        fill="url(#smGrid)"
      />
    </g>
  );
}

function BeltGlyph({ cx, cy, w }: { cx: number; cy: number; w: number }) {
  const pts: [number, number, number][] = [];
  // Fixed pseudo-random scatter: the same belt draws the same way on every render.
  let seed = Math.round(cx * 7 + cy * 13);
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 22; i++)
    pts.push([cx + (rnd() - 0.5) * w * 0.5, cy + (rnd() - 0.5) * 24, 0.8 + rnd() * 1.3]);
  return (
    <g pointerEvents="none">
      {pts.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#c9b27a" opacity={0.85} />
      ))}
      <title>Asteroid belt</title>
    </g>
  );
}

function Cross({
  cx,
  cy,
  r,
  stroke,
  width,
}: {
  cx: number;
  cy: number;
  r: number;
  stroke: string;
  width: number;
}) {
  const d = r * 0.72;
  return (
    <>
      <line
        x1={cx - d}
        y1={cy - d}
        x2={cx + d}
        y2={cy + d}
        stroke={stroke}
        strokeWidth={width}
        strokeLinecap="round"
      />
      <line
        x1={cx - d}
        y1={cy + d}
        x2={cx + d}
        y2={cy - d}
        stroke={stroke}
        strokeWidth={width}
        strokeLinecap="round"
      />
    </>
  );
}

export function itemTitle(it: MapItem, det: SystemMapBodyDetailDTO | undefined): string {
  const n = it.node;
  if (it.kind === "bary" || it.kind === "hub") {
    return it.inferred
      ? `Barycentre ${n.bodyName} (from the body names)`
      : `Barycentre${n.bodyName ? ` ${n.bodyName}` : ""}`;
  }
  const parts = [n.bodyName];
  if (it.starClass) parts.push(det?.fullSpectralNotation || det?.starType || "star");
  else if (det?.planetClass) parts.push(det.planetClass);
  if (det?.landable) parts.push("landable");
  const atmo = det?.atmosphereType || det?.atmosphere;
  if (atmo && !/^no\s*atmosphere/i.test(atmo))
    parts.push(`${atmo} atmosphere`.replace(/atmosphere atmosphere/i, "atmosphere"));
  const bio = n.bioSignals ?? 0;
  if (bio > 0)
    parts.push(
      `${bio} biological signal${bio === 1 ? "" : "s"}${n.firstFootfallX5 ? ", first footfall ×5" : ""}`,
    );
  if ((n.rings ?? 0) > 0) parts.push(`${n.rings} ring${n.rings === 1 ? "" : "s"}`);
  if (det?.green) parts.push(greenGiantLabel(det.green));
  if (n.youAreHere) parts.push("you are here");
  return parts.join(" — ");
}

export function SystemMapDrawing({
  layout,
  map,
  dimmed,
  selectedId = null,
  recordIds,
  chain,
  onSelect,
  onHover,
}: {
  layout: MapLayout;
  map: SystemMapSnapshot;
  /** Bodies that broke a personal record: a gold ring (shared/notices.ts). */
  recordIds?: ReadonlyMap<number, unknown>;
  /** Bodies a filter fades (they stay in place so the tree still reads). */
  dimmed?: (it: MapItem) => boolean;
  selectedId?: number | null;
  /** The hovered or selected body's chain to the top: its lines are lit. */
  chain?: Set<number>;
  onSelect?: (it: MapItem) => void;
  onHover?: (it: MapItem | null) => void;
}) {
  const lit = (ids: number[]) => chain != null && chain.size > 0 && ids.some((id) => chain.has(id));
  const sorted = [...layout.lines].sort((a, b) => Number(lit(a.ids)) - Number(lit(b.ids)));
  return (
    <>
      <g>
        {sorted.map((s, i) => {
          const on = lit(s.ids);
          return (
            <line
              key={`l-${i}-${s.x1}-${s.y1}-${s.x2}-${s.y2}`}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke={on ? LINE_LIT : LINE}
              strokeOpacity={on ? 1 : s.kind === "bracket" ? 0.9 : 0.75}
              strokeWidth={on ? 1.9 : 1.25}
              strokeLinecap="square"
            />
          );
        })}
      </g>
      {layout.belts.map((b, i) => (
        <BeltGlyph key={`belt-${i}`} cx={b.cx} cy={b.cy} w={b.w} />
      ))}
      {layout.items.map((it) => (
        <MapNode
          key={it.id}
          it={it}
          det={map.detailsByBodyId[String(it.id)]}
          dim={dimmed?.(it) ?? false}
          selected={selectedId != null && it.id === selectedId}
          record={recordIds?.has(it.id) === true}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </>
  );
}

function MapNode({
  it,
  det,
  dim,
  selected,
  record = false,
  onSelect,
  onHover,
}: {
  it: MapItem;
  det: SystemMapBodyDetailDTO | undefined;
  dim: boolean;
  selected: boolean;
  record?: boolean;
  onSelect?: (it: MapItem) => void;
  onHover?: (it: MapItem | null) => void;
}) {
  const n = it.node;
  const { cx, cy, r } = it;
  const handlers = {
    onClick: (ev: React.MouseEvent) => {
      ev.stopPropagation();
      onSelect?.(it);
    },
    onMouseEnter: () => onHover?.(it),
    onMouseLeave: () => onHover?.(null),
  };
  const title = <title>{itemTitle(it, det)}</title>;

  if (it.kind === "bary" || it.kind === "hub") {
    const big = it.kind === "hub";
    return (
      <g className="system-map-node-g" style={{ cursor: "pointer" }} opacity={dim ? 0.3 : 1} {...handlers}>
        <circle cx={cx} cy={cy} r={r + 5} fill="#000000" fillOpacity={0.01} />
        {it.inferred ? (
          <circle
            cx={cx}
            cy={cy}
            r={r + 3}
            fill="none"
            stroke="#9aa3b5"
            strokeWidth={1}
            strokeDasharray="2 2.5"
          />
        ) : null}
        {selected ? (
          <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke={LINE_LIT} strokeWidth={1.6} />
        ) : null}
        <Cross cx={cx} cy={cy} r={r} stroke={big ? "#e2e8f0" : "#b8c0cf"} width={big ? 2.2 : 1.6} />
        {title}
      </g>
    );
  }

  const starLike = it.starClass != null;
  const sc = starLike ? STAR_COLOURS[it.starClass!] : null;
  const bc = starLike ? null : bodyColours(n.isInferredPlaceholder ? "?" : n.label);
  const atmo = starLike || n.isInferredPlaceholder ? null : hasAtmosphere(det);
  const landable = !starLike && det?.landable === true;
  const bio = n.bioSignals ?? 0;
  const ringed = (n.rings ?? 0) > 0;
  const ringRx = r + 9;
  const ringRy = Math.max(3, ringRx * 0.3);
  const ringTilt = `rotate(-18 ${cx} ${cy})`;
  const letter = starLike
    ? STAR_COLOURS[it.starClass!].label
    : n.isInferredPlaceholder
      ? "?"
      : n.label.replace(/[*+]/g, "");
  const letterSize = Math.min(r * 0.95, (r * 1.45) / Math.max(1, letter.length * 0.62));
  const name =
    (!n.isStar && !n.isInferredPlaceholder && n.mapLabel.includes("*") ? "*" : "") +
    n.bodyName +
    (starLike && n.namePlus
      ? "+"
      : !starLike
        ? n.exoValueTier === 2
          ? "++"
          : n.exoValueTier === 1
            ? "+"
            : ""
        : "");
  const nameSize = it.kind === "moon" ? NAME_FONT - 0.5 : NAME_FONT;
  const arcR = r + (atmo ? 5.5 : 3);

  return (
    <g className="system-map-node-g" style={{ cursor: "pointer" }} opacity={dim ? 0.25 : 1} {...handlers}>
      {starLike ? <circle cx={cx} cy={cy} r={r * 1.45} fill="url(#smStarGlow)" pointerEvents="none" /> : null}
      {record ? (
        <circle
          className="system-map-record-ring"
          cx={cx}
          cy={cy}
          r={r + 7}
          fill="none"
          stroke={RECORD_GOLD}
          strokeWidth={2}
          pointerEvents="none"
        />
      ) : null}
      {det?.green && !starLike ? (
        <circle
          className="system-map-ggg-ring"
          cx={cx}
          cy={cy}
          r={r + (record ? 10 : 7)}
          fill="none"
          stroke={GGG_GREEN}
          strokeWidth={2}
          strokeDasharray={gggRingStyle(det.green).dash}
          opacity={gggRingStyle(det.green).opacity}
          pointerEvents="none"
        />
      ) : null}
      {ringed ? (
        <ellipse
          cx={cx}
          cy={cy}
          rx={ringRx}
          ry={ringRy}
          transform={ringTilt}
          fill="none"
          stroke="#d8c39a"
          strokeWidth={2}
          opacity={0.5}
          pointerEvents="none"
        />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={starLike ? `url(#smStar-${it.starClass})` : bc!.fill}
        stroke={starLike ? sc!.edge : bc!.stroke}
        strokeWidth={starLike ? 1 : 1.6}
        strokeDasharray={n.isInferredPlaceholder ? "3 2.5" : undefined}
      />
      {ringed ? (
        <path
          d={`M ${cx - ringRx} ${cy} A ${ringRx} ${ringRy} 0 0 0 ${cx + ringRx} ${cy}`}
          transform={ringTilt}
          fill="none"
          stroke="#e8d6ae"
          strokeWidth={2}
          opacity={0.95}
          pointerEvents="none"
        />
      ) : null}
      {atmo ? (
        <circle
          cx={cx}
          cy={cy}
          r={r + 3}
          fill="none"
          stroke={atmo}
          strokeWidth={1.6}
          opacity={0.95}
          pointerEvents="none"
        />
      ) : null}
      {landable ? (
        <path
          d={arcPath(cx, cy, arcR)}
          fill="none"
          stroke={MAP_BLUE}
          strokeWidth={2}
          strokeLinecap="round"
          pointerEvents="none"
        />
      ) : null}
      {selected ? (
        <>
          <path
            d={`M ${cx - (r + MARK_PAD + 2)} ${cy - 4} A ${r + MARK_PAD + 2} ${r + MARK_PAD + 2} 0 0 1 ${cx + r + MARK_PAD + 2} ${cy - 4}`}
            fill="none"
            stroke={LINE_LIT}
            strokeWidth={2}
            pointerEvents="none"
          />
          <path
            d={`M ${cx - (r + MARK_PAD + 2)} ${cy + 4} A ${r + MARK_PAD + 2} ${r + MARK_PAD + 2} 0 0 0 ${cx + r + MARK_PAD + 2} ${cy + 4}`}
            fill="none"
            stroke={LINE_LIT}
            strokeWidth={2}
            pointerEvents="none"
          />
        </>
      ) : null}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill={starLike ? starText(sc!.core) : bc!.text}
        fontSize={letterSize}
        fontWeight={800}
        pointerEvents="none"
      >
        {letter}
      </text>
      {bio > 0 ? (
        <g pointerEvents="none">
          <rect
            x={cx + r * 0.45}
            y={cy - r - 11}
            width={n.firstFootfallX5 ? 25 : 12}
            height={11}
            rx={2}
            // ×5 in the first-footfall blue it has everywhere else (review O-26), not accent orange.
            style={{ fill: n.firstFootfallX5 ? "var(--ok, #4fd0ff)" : "#5fcf6a" }}
            stroke={HALO}
            strokeWidth={1}
          />
          <text
            x={cx + r * 0.45 + (n.firstFootfallX5 ? 12.5 : 6)}
            y={cy - r - 5.5}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={8.5}
            fontWeight={800}
            fill="#07060a"
          >
            {n.firstFootfallX5 ? `${bio} ×5` : bio}
          </text>
        </g>
      ) : null}
      {n.youAreHere ? (
        <path
          d={`M ${cx - 5.5} ${cy - r - 15} L ${cx + 5.5} ${cy - r - 15} L ${cx} ${cy - r - 5} Z`}
          fill="#5fe0ff"
          stroke="#10333c"
          strokeWidth={1}
          pointerEvents="none"
        />
      ) : null}
      <text
        x={it.nameX}
        y={it.nameY}
        textAnchor={it.nameAnchor}
        fill={NAME}
        fontSize={nameSize}
        fontWeight={600}
        stroke={HALO}
        strokeWidth={3}
        paintOrder="stroke"
        pointerEvents="none"
      >
        {name}
      </text>
      {it.subName ? (
        <text
          x={it.nameX}
          y={it.nameY + 11}
          textAnchor="middle"
          fill={sc?.edge ?? NAME}
          fontSize={NAME_FONT - 1}
          fontWeight={700}
          stroke={HALO}
          strokeWidth={3}
          paintOrder="stroke"
          pointerEvents="none"
        >
          {it.subName}
        </text>
      ) : null}
      {title}
    </g>
  );
}
