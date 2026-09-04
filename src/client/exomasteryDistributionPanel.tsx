import type { ExomasteryStatDistributionDTO } from "@shared/types";
import { useMemo } from "react";

function nearlyEqual(a: number, b: number): boolean {
  const s = Math.max(Math.abs(a), Math.abs(b), 1e-30);
  return Math.abs(a - b) <= 1e-9 * s;
}

export function ExomasteryDistributionPanel({
  label,
  distribution: d,
}: {
  label: string;
  distribution: ExomasteryStatDistributionDTO;
}) {
  const chart = useMemo(() => {
    const w = 300;
    const h = 88;
    const pad = { l: 10, r: 10, t: 12, b: 16 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const { min, max, mode, current } = d;
    const baseY = pad.t + plotH;
    const minTX = pad.l;
    const maxTX = pad.l + plotW;
    const degenerate = nearlyEqual(min, max);
    const centerX = pad.l + plotW / 2;
    const peakY = pad.t + 5;

    if (degenerate) {
      const lineD = `M ${centerX.toFixed(2)} ${baseY.toFixed(2)} L ${centerX.toFixed(2)} ${peakY.toFixed(2)}`;
      const modeY = peakY + 2;
      const currentX =
        current != null && Number.isFinite(current) && nearlyEqual(current, min) ? centerX : null;
      return {
        w,
        h,
        degenerate: true,
        lineD,
        fillD: null as string | null,
        modeX: centerX,
        modeY,
        currentX,
        baseY,
        minTX,
        maxTX,
        topY: pad.t,
        singleTickX: centerX,
      };
    }

    const span = max - min;
    const toX = (v: number) => pad.l + ((v - min) / span) * plotW;
    const modeX = toX(mode);
    const currentX = current != null && Number.isFinite(current) ? toX(current) : null;
    const sigma = Math.max(span * 0.17, 1e-9);
    const gauss = (x: number) => Math.exp(-0.5 * ((x - mode) / sigma) ** 2);
    const steps = 96;
    let peak = 0;
    const pts: { x: number; gy: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const xv = min + (span * i) / steps;
      const gv = gauss(xv);
      peak = Math.max(peak, gv);
      pts.push({ x: toX(xv), gy: gv });
    }
    peak = Math.max(peak, 1e-9);
    const toY = (gv: number) => pad.t + plotH - (gv / peak) * plotH;
    const lineD = pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${toY(p.gy).toFixed(2)}`)
      .join(" ");
    const x0 = pts[0]!.x;
    const x1 = pts[pts.length - 1]!.x;
    const fillD = `${lineD} L ${x1.toFixed(2)} ${baseY.toFixed(2)} L ${x0.toFixed(2)} ${baseY.toFixed(2)} Z`;

    return {
      w,
      h,
      degenerate: false,
      lineD,
      fillD,
      modeX,
      modeY: toY(gauss(mode)),
      currentX,
      baseY,
      minTX,
      maxTX,
      topY: pad.t,
      singleTickX: null as number | null,
    };
  }, [d]);

  return (
    <div className="exo-dist-panel" aria-label={`${label} distribution`}>
      <div className="exo-dist-panel-title">{label}</div>
      <svg
        className="exo-dist-svg"
        viewBox={`0 0 ${chart.w} ${chart.h}`}
        width="100%"
        height={chart.h}
        preserveAspectRatio="xMidYMid meet"
      >
        <line
          x1={chart.minTX}
          x2={chart.maxTX}
          y1={chart.baseY}
          y2={chart.baseY}
          className="exo-dist-baseline"
        />
        {chart.degenerate && chart.singleTickX != null ? (
          <line
            x1={chart.singleTickX}
            x2={chart.singleTickX}
            y1={chart.baseY - 5}
            y2={chart.baseY + 5}
            className="exo-dist-tick"
          />
        ) : (
          <>
            <line
              x1={chart.minTX}
              x2={chart.minTX}
              y1={chart.baseY - 5}
              y2={chart.baseY + 5}
              className="exo-dist-tick"
            />
            <line
              x1={chart.maxTX}
              x2={chart.maxTX}
              y1={chart.baseY - 5}
              y2={chart.baseY + 5}
              className="exo-dist-tick"
            />
          </>
        )}
        {chart.fillD ? <path d={chart.fillD} className="exo-dist-fill" /> : null}
        <path d={chart.lineD} className="exo-dist-line" fill="none" />
        <circle cx={chart.modeX} cy={chart.modeY} r={3.2} className="exo-dist-mode-dot" />
        {chart.currentX != null ? (
          <line
            x1={chart.currentX}
            x2={chart.currentX}
            y1={chart.topY}
            y2={chart.baseY}
            className="exo-dist-current-line"
          />
        ) : null}
      </svg>
      <div className="exo-dist-range-foot">
        <span className="exo-dist-range-min">{d.minLabel}</span>
        <span className="exo-dist-range-max">{d.maxLabel}</span>
      </div>
    </div>
  );
}
