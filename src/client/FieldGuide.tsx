/**
 * The Encyclopedia's species card in the field-guide layout of the website's species page (owner,
 * 2026-09-29): photo, description, published conditions, where it was actually found, and mode
 * charts — here with the body the commander is looking at marked on every scale.
 *
 * Data: `/api/field-guide` (shared/fieldGuide.ts). The charts are the site's: equal-width bins over
 * the measured range, the bin holding the mode lit, a line on the mode. The body's own value is a
 * second line in the "matches" blue, or an arrow at the edge when it lies outside the measured range.
 */
import type { EstimatedSurfaceTempBand, PlanetScan, SpeciesMatchContext } from "@shared/types";
import {
  GUIDE_ATMO_PREFIX,
  GUIDE_PARAMS,
  guideBodyName,
  guideParam,
  guideStarClass,
  type GuideColours,
  type GuideGenus,
  type GuideHist,
  type GuideMeasured,
  type GuideRequirement,
  type GuideShare,
  type GuideSpecies,
} from "@shared/fieldGuide";
import { journalPressureToAtm } from "@shared/journalPhysics";
import { useState, type ReactNode } from "react";

/** One formatter for every chart label: `toLocaleString` per call was a tenth of the Encyclopedia's open. */
const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** A number the way a commander reads it: no false precision, thousands grouped. */
export function fmtGuide(v: number): string {
  const a = Math.abs(v);
  if (a >= 100) return GROUPED.format(Math.round(v));
  if (a >= 10) return String(Number(v.toFixed(1)));
  if (a >= 1) return String(Number(v.toFixed(2)));
  if (a === 0) return "0";
  return String(Number(v.toPrecision(2)));
}

const withUnit = (v: number, unit: string) =>
  unit === "" ? fmtGuide(v) : unit === "%" || unit === "°" ? `${fmtGuide(v)}${unit}` : `${fmtGuide(v)} ${unit}`;

