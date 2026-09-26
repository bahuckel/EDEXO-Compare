/**
 * The system map drawing, shared by the System map window and the System card (Discord batch O-E2).
 *
 * The window adds zoom, pan and the body popup around it; the card draws it small and sends a click
 * on a bio body to that body's tab. One drawing, so the two can never disagree about a system — and
 * everything added here (pair brackets, belts, the bio ring with its count, the ×5 ring, "you are
 * here") shows in both.
 */
import type { SystemMapSnapshot } from "@shared/types";
import type { LayoutItem, LayoutResult } from "./systemMapGeometry";
import { atmosphereRingColor } from "./planetDisplayUtils";

export function systemMapNodeAppearance(it: LayoutItem): {
  fill: string;
  stroke: string;
  filter?: string;
  textFill: string;
  mapLabelFontSize?: number;
  strokeWidth?: number;
} {
  if (it.isBarycentre) {
    return {
      fill: "rgba(226, 232, 240, 0.12)",
      stroke: "#cbd5e1",
      filter: "url(#neonGray)",
      textFill: "#f8fafc",
      mapLabelFontSize: 12,
      strokeWidth: 1.5,
    };
  }
  if (it.isPlaceholder) {
    return {
      fill: "rgba(130, 135, 150, 0.16)",
      stroke: "#9ca3af",
      filter: "url(#neonGray)",
      textFill: "#e5e7eb",
      mapLabelFontSize: 13,
    };
  }
  const starLike = it.isStar || it.journalStellar === true;
  if (starLike) {
    if (it.starVisual === "neutron") {
      return {
        fill: "rgba(56,189,248,0.14)",
        stroke: "#38bdf8",
        filter: "url(#neonBlue)",
        textFill: "#7ddbfe",
      };
    }
    return {
      fill: "rgba(253, 224, 71, 0.16)",
      stroke: "#facc15",
      filter: "url(#neonSun)",
      textFill: "#fef9c3",
    };
  }

  const bl = it.baseLabel;
  if (bl === "ELW") {
    return {
      fill: "rgba(52,211,153,0.22)",
      stroke: "#4fd0ff",
      filter: "url(#neonElw)",
      textFill: "#9fe4ff",
    };
  }
  if (bl === "WW") {
    return {
      fill: "rgba(37, 99, 235, 0.22)",
      stroke: "#60a5fa",
      filter: "url(#neonWw)",
      textFill: "#93c5fd",
    };
  }
  if (bl === "AW") {
    return {
      fill: "rgba(234,179,8,0.24)",
      stroke: "#facc15",
      filter: "url(#neonAw)",
      textFill: "#fde047",
    };
  }
  if (bl === "I" || bl === "RI") {
    return {
      fill: "rgba(34, 211, 238, 0.2)",
      stroke: "#22d3ee",
      filter: "url(#neonIcy)",
      textFill: "#a5f3fc",
    };
  }
  if (bl === "R" || bl === "HMC" || bl === "MR") {
    return {
      fill: "rgba(255,122,36,0.12)",
      stroke: "#ff8a1f",
      filter: "url(#neonOrange)",
      textFill: "#ff9a4d",
    };
  }
  if (bl === "GG" || /^GG[1-5]$/.test(bl)) {
    return {
      fill: "rgba(196, 165, 116, 0.26)",
      stroke: "#c4a574",
      filter: "url(#neonGas)",
      textFill: "#e8d5b8",
    };
  }

  return {
    fill: "rgba(251, 146, 60, 0.1)",
    stroke: "#fb923c",
    filter: "url(#neonOrange)",
    textFill: "#fdba74",
  };
}

export function mapNodeNameLine(it: LayoutItem): string {
  const base = it.displayBodyName ?? it.bodyName;
  const starLike = it.isStar || it.journalStellar === true;
  if (starLike && it.namePlus) return `${base}+`;
  if (!starLike && !it.isBarycentre) {
    if (it.exoValueTier === 2) return `${base}++`;
    if (it.exoValueTier === 1) return `${base}+`;
  }
  return base;
}

/** The glow filters the node rings use. Put once inside each <svg> that draws a map. */
export function SystemMapDefs() {
  return (
    <defs>
      <filter id="neonOrange" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#ff8a1f" floodOpacity="0.55" />
      </filter>
      <filter id="neonGreen" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#4fd0ff" floodOpacity="0.55" />
      </filter>
      <filter id="neonBlue" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.4" floodColor="#38bdf8" floodOpacity="0.65" />
      </filter>
      <filter id="neonElw" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.35" floodColor="#4fd0ff" floodOpacity="0.72" />
      </filter>
      <filter id="neonWw" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.45" floodColor="#3b82f6" floodOpacity="0.72" />
      </filter>
      <filter id="neonAw" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.25" floodColor="#facc15" floodOpacity="0.68" />
      </filter>
      <filter id="neonGray" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.35" floodColor="#9ca3af" floodOpacity="0.65" />
      </filter>
      <filter id="neonSun" x="-45%" y="-45%" width="190%" height="190%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.35" floodColor="#facc15" floodOpacity="0.72" />
      </filter>
      <filter id="neonIcy" x="-45%" y="-45%" width="190%" height="190%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.4" floodColor="#22d3ee" floodOpacity="0.78" />
      </filter>
      <filter id="neonGas" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#c4a574" floodOpacity="0.62" />
      </filter>
    </defs>
  );
}

