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
import { useCallback, useEffect, useRef, useState } from "react";
import { CARRIER_SERVICE_OPTIONS, carrierServiceLabel } from "@shared/carrierServices";
import { CARRIER_NETWORKS } from "@shared/carrierNetworks";
import { Tooltip } from "./ui/Tooltip";
import { useModal } from "./ui/useModal";
import type { CarrierLiveFixDTO, CarrierQueryResultDTO, CarrierRowDTO } from "@shared/types";

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

/**
 * The sighting age as a phrase.
 *
 * Separate from {@link ageLabel} because "today" and "1 day" want different words after them, and a
 * cell that appends " ago" to every label produces "today ago" -- which it did, on every carrier
 * seen in the last 24 hours.
 */
function lastSeenPhrase(days: number | null): string {
  if (days == null) return "unknown";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${ageLabel(days)} ago`;
}

/** How old Spansh's sighting is, in whole days, or null when it carries no date. */
function spanshAgeDays(updatedAt: string | null): number | null {
  if (!updatedAt) return null;
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/**
 * What Spansh added, if anything.
 *
 * The first version of this said only "Spansh agrees", which was true and useless: it answered
 * neither of the two questions the commander has. **Has it moved** is one; **does anyone have a more
 * recent sighting** is the other, and a source that agrees on the system but saw it yesterday turns a
 * ten-month-old row into a usable one. Agreement on a *staler* sighting adds nothing at all and
 * should not be dressed up as confirmation.
 *
 * Measured on 16 carriers: Spansh newer on 9, EDAstro newer on 3, same on 3 — so all three verdicts
 * happen often enough to be worth naming.
 */
function liveVerdict(
  fix: CarrierLiveFixDTO,
  rowSeenDays: number | null,
): { tone: "differs" | "newer" | "flat"; text: string } {
  const age = spanshAgeDays(fix.updatedAt);
  const seen = age == null ? "unknown" : lastSeenPhrase(age);
  if (fix.differs) {
    return { tone: "differs", text: `moved — Spansh saw it in ${fix.system || "an unknown system"}, ${seen}` };
  }
  if (age != null && rowSeenDays != null && age < rowSeenDays) {
    return { tone: "newer", text: `still there ${seen} — Spansh is newer` };
  }
  return { tone: "flat", text: `same system, Spansh saw it ${seen}` };
}

/** The Spansh answer for a row, or null while it is absent, loading or failed. */
type LiveState = CarrierLiveFixDTO | { error: string } | "loading" | undefined;

function liveFix(state: LiveState): CarrierLiveFixDTO | null {
  return state && state !== "loading" && !("error" in state) ? state : null;
}

/**
 * The second opinion, under the row's own stability verdict.
 *
 * Deliberately nothing until pressed. One press is one small POST for one carrier, which is a
 * different bargain from the 21 MB catalogue and wants no cooldown — but it is also not something to
 * fire for two hundred rows because a panel opened.
 */
function CarrierLive({
  state,
  rowSeenDays,
  onCheck,
}: {
  state: LiveState;
  rowSeenDays: number | null;
  onCheck: () => void;
}) {
  if (state === "loading") return <div className="dim carriers-live">checking Spansh…</div>;

  if (state && "error" in state) {
    return (
      <div className="carriers-live">
        <span className="dim">{state.error}</span>{" "}
        <button type="button" className="carriers-live__btn" onClick={onCheck}>
          retry
        </button>
      </div>
    );
  }

  if (state) {
    const v = liveVerdict(state, rowSeenDays);
    return (
      <div className={`carriers-live carriers-live--${v.tone}`}>
        {v.tone === "flat" ? <span className="dim">{v.text}</span> : <strong>{v.text}</strong>}
      </div>
    );
  }

  return (
    <div className="carriers-live">
      <button type="button" className="carriers-live__btn" onClick={onCheck}>
        Check Spansh
      </button>
    </div>
  );
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
  const [dssaOnly, setDssaOnly] = useState(false);
  const [networkKey, setNetworkKey] = useState("");
  /*
    Per-row Spansh answers, keyed by callsign.

    Kept beside the list rather than merged into it, because the two sources disagree in both
    directions -- measured on 16 carriers, Spansh was newer on 9 and EDAstro on 3 -- so this is a
    second opinion shown next to the first, never a correction applied over it.
  */
  const [live, setLive] = useState<Record<string, CarrierLiveFixDTO | { error: string } | "loading">>(
    {},
  );
  const [searchInput, setSearchInput] = useState("");
  /*
    The query the server actually sees, a beat behind the box.

    Each keystroke otherwise scans 90,077 carriers and re-renders up to 200 rows. 200 ms is below
    the point where the list feels detached from the typing and well above a burst of fast typing.
  */
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  /*
    Which request the panel is waiting for.

    Every keystroke starts a scan of 90,077 carriers, and those do not finish in the order they were
    sent -- a narrow query returns faster than the broad one typed before it. Without this the older,
    slower answer lands last and the list shows results for a query the commander has already
    finished editing. Only the newest request may write to state.
  */
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (services.length) params.set("services", services.join(","));
    if (maxSeen) params.set("maxLastSeenDays", String(maxSeen));
    if (dssaOnly) params.set("dssaOnly", "1");
    if (networkKey) params.set("network", networkKey);
    if (search.trim()) params.set("q", search.trim());
    params.set("limit", "200");
    const seq = (requestSeq.current += 1);
    try {
      const res = await fetch(`/api/carriers/query?${params.toString()}`);
      if (!res.ok) throw new Error(`Query failed (${res.status})`);
      const body = (await res.json()) as CarrierQueryResultDTO;
      if (seq !== requestSeq.current) return;
      setData(body);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [services, maxSeen, dssaOnly, networkKey, search]);

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

  const checkSpansh = async (row: CarrierRowDTO) => {
    setLive((prev) => ({ ...prev, [row.callsign]: "loading" }));
    const params = new URLSearchParams({ callsign: row.callsign, system: row.system });
    try {
      const res = await fetch(`/api/carriers/live?${params.toString()}`);
      const body = (await res.json()) as { ok?: boolean; fix?: CarrierLiveFixDTO; error?: string };
      setLive((prev) => ({
        ...prev,
        [row.callsign]: body.ok && body.fix ? body.fix : { error: body.error ?? "Lookup failed." },
      }));
    } catch (e) {
      setLive((prev) => ({
        ...prev,
        [row.callsign]: { error: e instanceof Error ? e.message : String(e) },
      }));
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
              <a
                className="carriers-source-link"
                href="https://edastro.com"
                target="_blank"
                rel="noreferrer"
              >
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
            <div className="carriers-search">
              <input
                type="search"
                className="carriers-search__input"
                value={searchInput}
                onChange={(ev) => setSearchInput(ev.target.value)}
                placeholder="Search callsign, name, system, region, CMDR"
                aria-label="Search carriers"
              />
              {/*
                Says what it searches rather than leaving the commander to guess. 98.1% of carriers
                carry a name and every one carries a region, so all five fields are worth offering;
                the alternative is a box that silently does nothing for four of them.
              */}
              <span className="dim carriers-search__hint">
                All words must match, in any field. <code>T9JL2N</code> finds <code>T9J-L2N</code>.
              </span>
            </div>

            <div className="fdb-filters">
              {/*
                DSSA sits first and apart because it answers a different question from the service
                chips. Those narrow by what a carrier sells; this one narrows by who put it there and
                why. The network is 101 carriers deliberately parked as a galaxy-wide service array,
                and its sightings run a median 6 days old against 35 for deep-space carriers at
                large -- people visit them, so people report them.
              */}
              <Tooltip text="Deep Space Support Array — 101 carriers deliberately parked as a service network. Curated, and far better reported than carriers at large.">
                <button
                  type="button"
                  className={`fdb-chip${dssaOnly ? " fdb-chip--on" : ""}`}
                  onClick={() => setDssaOnly((v) => !v)}
                  aria-pressed={dssaOnly}
                  disabled={(status?.dssaCount ?? 0) === 0}
                >
                  DSSA only
                </button>
              </Tooltip>
              {/*
                Networks this app carries a roster for rather than downloads. A stated membership
                list, which is why it sits beside DSSA and not among the service chips: those say
                what a carrier sells, these say who runs it.
              */}
              {CARRIER_NETWORKS.map((net) => (
                <Tooltip key={net.key} text={net.hint}>
                  <button
                    type="button"
                    className={`fdb-chip${networkKey === net.key ? " fdb-chip--on" : ""}`}
                    onClick={() => setNetworkKey((v) => (v === net.key ? "" : net.key))}
                    aria-pressed={networkKey === net.key}
                  >
                    {net.label} only
                  </button>
                </Tooltip>
              ))}
              <span className="fdb-filters__gap" />
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
                  // Non-null only once Spansh has answered AND named a different system: that is the
                  // single case where the row itself should stop showing the cached location.
                  const fix = liveFix(live[r.callsign]);
                  const moved = fix?.differs ? fix : null;
                  return (
                    <tr key={r.callsign}>
                      <td>
                        {moved ? (
                          <>
                            <strong className="carriers-live--differs">{ly(moved.distanceLy)}</strong>
                            <div className="dim carriers-was">was {ly(r.distanceLy)}</div>
                          </>
                        ) : (
                          ly(r.distanceLy)
                        )}
                      </td>
                      <td>
                        <strong>{r.callsign}</strong>
                        {r.name ? <span className="dim"> {r.name}</span> : null}
                        {r.network && !networkKey ? (
                          <span className="carriers-network-badge">{r.network.label}</span>
                        ) : null}
                        {r.dssa ? (
                          <>
                            {/*
                              The badge marks a network carrier in a list of ninety thousand. It is
                              dropped once the list is already filtered to the network, where every
                              row would carry it and it says nothing, and dropped again when the
                              carrier's own name opens with "DSSA" -- which most of theirs do, so
                              the badge would sit next to the word it repeats.
                            */}
                            {!dssaOnly && !/^DSSA\b/i.test(r.name) ? (
                              <span
                                className="carriers-dssa-badge"
                                title={`Deep Space Support Array — ${r.dssa.status}`}
                              >
                                DSSA
                              </span>
                            ) : null}
                            {r.dssa.commander ? (
                              <span className="dim"> CMDR {r.dssa.commander}</span>
                            ) : null}
                          </>
                        ) : null}
                      </td>
                      <td>
                        {/*
                          When Spansh names a different system the row shows Spansh's, because "the
                          location did not update" was the first thing the owner said about this
                          feature. The cached answer stays underneath rather than disappearing: the
                          two sources disagree in both directions and neither is authoritative.
                        */}
                        {moved ? (
                          <>
                            <strong className="carriers-live--differs">
                              {moved.system || "unknown"}
                            </strong>
                            <div className="dim carriers-was">
                              EDAstro had {r.system || "—"}
                              {r.region ? ` · ${r.region}` : ""}
                            </div>
                          </>
                        ) : (
                          <>
                            {r.system || "—"}
                            {r.region ? <span className="dim"> · {r.region}</span> : null}
                          </>
                        )}
                      </td>
                      <td>{lastSeenPhrase(r.lastSeenDays)}</td>
                      <td className={`carriers-dwell carriers-dwell--${verdict.tone}`}>
                        {verdict.text}
                        <CarrierLive
                          state={live[r.callsign]}
                          rowSeenDays={r.lastSeenDays}
                          onCheck={() => void checkSpansh(r)}
                        />
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
                Nothing matches{search.trim() ? <> “{search.trim()}”</> : " those filters"}. Out in the
                black the sighting ages are long — try <strong>Any age</strong>
                {dssaOnly ? (
                  <>
                    , or turn <strong>DSSA only</strong> off: the network is 101 carriers across the
                    whole galaxy, so the nearest can be a long way out.
                  </>
                ) : null}
                .
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