export function fmtGuideCredits(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} M`;
  return `${Math.round(v / 1e3)} k`;
}

const pct = (n: number, total: number) => {
  const p = (n / total) * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
};

/* ------------------------------------------------------------------ the body being compared */

export interface GuideBody {
  label: string;
  /** Values in the guide's units, keyed by parameter id. */
  values: Record<string, number>;
  planet: string | null;
  atmosphere: string | null;
  volcanism: string | null;
  star: string | null;
  materials: Record<string, number>;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s+(atmosphere|volcanism)$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** "", "No volcanism" and "none" are the same thing. */
const normVolc = (s: string) => {
  const n = norm(s);
  return n === "" || n === "no" || n === "none" || n === "no volcanism" ? "no volcanism" : n;
};

export function guideBodyFrom(
  scan: PlanetScan | null,
  est: EstimatedSurfaceTempBand | null,
  ctx: SpeciesMatchContext | null,
  label: string,
): GuideBody | null {
  if (!scan) return null;
  const v: Record<string, number> = {};
  const put = (id: string, x: number | null | undefined) => {
    if (typeof x === "number" && Number.isFinite(x)) v[id] = x;
  };
  put("body.surfaceTemperature", scan.SurfaceTemperature ?? est?.midK ?? null);
  put("body.gravity", scan.SurfaceGravity != null ? scan.SurfaceGravity / 9.80665 : null);
  put("body.surfacePressure", scan.SurfacePressure != null ? journalPressureToAtm(scan.SurfacePressure) : null);
  put("body.distanceToArrival", scan.distanceFromArrivalLs ?? ctx?.distanceFromArrivalLs ?? null);
  put("body.radius", scan.radius != null ? scan.radius / 1000 : null);
  put("body.earthMasses", scan.MassEM);
  put("body.semiMajorAxis", scan.SemiMajorAxis != null ? scan.SemiMajorAxis / 1.495978707e11 : null);
  put("body.orbitalPeriod", scan.OrbitalPeriod != null ? scan.OrbitalPeriod / 86400 : null);
  put("body.rotationalPeriod", scan.RotationPeriod != null ? scan.RotationPeriod / 86400 : null);
  put("body.orbitalEccentricity", scan.Eccentricity);
  put("body.axialTilt", scan.AxialTilt != null ? (scan.AxialTilt * 180) / Math.PI : null);
  for (const [k, f] of Object.entries(scan.composition ?? {})) {
    const key = k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
    put(`body.solidComposition.${key}`, f <= 1 ? f * 100 : f);
  }
  for (const g of scan.atmosphereComposition ?? []) {
    const name = (g.Name ?? g.name ?? "").trim();
    const p = g.Percent ?? g.percent;
    if (name) put(`${GUIDE_ATMO_PREFIX}${name}`, p);
  }
  const materials: Record<string, number> = {};
  for (const m of scan.materials ?? []) {
    const name = (m.Name ?? m.name ?? "").trim();
    const p = m.Percent ?? m.percent;
    if (name && typeof p === "number") materials[name.charAt(0).toUpperCase() + name.slice(1)] = p;
  }
  const star = ctx?.parentStarType ? guideStarClass(ctx.parentStarType) : null;
  return {
    label,
    values: v,
    planet: scan.PlanetClass ? guideBodyName(scan.PlanetClass) : null,
    atmosphere: scan.Atmosphere != null ? scan.Atmosphere || "No atmosphere" : null,
    volcanism: scan.Volcanism != null ? scan.Volcanism || "No volcanism" : null,
    star,
    materials,
  };
}

/** The journal names gases one way and the corpus another ("CarbonDioxide", "Carbon dioxide"). */
function bodyValueFor(body: GuideBody | null, id: string): number | null {
  if (!body) return null;
  if (id in body.values) return body.values[id]!;
  if (id.startsWith(GUIDE_ATMO_PREFIX)) {
    const want = norm(id.slice(GUIDE_ATMO_PREFIX.length)).replace(/ /g, "");
    for (const [k, x] of Object.entries(body.values)) {
      if (k.startsWith(GUIDE_ATMO_PREFIX) && norm(k.slice(GUIDE_ATMO_PREFIX.length)).replace(/ /g, "") === want) return x;
    }
    return 0;
  }
  return null;
}

/* ------------------------------------------------------------------ charts */

const W = 240;
const H = 60;
const GAP = 2;

/** One mode-value chart, with the body's value on the same scale when there is one. */
function GuideChart({ id, h, bodyValue }: { id: string; h: GuideHist; bodyValue: number | null }) {
  const def = guideParam(id) ?? { id, label: id, unit: "" };
  const bins = h.counts.length;
  const peak = Math.max(...h.counts, 0);
  const span = h.max - h.min;
  const t = span > 0 ? Math.min(Math.max((h.mode - h.min) / span, 0), 1) : 0.5;
  const modeBin = Math.min(bins - 1, Math.floor(t * bins));
  const bw = W / bins;
  let bars = "";
  let lit = "";
  h.counts.forEach((c, i) => {
    if (!(c > 0) || !(peak > 0)) return;
    const bh = Math.max((c / peak) * (H - 4), 1.5);
    const d = `M${(i * bw + GAP / 2).toFixed(1)} ${H}v-${bh.toFixed(1)}h${(bw - GAP).toFixed(1)}v${bh.toFixed(1)}z`;
    if (i === modeBin) lit += d;
    else bars += d;
  });
  const x = (t * W).toFixed(1);
  let body: ReactNode = null;
  let where: "below" | "above" | "in" | null = null;
  if (bodyValue != null) {
    const raw = span > 0 ? (bodyValue - h.min) / span : 0.5;
    where = raw < 0 ? "below" : raw > 1 ? "above" : "in";
    const bx = (Math.min(Math.max(raw, 0), 1) * W).toFixed(1);
    body =
      where === "in" ? (
        <line className="fg-body-line" x1={bx} x2={bx} y1="0" y2={H} />
      ) : (
        <path
          className="fg-body-edge"
          d={where === "below" ? `M0 ${H / 2}l8 -6v12z` : `M${W} ${H / 2}l-8 -6v12z`}
        />
      );
  }
  const label = `${def.label}: from ${withUnit(h.min, def.unit)} to ${withUnit(h.max, def.unit)}, mode ${withUnit(h.mode, def.unit)}, measured on ${GROUPED.format(h.n)} bodies`;
  return (
    <figure className="fg-chart">
      <figcaption>
        <span className="fg-chart-k">{def.label}</span>
        <span className="fg-mode" title="The most common value">
          mode <b>{withUnit(h.mode, def.unit)}</b>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <path className="fg-bars" d={bars} />
        <path className="fg-bars-mode" d={lit} />
        <line className="fg-mode-line" x1={x} x2={x} y1="0" y2={H} />
        {body}
      </svg>
      <div className="fg-axis">
        <span>{withUnit(h.min, def.unit)}</span>
        <span>{withUnit(h.max, def.unit)}</span>
      </div>
      {bodyValue != null ? (
        <div className={`fg-body-val fg-body-val--${where}`} title="The body you are looking at">
          {where === "below" ? "◂ below the range · " : where === "above" ? "above the range ▸ · " : ""}this body{" "}
          <b>{withUnit(bodyValue, def.unit)}</b>
        </div>
      ) : null}
    </figure>
  );
}

/* ------------------------------------------------------------------ shares */

const SEG = ["var(--accent)", "var(--accent-bright)", "#c2561a", "#7be07b", "#ffd23f"];

const STAR_COLOUR: Record<string, string> = {
  O: "#6f8cff",
  B: "#8fb0ff",
  A: "#cfdcff",
  F: "#fff3c9",
  G: "#ffd966",
  K: "#ffa94d",
  M: "#ff6f4f",
  L: "#d8434b",
  T: "#a8407c",
  Y: "#7d4b3c",
  "Neutron star": "#00d4ff",
  "White dwarf": "#e9edff",
  "T Tauri": "#c9a0ff",
  "Herbig Ae/Be": "#9fe3ff",
  "Wolf-Rayet": "#b24bff",
  "Black hole": "#3a3f55",
  "Carbon / S": "#ff5533",
};

/** A stacked bar and its legend: the top four, the rest as "other"; the body's own class marked. */
function ShareRow({
  label,
  items,
  colour,
  mine,
  same = (a, b) => norm(a) === norm(b),
}: {
  label: string;
  items: GuideShare[];
  colour: (s: GuideShare, i: number) => string;
  mine: string | null;
  same?: (a: string, b: string) => boolean;
}) {
  const total = items.reduce((n, s) => n + s.n, 0);
  if (total === 0) return null;
  const top = items.slice(0, 4);
  const rest = total - top.reduce((n, s) => n + s.n, 0);
  const parts = top.map((s, i) => ({ label: s.label, n: s.n, c: colour(s, i) }));
  if (rest > 0) parts.push({ label: "Other", n: rest, c: "rgba(255, 230, 207, 0.22)" });
  const hit = mine != null ? items.find((s) => same(s.label, mine)) : undefined;
  const hitInTop = hit ? top.includes(hit) : false;
  return (
    <div className="fg-share">
      <dt>{label}</dt>
      <dd>
        <div className="fg-stack" aria-hidden="true">
          {parts.map((p) => (
            <i key={p.label} style={{ flexGrow: p.n, background: p.c }} title={`${p.label} ${pct(p.n, total)}`} />
          ))}
        </div>
        <ul className="fg-legend">
          {parts.map((p) => (
            <li key={p.label} className={hit && hitInTop && p.label === hit.label ? "fg-legend--mine" : undefined}>
              <i style={{ background: p.c }} />
              {p.label} <b>{pct(p.n, total)}</b>
            </li>
          ))}
          {mine != null ? (
            <li className={`fg-legend-body${hit ? "" : " fg-legend-body--none"}`} title="The body you are looking at">
              this body: {mine}
              {hit ? (hitInTop ? "" : ` · ${pct(hit.n, total)}`) : " · not seen"}
            </li>
          ) : null}
        </ul>
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ colours */

const SWATCH: Record<string, string> = {
  amethyst: "#9966cc",
  aquamarine: "#6fe3c4",
  blue: "#3b6cf6",
  brown: "#8b5a2b",
  cobalt: "#1f5fd1",
  cyan: "#00c8f0",
  emerald: "#2fbf71",
  gold: "#f5c542",
  green: "#43b047",
  grey: "#9aa0a6",
  indigo: "#5a4fcf",
  lime: "#a4e04a",
  magenta: "#e0309a",
  maroon: "#8b1e3f",
  mauve: "#c89bd6",
  mulberry: "#c54b8c",
  ocher: "#cc7722",
  orange: "#ff8c1a",
  peach: "#ffb38a",
  purple: "#8e44d6",
  red: "#e53935",
  rose: "#f06b9a",
  sage: "#9caf88",
  teal: "#1fb5ad",
  turquoise: "#40e0d0",
  white: "#f2f4fa",
  yellow: "#ffe14d",
};

const COLOUR_BY: Record<GuideColours["by"], string> = {
  star: "Colour follows the parent star",
  material: "Colour follows a material on the body",
  geology: "Colour follows the body’s geology",
};

export function GuideColoursBlock({ c }: { c: GuideColours | null }) {
  if (!c) return null;
  return (
    <div className="fg-colours">
      <p className="fg-sub">{COLOUR_BY[c.by]}</p>
      <ul className="fg-swatches">
        {c.map.map(([k, name]) => (
          <li key={k} title={`${k}: ${name}`}>
            <i style={{ background: SWATCH[name.toLowerCase().split(/[\s/]/)[0]!] ?? "transparent" }} />
            <span className="fg-sw-k">{k}</span> {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GuideRequires({ list }: { list: GuideRequirement[] }) {
  if (list.length === 0) return null;
  return (
    <dl className="fg-req">
      {list.map((r, i) => (
        <div key={`${r.label}-${i}`}>
          <dt>{r.label}</dt>
          <dd>{r.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ measured block */

export function GuideMeasuredBlock({ m, body }: { m: GuideMeasured; body: GuideBody | null }) {
  const [more, setMore] = useState(false);
  const star = (x: GuideShare, i: number) => STAR_COLOUR[x.label] ?? SEG[i % SEG.length]!;
  const seg = (_: GuideShare, i: number) => SEG[i % SEG.length]!;
  const core = GUIDE_PARAMS.filter((p) => p.core && m.hist[p.id]);
  const rest = [
    ...GUIDE_PARAMS.filter((p) => !p.core).map((p) => p.id),
    ...Object.keys(m.hist).filter((id) => !GUIDE_PARAMS.some((p) => p.id === id)),
  ].filter((id) => m.hist[id]);
  return (
    <>
      <div className="fg-found">
        <p className="fg-sub">
          Measured on <b>{GROUPED.format(m.bodies)}</b> bodies where it was confirmed
        </p>
        <dl className="fg-shares">
          <ShareRow label="Body" items={m.planet} colour={seg} mine={body?.planet ?? null} />
          <ShareRow label="Atmosphere" items={m.atmosphere} colour={seg} mine={body?.atmosphere ?? null} />
          <ShareRow
            label="Volcanism"
            items={m.volcanism}
            colour={seg}
            mine={body?.volcanism ?? null}
            same={(a, b) => normVolc(a) === normVolc(b)}
          />
          <ShareRow label="Host star" items={m.star} colour={star} mine={body?.star ?? null} same={(a, b) => a === b} />
        </dl>
        {m.locked != null ? <p className="fg-sub">Tidally locked on {pct(m.locked, 1)} of them.</p> : null}
      </div>
      <div className="fg-charts">
        {core.map((p) => (
          <GuideChart key={p.id} id={p.id} h={m.hist[p.id]!} bodyValue={bodyValueFor(body, p.id)} />
        ))}
      </div>
      {rest.length || m.materials.length ? (
        <details className="fg-more" onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
          <summary>More measurements</summary>
          {more ? (
            <div className="fg-more-body">
              <div className="fg-charts">
                {rest.map((id) => (
                  <GuideChart key={id} id={id} h={m.hist[id]!} bodyValue={bodyValueFor(body, id)} />
                ))}
              </div>
              {m.materials.length ? (
                <>
                  <h5 className="fg-h">Surface materials</h5>
                  <p className="fg-sub">
                    The most common share of each, and how many of the bodies carry it
                    {body ? "; the body's own share beside it" : ""}.
                  </p>
                  <ul className="fg-mats">
                    {m.materials.map((x) => {
                      const mine = body?.materials[x.name];
                      return (
                        <li key={x.name}>
                          <span>{x.name}</span>
                          <b>{fmtGuide(x.mode)}%</b>
                          <small>{pct(x.n, m.bodies)}</small>
                          {body ? (
                            <em className={mine == null ? "fg-mat-none" : undefined}>
                              {mine == null ? "—" : `${fmtGuide(mine)}%`}
                            </em>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </details>
      ) : null}
    </>
  );
}

/** The genus heading's field-guide part: description, genus-wide conditions, colour table. */
export function GuideGenusIntro({ g }: { g: GuideGenus | undefined }) {
  if (!g) return null;
  if (!g.description && g.requires.length === 0 && !g.colours) return null;
  return (
    <div className="fg-genus-intro">
      {g.description ? <p className="fg-gdesc">{g.description}</p> : null}
      {g.sampleDistanceM ? <span className="fg-chip">Clonal range {g.sampleDistanceM.toLocaleString("en-US")} m</span> : null}
      <GuideRequires list={g.requires} />
      <GuideColoursBlock c={g.colours} />
    </div>
  );
}

export type { GuideSpecies };
