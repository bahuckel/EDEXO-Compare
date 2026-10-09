/**
 * "GGG ladder" (owner, 2026-10-09: "In the sidebar, new drawer/extended down called GGG ladder, it
 * represents where that gas giant stands on it based on Arcanic's formula"). A drawer in the system
 * map's body panel for every gas and water giant: its seven cloud layers against its class's colour
 * borders, with the density that spaces them, the nudge range, and the ladder's verdict. The maths is
 * shared/gggLadder.ts, a port of his own code.
 */
import type { SystemMapBodyDetailDTO } from "@shared/types";
import {
  cracksOf,
  gasGiantDensity,
  ladderClassOf,
  ladderGreen,
  ladderRungs,
  nudgeOf,
  nudgeRange,
  type LadderClass,
} from "@shared/gggLadder";
import { EDGGG_URL } from "@shared/greenGasGiant";
import { isBool, usePersistedState } from "./usePersistedState";

const CLASS_NAME: Record<LadderClass, string> = {
  I: "class I",
  II: "class II",
  III: "class III",
  IV: "class IV",
  V: "class V",
  ammonia: "ammonia-based life",
  water: "water-based life",
  waterGiant: "water giant",
  heliumRich: "helium-rich",
  helium: "helium",
};

const fmtK = (k: number) => `${k.toFixed(Number.isInteger(k) ? 0 : 2)} K`;

/** The layers and borders on one scale: borders as ticks, layers as dots, a layer on a border green. */
function LadderScale({ rungs, cracks, onCrack }: { rungs: number[]; cracks: readonly number[]; onCrack: Set<number> }) {
  const W = 260;
  const H = 46;
  const pad = 14;
  const lo = rungs[0]!;
  const hi = rungs[rungs.length - 1]!;
  // The borders just outside the layers too, so a near one shows how near.
  const near = cracks.filter((c) => c >= lo - (hi - lo) * 0.35 - 5 && c <= hi + (hi - lo) * 0.35 + 5);
  const min = Math.min(lo, ...near);
  const max = Math.max(hi, ...near);
  const span = max - min || 1;
  const x = (k: number) => pad + ((k - min) / span) * (W - 2 * pad);
  return (
    <svg className="ggg-ladder__scale" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Cloud layers against the colour borders">
      <line x1={pad} x2={W - pad} y1={22} y2={22} stroke="rgba(170,180,200,0.45)" strokeWidth={1} />
      {near.map((c) => (
        <g key={c}>
          <line x1={x(c)} x2={x(c)} y1={8} y2={36} stroke="rgba(111,227,138,0.75)" strokeWidth={1.2} strokeDasharray="3 2" />
          <text x={x(c)} y={45} textAnchor="middle" fontSize={8} fill="rgba(111,227,138,0.9)">
            {c} K
          </text>
        </g>
      ))}
      {rungs.map((r, i) => (
        <g key={i}>
          <circle
            cx={x(r)}
            cy={22}
            r={onCrack.has(i) ? 5 : 3.2}
            fill={onCrack.has(i) ? "rgb(111,227,138)" : "rgb(255,179,71)"}
            stroke="#07080c"
            strokeWidth={1}
          />
          <text x={x(r)} y={11} textAnchor="middle" fontSize={8} fill="rgba(220,220,230,0.85)">
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function GggLadderDrawer({ detail }: { detail: SystemMapBodyDetailDTO }) {
  const [open, setOpen] = usePersistedState("systemMap.gggLadderOpen", false, isBool);
  const cls = ladderClassOf(detail.planetClass);
  if (!cls) return null;
  const T = detail.surfaceTemperature;
  const known = T != null && Number.isFinite(T) && T > 0;
  const m = detail.massEM;
  const r = detail.radius;
  const density = m != null && r != null && m > 0 && r > 0 ? gasGiantDensity(m, r) : null;
  const rungs = known ? ladderRungs(cls, T, density) : [];
  const cracks = cracksOf(cls);
  const nudge = known ? nudgeOf(cls, T) : "none";
  const [nLo, nHi] = nudgeRange(cls);
  const verdict = known ? ladderGreen({ planetClass: detail.planetClass, tempK: T, massEM: m, radiusM: r }) : null;
  // Layers exactly on a border (his "green"); the verdict may also name a near miss the rounding closes.
  const onCrack = new Set<number>();
  rungs.forEach((x, i) => {
    if (cracks.includes(x)) onCrack.add(i);
  });
  if (verdict) onCrack.add(verdict.rung - 1);

  return (
    <details className="ggg-ladder" open={open} onToggle={(ev) => setOpen((ev.currentTarget as HTMLDetailsElement).open)}>
      <summary className="ggg-ladder__summary">
        GGG ladder
        <span className="ggg-ladder__sub">
          {CLASS_NAME[cls]}
          {known ? ` · ${fmtK(T)}` : ""}
          {verdict ? " · a layer on a border" : ""}
        </span>
      </summary>
      {!known ? (
        <p className="ggg-ladder__note">No surface temperature yet: scan the giant in the FSS and its ladder appears here.</p>
      ) : (
        <>
          <LadderScale rungs={rungs} cracks={cracks} onCrack={onCrack} />
          <ol className="ggg-ladder__rungs">
            {rungs.map((x, i) => {
              const nearest = cracks.reduce((a, c) => (Math.abs(c - x) < Math.abs(a - x) ? c : a), cracks[0]!);
              const off = x - nearest;
              return (
                <li key={i} className={onCrack.has(i) ? "ggg-ladder__rung--hit" : undefined}>
                  <span>{fmtK(x)}</span>
                  <span className="ggg-ladder__off">
                    {onCrack.has(i) ? `on the ${nearest} K border` : `${Math.abs(off).toFixed(2)} K ${off < 0 ? "below" : "above"} ${nearest} K`}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="ggg-ladder__note">
            {density != null
              ? `Density ${Math.round(density).toLocaleString("en-US")} kg/m³ spaces the layers.`
              : "No mass or radius scanned: the layers assume the clouds reach their ceiling."}{" "}
            Colour borders for this class: {cracks.join(", ")} K.
          </p>
          {Number.isInteger(T) ? (
            <p className="ggg-ladder__note">
              A whole-kelvin temperature comes from EDSM or Spansh, rounded: the ladder needs the game&apos;s own value from
              your scan.
            </p>
          ) : null}
          <p className="ggg-ladder__note">
            {nudge === "always"
              ? `Below ${nLo} K the game always nudges the temperature before it builds the ladder, so the ladder cannot say.`
              : nudge === "maybe"
                ? `Between ${nLo} and ${nHi} K the game may nudge the temperature first: a border hit holds only if it did not.`
                : `Outside the nudge range (${nLo}–${nHi} K): the ladder reads this temperature as it is.`}
          </p>
          <p className={`ggg-ladder__verdict${verdict ? " ggg-ladder__verdict--green" : ""}`}>
            {verdict
              ? `Layer ${verdict.rung} lands on the ${verdict.door} K border: green by the ladder${verdict.offUlp ? " (within the scan's rounding)" : ""}${verdict.nudge === "maybe" ? ", if the nudge left it alone" : ""}.`
              : nudge === "always"
                ? "No verdict: always nudged at this temperature."
                : "No layer lands on a border: not green by the ladder."}
          </p>
          <p className="ggg-ladder__credit">
            CMDR Arcanic&apos;s cloud ladder, as on{" "}
            <a href={EDGGG_URL} target="_blank" rel="noopener noreferrer">
              edGGG
            </a>
            .
          </p>
        </>
      )}
    </details>
  );
}
