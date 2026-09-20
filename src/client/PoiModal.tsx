/**
 * Points of interest — the Galactic Exploration Catalog, near the commander.
 *
 * Empty until asked, like Carriers: nothing is fetched when the panel opens, and the button says
 * what pressing it will do before it does it.
 *
 * **Organic is the chip that matters here.** 53 of the 2,766 entries are about biology — places
 * commanders flew to, landed on and wrote up — and without a chip they are one row in two thousand.
 *
 * Three things this panel deliberately does not do:
 *
 * - **No photographs.** Every GEC row carries a `mainImage` on edastro.com. Rendering two hundred of
 *   them on each panel open would put this app's whole userbase on one person's image server, and
 *   the pictures are the part their licence most clearly covers. The row links out instead.
 * - **No full descriptions.** The 200-character summary is enough to decide on; the write-up stays
 *   where its author put it, one click away.
 * - **No claim of freshness.** The catalogue is curated by hand and changes slowly, so unlike the
 *   carrier list there is no sighting age to report and none is implied.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { POI_GROUP_OPTIONS } from "@shared/gecCategories";
import { Tooltip } from "./ui/Tooltip";
import { useModal } from "./ui/useModal";
import type { PoiQueryResultDTO } from "@shared/types";

function ly(d: number | null): string {
  if (d == null) return "—";
  if (d < 1) return "here";
  if (d >= 10000) return `${(d / 1000).toFixed(1)} kly`;
  return `${Math.round(d).toLocaleString("en-US")} ly`;
}

/**
 * Rating floors as chips.
 *
 * The catalogue rates 1.07 to 9.3, and only its own 643 entries carry one at all. 7+ is roughly "the
 * community thinks this is worth the detour"; the server keeps unrated rows rather than treating a
 * missing rating as zero, which would silently delete the 2,123 mapping-project entries.
 */
const RATING_FILTERS = [0, 5, 7] as const;
const ratingLabel = (n: number) => (n === 0 ? "Any rating" : `${n}+ rated`);

export function PoiModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const [data, setData] = useState<PoiQueryResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<string[]>([]);
  const [organicOnly, setOrganicOnly] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  /** Only the newest request may write state; a narrow query returns before a broad earlier one. */
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (groups.length) params.set("groups", groups.join(","));
    if (organicOnly) params.set("organicOnly", "1");
    if (minRating) params.set("minRating", String(minRating));
    if (search.trim()) params.set("q", search.trim());
    params.set("limit", "200");
    const seq = (requestSeq.current += 1);
    try {
      const res = await fetch(`/api/poi/query?${params.toString()}`);
      if (!res.ok) throw new Error(`Query failed (${res.status})`);
      const body = (await res.json()) as PoiQueryResultDTO;
      if (seq !== requestSeq.current) return;
      setData(body);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [groups, organicOnly, minRating, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const fetchFromEdastro = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/poi/fetch", {
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

  const toggleGroup = (key: string) =>
    setGroups((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

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
        aria-label="Points of interest"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="fdb-head">
          <div>
            <h2 className="fdb-title">Points of interest</h2>
            <p className="dim fdb-sub">
              The Galactic Exploration Catalog and the Galactic Mapping Project, from{" "}
              <a
                className="carriers-source-link"
                href="https://edastro.com/gec"
                target="_blank"
                rel="noreferrer"
              >
                EDAstro
              </a>
              . Places commanders went to and wrote up. Each row links to its own page.
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
              ? "Downloading ~6 MB from edastro.com."
              : haveData
                ? `${status?.rowCount.toLocaleString("en-US")} points of interest`
                : "Downloads a ~6 MB catalogue from edastro.com to this machine. Nothing is sent anywhere."}
          </span>
          {cooling ? (
            <span className="dim">
              Curated by hand and changes slowly — next fetch in{" "}
              {Math.ceil((status?.cooldownMsRemaining ?? 0) / 3600000)} h.
            </span>
          ) : null}
        </div>

        {error ? <p className="fdb-empty">{error}</p> : null}

        {!haveData && !busy ? (
          <p className="fdb-empty">
            No data. Click <strong>Fetch from EDAstro</strong> above to download the catalogue.
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
                placeholder="Search name, system, region, type, summary"
                aria-label="Search points of interest"
              />
              <span className="dim carriers-search__hint">All words must match, in any field.</span>
            </div>

            <div className="fdb-filters">
              {/*
                Organic first and set apart: 53 rows of 2,766, and the only chip on this panel that
                answers the question this app is for. Without it they are one row in fifty.
              */}
              <Tooltip text="Biology worth the trip — 53 of the catalogue's entries, across both source projects.">
                <button
                  type="button"
                  className={`fdb-chip${organicOnly ? " fdb-chip--on" : ""}`}
                  onClick={() => setOrganicOnly((v) => !v)}
                  aria-pressed={organicOnly}
                >
                  Organic only
                </button>
              </Tooltip>
              <span className="fdb-filters__gap" />
              {POI_GROUP_OPTIONS.filter((g) => g.key !== "organic").map((opt) => (
                <Tooltip key={opt.key} text={opt.hint}>
                  <button
                    type="button"
                    className={`fdb-chip${groups.includes(opt.key) ? " fdb-chip--on" : ""}`}
                    onClick={() => toggleGroup(opt.key)}
                    aria-pressed={groups.includes(opt.key)}
                  >
                    {opt.label}
                  </button>
                </Tooltip>
              ))}
              <span className="fdb-filters__gap" />
              {RATING_FILTERS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`fdb-chip${minRating === n ? " fdb-chip--on" : ""}`}
                  onClick={() => setMinRating(n)}
                  aria-pressed={minRating === n}
                >
                  {ratingLabel(n)}
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
                <span className="dim">No position yet — jump once and distances appear.</span>
              ) : null}
            </div>

            {/* Same scroller as Carriers: without it the panel clips instead of scrolling. */}
            <div className="fdb-scroll">
              <table className="fdb-table carriers-table poi-table">
                <thead>
                  <tr>
                    <th>Distance</th>
                    <th>Name</th>
                    <th>System</th>
                    <th>Type</th>
                    <th>Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>{ly(r.distanceLy)}</td>
                      <td>
                        {r.url ? (
                          <a className="carriers-source-link" href={r.url} target="_blank" rel="noreferrer">
                            {r.name}
                          </a>
                        ) : (
                          <strong>{r.name}</strong>
                        )}
                        {r.organic ? <span className="poi-organic-badge">ORGANIC</span> : null}
                        {r.summary ? <div className="dim poi-summary">{r.summary}</div> : null}
                      </td>
                      <td>
                        {r.system || "—"}
                        {r.region ? <span className="dim"> · {r.region}</span> : null}
                      </td>
                      <td className="dim">{r.typeLabel}</td>
                      {/* Only the 643 GEC rows are rated; a dash is the honest reading for the rest. */}
                      <td>{r.rating != null ? r.rating.toFixed(1) : <span className="dim">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rows.length === 0 ? (
              <p className="fdb-empty">
                Nothing matches{search.trim() ? <> “{search.trim()}”</> : " those filters"}. The catalogue is
                2,766 points across the whole galaxy, so the nearest can be a long way out.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
