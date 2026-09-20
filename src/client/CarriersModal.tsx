/**
 * Carriers — fleet carriers near the commander, from EDAstro.
 *
 * **Empty until asked.** The app holds no carrier data and fetches none on its own: the first thing
 * this panel shows is a button and a sentence saying what pressing it will do. 21 MB leaves
 * somebody else's server when the commander decides it should, not when a panel opens.
 *
 * ### Why every row shows two ages
 *
 * A carrier's position is only known when a commander aboard it sends an event to EDDN, so the
 * record is always a sighting rather than a location. Measured across the whole 2026-09-19 file:
 * **median dwell is 1 day**, two thirds of recently-seen carriers had moved inside the window, and
 * p90 dwell is 180 days. The population is bimodal — working carriers hop constantly, parked ones
 * have sat for half a year — and deep space is where it hurts, with Vista Genomics carriers beyond
 * 5,000 ly a **median 35 days** since anyone saw them.
 *
 * So the row says *last seen* and *parked*, and never "is at":
 *
 * - **parked 180 d, seen 12 d ago** — still there. Worth the trip.
 * - **moved 1 d ago, seen 1 d ago** — freshest possible record, worthless prediction.
 *
 * A staler record on a long-parked carrier beats a fresher one on a mover. That is backwards from
 * instinct, which is exactly why both numbers are on screen instead of one confidence score.
 */
import { useCallback, useEffect, useState } from "react";
import { CARRIER_SERVICE_OPTIONS, carrierServiceLabel } from "@shared/carrierServices";
import { Tooltip } from "./ui/Tooltip";
import { useModal } from "./ui/useModal";
import type { CarrierQueryResultDTO, CarrierRowDTO } from "@shared/types";

/** Light years at a precision matching how far away the thing is. Mirrors the backlog panel's. */
function ly(d: number | null): string {
  if (d == null) return "—";
  if (d < 1) return "here";
  if (d >= 10000) return `${(d / 1000).toFixed(1)} kly`;
  return `${Math.round(d).toLocaleString("en-US")} ly`;
}

