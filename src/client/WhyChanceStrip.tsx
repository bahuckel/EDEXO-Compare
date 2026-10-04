/**
 * "Why this chance" (owner, 2026-10-04, plan 3.3): under a card's chance, a strip of tiny charts — where
 * this species has been found for temperature, gravity and pressure, with this body marked — so the
 * percentage can be read rather than taken on trust. The Encyclopedia's distribution chart, 60 px tall.
 *
 * The data is the card's habitat detail (useMatchDetail), fetched only when the strip is opened.
 */
import type { ExomasteryDetailDTO, ExomasteryStatDetailDTO } from "@shared/types";

const W = 96;

/** "surface Temperature" → "Temperature": the strip has no room for the profile's path names. */
function shortLabel(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("temperature")) return "Temperature";
  if (l.includes("gravity")) return "Gravity";
  if (l.includes("pressure")) return "Pressure";
  return label;
}
const H = 30;

/** One stat as bars of where it was found (density, as the big chart) and a line for this body. */
function Spark({ stat }: { stat: ExomasteryStatDetailDTO }) {
  const d = stat.distribution;
  if (!d) return null;
  const span = d.max - d.min;
  const toX = (v: number) => (span > 0 ? ((v - d.min) / span) * W : W / 2);
  const bins = d.bins ?? [];
  const dens = bins.map((b) => (b.x1 > b.x0 ? b.count / (b.x1 - b.x0) : 0));
  const peak = Math.max(0, ...dens);
  const cur = d.current;
  const inside = cur != null && Number.isFinite(cur) && cur >= d.min && cur <= d.max;
  const curX = cur != null && Number.isFinite(cur) ? Math.max(0, Math.min(W, toX(cur))) : null;
  return (
    <div className={`why-chance__stat${cur != null && !inside ? " why-chance__stat--out" : ""}`}>
      <span className="why-chance__label">{shortLabel(stat.label)}</span>
      <svg className="why-chance__chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        {peak > 0
          ? bins.map((b, i) => {
              const h = (dens[i]! / peak) * (H - 4);
              return (
                <rect
                  key={i}
                  className="why-chance__bar"
                  x={toX(b.x0)}
                  y={H - h}
                  width={Math.max(toX(b.x1) - toX(b.x0) - 0.4, 0.6)}
                  height={h}
                />
              );
            })
          : // No histogram in the profile: the range alone, as a band.
            <rect className="why-chance__bar" x={0} y={H - 6} width={W} height={6} />}
        {curX != null ? <line className="why-chance__here" x1={curX} x2={curX} y1={0} y2={H} /> : null}
      </svg>
      <span className="why-chance__values">
        <span title="This body">{stat.currentDisplay}</span>
        <span className="dim" title="Where it is most often found">
          {" "}
          · typ. {stat.typicalDisplay}
        </span>
      </span>
    </div>
  );
}

export function WhyChanceStrip({ detail, loading }: { detail: ExomasteryDetailDTO | null; loading: boolean }) {
  if (loading && !detail) return <div className="why-chance why-chance--note dim">Loading where it has been found…</div>;
  // Temperature, gravity, pressure — wherever the profile filed them (gravity is not always "climate").
  const all = [...(detail?.atmosphereClimateStats ?? []), ...(detail?.stats ?? [])];
  const stats = ["Temperature", "Gravity", "Pressure"]
    .map((want) => all.find((s) => s.distribution && shortLabel(s.label) === want))
    .filter((s): s is ExomasteryStatDetailDTO => !!s);
  if (!stats.length)
    return <div className="why-chance why-chance--note dim">No measured range for this species yet.</div>;
  return (
    <div className="why-chance" aria-label="Where this species has been found, and this body">
      {stats.map((s) => (
        <Spark key={s.id} stat={s} />
      ))}
      <div className="why-chance__note dim">Bars: where it has been found. Line: this body. Red: outside every find.</div>
    </div>
  );
}