/** Scattered rubble between a star and its first planet, the way the game draws a belt. */
function BeltGlyph({ cx, cy, h }: { cx: number; cy: number; h: number }) {
  const pts: [number, number, number][] = [];
  // Fixed pseudo-random scatter: the same belt draws the same way on every render.
  let seed = Math.round(cx * 7 + cy * 13);
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 26; i++) {
    const y = cy - h / 2 + rnd() * h;
    const x = cx + (rnd() - 0.5) * 9;
    pts.push([x, y, 0.8 + rnd() * 1.4]);
  }
  return (
    <g className="system-map-belt" pointerEvents="none">
      {pts.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#c9b27a" opacity={0.85} />
      ))}
    </g>
  );
}

export function SystemMapDrawing({
  layout,
  map,
  bioOnly = false,
  selectedBodyId = null,
  onNodeClick,
}: {
  layout: LayoutResult;
  map: SystemMapSnapshot;
  bioOnly?: boolean;
  selectedBodyId?: number | null;
  onNodeClick?: (it: LayoutItem, ev: React.MouseEvent) => void;
}) {
  return (
    <>
      <g className="system-map-edges">
        {layout.segments.map((s, i) => (
          <line
            key={`e-${i}-${s.x1}-${s.y1}`}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            className="system-map-line"
          />
        ))}
        {layout.bracketSegments.map((s, i) => (
          <line
            key={`b-${i}-${s.x1}-${s.y1}`}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            className="system-map-line system-map-bracket"
          />
        ))}
      </g>
      {layout.belts.map((b, i) => (
        <BeltGlyph key={`belt-${i}`} cx={b.cx} cy={b.cy} h={b.h} />
      ))}
      {layout.items.map((it) => {
        let neo = systemMapNodeAppearance(it);
        if (it.isArrivalBody) {
          neo = { ...neo, stroke: "#ffd23f", strokeWidth: Math.max(neo.strokeWidth ?? 2, 2.6) };
        }
        const sw = neo.strokeWidth ?? 2;
        const fs = neo.mapLabelFontSize ?? (it.mapLabel.length > 5 ? 8.5 : 10);
        const nameDy = it.r + (it.isBarycentre ? 17 : 13);
        // A barycentre on a pair bracket names itself above the bracket (planets) or beside it (moons).
        const namePos =
          it.bracketBary === "above"
            ? { x: it.cx, y: it.cy - it.r - 4, anchor: "middle" as const }
            : it.bracketBary === "right"
              ? { x: it.cx + it.r + 4, y: it.cy + 3, anchor: "start" as const }
              : { x: it.cx, y: it.cy + nameDy, anchor: "middle" as const };
        const bio = it.bioSignals ?? 0;
        const bioRingR = it.r + 6;
        // A ringed planet: a flat ring tilted like the game map's, reaching past the bio ring.
        const ringed = (it.rings ?? 0) > 0;
        const ringRx = it.r + 11;
        const ringRy = Math.max(3, ringRx * 0.3);
        const ringTilt = `rotate(-18 ${it.cx} ${it.cy})`;
        const det = map?.detailsByBodyId[String(it.bodyId)];
        const atmoRing =
          det && !it.isStar && it.journalStellar !== true && !it.isBarycentre && !it.isPlaceholder
            ? atmosphereRingColor(det.atmosphereType || det.atmosphere)
            : null;
        const starRays = it.isStar || it.journalStellar === true;
        const rayStroke = neo.stroke;
        const rayOpacity = it.starVisual === "neutron" ? 0.44 : 0.36;
        // Stars and barycentres stay lit under the filter: they are the scaffolding that makes
        // the tree readable, and fading them would leave the survivors floating.
        const structural = starRays || it.isBarycentre;
        const dimmed = bioOnly && !structural && !det?.hasExobiology;
        const isSelected = selectedBodyId != null && it.bodyId === selectedBodyId;
        return (
          <g
            key={it.bodyId}
            className={`system-map-node-g${dimmed ? " system-map-node-g--dim" : ""}${
              isSelected ? " system-map-node-g--selected" : ""
            }`}
            style={{ cursor: "pointer" }}
            onClick={(ev) => {
              ev.stopPropagation();
              onNodeClick?.(it, ev);
            }}
          >
            {starRays ? (
              <g className="system-map-star-rays" pointerEvents="none">
                {Array.from({ length: 12 }, (_, i) => {
                  const a = (Math.PI * 2 * i) / 12 - Math.PI / 2;
                  const r0 = it.r * 1.05;
                  const r1 = it.r * 1.78;
                  return (
                    <line
                      key={i}
                      x1={it.cx + Math.cos(a) * r0}
                      y1={it.cy + Math.sin(a) * r0}
                      x2={it.cx + Math.cos(a) * r1}
                      y2={it.cy + Math.sin(a) * r1}
                      stroke={rayStroke}
                      strokeWidth={1.2}
                      strokeLinecap="round"
                      opacity={rayOpacity}
                    />
                  );
                })}
              </g>
            ) : null}
            {/* The ring's far half, behind the planet. */}
            {ringed ? (
              <ellipse
                className="system-map-ring"
                cx={it.cx}
                cy={it.cy}
                rx={ringRx}
                ry={ringRy}
                transform={ringTilt}
                fill="none"
                stroke="#d8c39a"
                strokeWidth={2.2}
                opacity={0.55}
                pointerEvents="none"
              />
            ) : null}
            <circle
              cx={it.cx}
              cy={it.cy}
              r={it.r}
              fill={neo.fill}
              stroke={neo.stroke}
              strokeWidth={sw}
              filter={neo.filter}
            />
            {/* …and its near half, across the planet's face. */}
            {ringed ? (
              <path
                className="system-map-ring"
                d={`M ${it.cx - ringRx} ${it.cy} A ${ringRx} ${ringRy} 0 0 0 ${it.cx + ringRx} ${it.cy}`}
                transform={ringTilt}
                fill="none"
                stroke="#e8d6ae"
                strokeWidth={2.2}
                opacity={0.95}
                pointerEvents="none"
              >
                <title>{`${it.rings} ring${it.rings === 1 ? "" : "s"}`}</title>
              </path>
            ) : null}
            {atmoRing ? (
              <circle
                cx={it.cx}
                cy={it.cy}
                r={it.r + Math.max(3, sw * 1.1)}
                fill="none"
                stroke={atmoRing}
                strokeWidth={1.15}
                strokeDasharray="3 5"
                strokeLinecap="round"
                opacity={0.95}
                style={{ filter: `drop-shadow(0 0 5px ${atmoRing})` }}
                pointerEvents="none"
              />
            ) : null}
            {/*
              Biology: a ring round the body with the signal count on it — orange when the samples
              would pay the first-footfall ×5, green otherwise.
            */}
            {bio > 0 ? (
              <g className="system-map-bio" pointerEvents="none">
                <circle
                  cx={it.cx}
                  cy={it.cy}
                  r={bioRingR}
                  fill="none"
                  stroke={it.firstFootfallX5 ? "#ffb060" : "#7be07b"}
                  strokeWidth={2.4}
                  opacity={0.95}
                />
                <rect
                  x={it.cx + bioRingR * 0.62}
                  y={it.cy - bioRingR - 3}
                  width={it.firstFootfallX5 ? 27 : 13}
                  height={12}
                  fill={it.firstFootfallX5 ? "#ff8a1f" : "#7be07b"}
                />
                <text
                  x={it.cx + bioRingR * 0.62 + (it.firstFootfallX5 ? 13.5 : 6.5)}
                  y={it.cy - bioRingR + 6.5}
                  textAnchor="middle"
                  fontSize={9.5}
                  fontWeight={800}
                  fill="#07060a"
                >
                  {it.firstFootfallX5 ? `${bio} ×5` : bio}
                </text>
              </g>
            ) : null}
            {/* Where the ship is: the game's marker, pointing down at the body. */}
            {it.youAreHere ? (
              <path
                className="system-map-you"
                d={`M ${it.cx - 6} ${it.cy - it.r - 16} L ${it.cx + 6} ${it.cy - it.r - 16} L ${it.cx} ${it.cy - it.r - 5} Z`}
                fill="#5fe0ff"
                stroke="#10333c"
                strokeWidth={1}
                pointerEvents="none"
              >
                <title>You are here</title>
              </path>
            ) : null}
            {it.mapLabel ? (
              <text
                x={it.cx}
                y={it.cy}
                textAnchor="middle"
                dominantBaseline="middle"
                className="system-map-svg-text"
                fill={neo.textFill}
                fontSize={it.bracketBary ? 8 : fs}
                fontWeight={800}
              >
                {it.mapLabel}
              </text>
            ) : null}
            <text
              x={namePos.x}
              y={namePos.y}
              textAnchor={namePos.anchor}
              className="system-map-svg-name"
              fill="#a8a4b8"
              fontSize={it.bracketBary ? 8 : 9}
            >
              {mapNodeNameLine(it)}
            </text>
            <title>{`${mapNodeNameLine(it)}${bio > 0 ? ` — ${bio} biological signal${bio === 1 ? "" : "s"}${it.firstFootfallX5 ? ", first footfall ×5" : ""}` : ""}${ringed ? ` — ${it.rings} ring${it.rings === 1 ? "" : "s"}` : ""}${it.youAreHere ? " — you are here" : ""}`}</title>
          </g>
        );
      })}
    </>
  );
}