function ageLabel(days: number | null): string {
  if (days == null) return "unknown";
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  if (days < 90) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

/**
 * How much to trust the row, stated as words rather than a score.
 *
 * The thresholds come from the file's own shape (§4 of `docs/edastro-integration.md`): p75 dwell is
 * 13 days and p90 is 180, so 30 days is comfortably inside the parked population and 2 days is
 * inside the working one.
 */
function dwellVerdict(row: CarrierRowDTO): { text: string; tone: "good" | "warn" | "dim" } {
  if (row.dwellDays == null) return { text: "unknown", tone: "dim" };
  if (row.dwellDays >= 30) return { text: `parked ${ageLabel(row.dwellDays)}`, tone: "good" };
  // Zero dwell is the commonest value in the file and it needs its own words: it means the carrier
  // jumped on the very day someone saw it. "moved today before", which is what a naive age label
  // produces here, reads as broken English on the most frequent row in the panel.
  if (row.dwellDays === 0) return { text: "moved that day", tone: "warn" };
  if (row.dwellDays <= 2) return { text: `moved after ${ageLabel(row.dwellDays)}`, tone: "warn" };
  return { text: `sat ${ageLabel(row.dwellDays)}`, tone: "dim" };
}

/** Sighting ages, as chips. 0 means "any", which is the honest default for deep space. */
const SEEN_FILTERS = [0, 7, 30, 90] as const;
const seenLabel = (n: number) => (n === 0 ? "Any age" : `Seen ≤ ${n}d`);

export function CarriersModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const [data, setData] = useState<CarrierQueryResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [services, setServices] = useState<string[]>([]);
  const [maxSeen, setMaxSeen] = useState<number>(0);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (services.length) params.set("services", services.join(","));
    if (maxSeen) params.set("maxLastSeenDays", String(maxSeen));
    params.set("limit", "200");
    try {
      const res = await fetch(`/api/carriers/query?${params.toString()}`);
      if (!res.ok) throw new Error(`Query failed (${res.status})`);
      setData((await res.json()) as CarrierQueryResultDTO);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [services, maxSeen]);

  useEffect(() => {
    void load();
  }, [load]);

  const fetchFromEdastro = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/carriers/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!body.ok) setError(body.error ?? "EDAstro fetch failed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleService = (key: string) =>
    setServices((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const status = data?.status;
  const haveData = status?.haveData === true;
  const cooling = (status?.cooldownMsRemaining ?? 0) > 0;
  const rows = data?.rows ?? [];

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-panel fdb-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Carriers"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="fdb-head">
          <div>
            <h2 className="fdb-title">Carriers</h2>
            <p className="dim fdb-sub">
              Fleet carriers near you, from{" "}
              <a href="https://edastro.com" target="_blank" rel="noreferrer">
                EDAstro
              </a>
              . Positions are <strong>last sightings</strong>, not live — a carrier is only reported
              when someone aboard it is running a journal uploader.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="carriers-fetch">
          <button
            type="button"
            className="fdb-chip fdb-chip--on"
            onClick={() => void fetchFromEdastro()}
            disabled={busy || cooling}
          >
            {busy ? "Fetching…" : haveData ? "Refresh from EDAstro" : "Fetch from EDAstro"}
          </button>
          <span className="dim">
            {busy
              ? "Downloading ~21 MB from edastro.com."
              : haveData
                ? `${status?.rowCount.toLocaleString("en-US")} carriers · data from ${
                    status?.sourceLastModified ?? "an unknown date"
                  }`
                : "Downloads a ~21 MB file from edastro.com to this machine. Nothing is sent anywhere."}
          </span>
          {cooling ? (
            <span className="dim">
              Rebuilt about once a day upstream — next fetch in{" "}
              {Math.ceil((status?.cooldownMsRemaining ?? 0) / 60000)} min.
            </span>
          ) : null}
        </div>

        {error ? <p className="fdb-empty">{error}</p> : null}

        {!haveData && !busy ? (
          <p className="fdb-empty">
            No data. Click <strong>Fetch from EDAstro</strong> above to download the carrier list.
          </p>
        ) : null}

        {haveData ? (
          <>
            <div className="fdb-filters">
              {CARRIER_SERVICE_OPTIONS.map((opt) => (
                <Tooltip key={opt.key} text={opt.hint}>
                  <button
                    type="button"
                    className={`fdb-chip${services.includes(opt.key) ? " fdb-chip--on" : ""}`}
                    onClick={() => toggleService(opt.key)}
                    aria-pressed={services.includes(opt.key)}
                  >
                    {opt.label}
                  </button>
                </Tooltip>
              ))}
              <span className="fdb-filters__gap" />
              {SEEN_FILTERS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`fdb-chip${maxSeen === n ? " fdb-chip--on" : ""}`}
                  onClick={() => setMaxSeen(n)}
                  aria-pressed={maxSeen === n}
                >
                  {seenLabel(n)}
                </button>
              ))}
            </div>

            <div className="fdb-summary">
              <span>
                <strong>{rows.length}</strong> shown
              </span>
              {data && data.matchCount > rows.length ? (
                <span className="dim">of {data.matchCount.toLocaleString("en-US")} matching</span>
              ) : null}
              {!data?.origin ? (
                <span className="dim">
                  No position yet — jump once and distances appear.
                </span>
              ) : null}
            </div>

            <table className="fdb-table carriers-table">
              <thead>
                <tr>
                  <th>Distance</th>
                  <th>Carrier</th>
                  <th>System</th>
                  <th>Last seen</th>
                  <th>Stability</th>
                  <th>Services</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const verdict = dwellVerdict(r);
                  return (
                    <tr key={`${r.callsign}-${r.systemAddress ?? r.system}`}>
                      <td>{ly(r.distanceLy)}</td>
                      <td>
                        <strong>{r.callsign}</strong>
                        {r.name ? <span className="dim"> {r.name}</span> : null}
                      </td>
                      <td>
                        {r.system || "—"}
                        {r.region ? <span className="dim"> · {r.region}</span> : null}
                      </td>
                      <td>{ageLabel(r.lastSeenDays)} ago</td>
                      <td className={`carriers-dwell carriers-dwell--${verdict.tone}`}>
                        {verdict.text}
                      </td>
                      <td className="dim">
                        {r.services
                          .filter((s) => CARRIER_SERVICE_OPTIONS.some((o) => o.key === s))
                          .map(carrierServiceLabel)
                          .join(", ") || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {rows.length === 0 ? (
              <p className="fdb-empty">
                Nothing matches those filters. Out in the black the sighting ages are long — try{" "}
                <strong>Any age</strong>.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
