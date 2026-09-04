import type { DScanBodiesDTO } from "@shared/types";

const TITLE =
  "Total bodies = FSS honk BodyCount / FSSAllBodiesFound when present; otherwise from merged journal Scan rows, EDSM map data, and the drawn system map. Found = physical bodies on the system map when available, else Scan/Progress fallback.";

export function DScanBodiesBadge({
  d,
  className,
  headerMetrics,
}: {
  d: DScanBodiesDTO;
  className?: string;
  /** When true, typography matches header Data value / Route metrics. */
  headerMetrics?: boolean;
}) {
  const complete = d.complete || d.found >= d.total;
  const lbl = headerMetrics ? "d-scan-card__label header-metric-card-label" : "d-scan-card__label";
  const val = headerMetrics ? "header-metric-card-value" : "";
  return (
    <span
      className={`d-scan-card${complete ? " d-scan-card--complete" : ""}${className ? ` ${className}` : ""}`}
      title={`${d.systemName} — ${TITLE}`}
    >
      <span className={lbl}>D-Scan</span>
      <span className={`d-scan-card__sys${val ? ` ${val}` : ""}`}>{d.systemName}</span>
      <span className={`d-scan-card__sep${val ? ` ${val}` : ""}`}> - </span>
      <span className={`d-scan-card__nums${val ? ` ${val}` : ""}`}>
        {d.found} / {d.total}
      </span>
      <span className={`d-scan-card__suffix${val ? ` ${val}` : ""}`}> bodies</span>
    </span>
  );
}
