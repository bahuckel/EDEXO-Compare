import type { EstimatedSurfaceTempBand } from "@shared/types";
import { temperatureParts, type TempUnit } from "./planetDisplayUtils";

/** Journal value first, the estimated band dimmed beside it (owner, D2). See `temperatureParts`. */
export function TemperatureLabel({
  journalK,
  est,
  unit,
}: {
  journalK: number | null | undefined;
  est: EstimatedSurfaceTempBand | null;
  unit: TempUnit;
}) {
  const p = temperatureParts(journalK, est, unit);
  return (
    <>
      {p.main}
      {p.est ? <span className="temp-est"> {p.est}</span> : null}
    </>
  );
}
