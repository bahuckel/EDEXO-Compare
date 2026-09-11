/**
 * Search the galaxy: where has anybody recorded the thing you are looking for?
 *
 * The counterpart to the backlog panel. That one answers "what have *I* left unfinished"; this one
 * answers "what is out there at all", over 5.3 million systems nobody in this app has visited.
 *
 * The two must not be confused, so they are separate screens with separate words. Everything here is
 * a **recorded sighting** — somebody logged this species in this system — never a prediction. The
 * backlog panel's numbers are estimates from planet conditions; these are facts with a date on them.
 *
 * ## It used to be a modal in the main window (A3)
 *
 * It opened from a magnifying glass in the top bar, while `?screen=map` carried its own genus and
 * species pickers — two doors to the same room, and the owner's verdict was that the search belongs
 * where the map is: *"that was the whole point of the map, to explore sectors with less visitors"*.
 * So the pickers here are the map's pickers now, and pressing **Search** filters the plot below as
 * well as listing the systems.
 *
 * The panel therefore reports **what was applied**, not what is typed. A half-chosen genus must not
 * redraw the galaxy under the commander's hands; the search button is the commit.
 *
 * ## Price and species are alternatives
 *
 * Choosing *Stratum tectonicas* fixes the price at 19,010,800, so a price filter beside it is either
 * redundant or contradictory. The control disables itself and says why, rather than staying live and
 * quietly being ignored — a filter that looks active and does nothing is worse than one that is
 * visibly off. Choosing the *genus* Stratum leaves eight species from 1 M to 19 M, so price stays.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useModal } from "./ui/useModal";
import type {
  GalaxySpeciesCatalogueDTO,
  GalaxySpeciesOptionDTO,
  GalaxyValueHitDTO,
  GalaxyValueSearchDTO,
} from "@shared/types";
import { CopySystemButton } from "./CopySystemButton";
import { IconGalaxySearch } from "./ui/icons";

/** Evidence flags, mirroring src/server/bioIndex.ts. */
const TIER_FSS = 1;
const TIER_DSS = 2;
const TIER_CODEX = 4;

const crFmt = new Intl.NumberFormat("en-US");
const cr = (n: number) => `${crFmt.format(Math.round(n))} CR`;
const ly = (d: number | null) =>
  d == null ? "—" : d >= 10000 ? `${(d / 1000).toFixed(1)} kly` : `${crFmt.format(Math.round(d))} ly`;

/**
 * The slider's range, in credits: nothing to half a billion, per system, at 1x.
 *
 * Per system because that is the unit of a trip — four 5 M plants in one place beat one 15 M plant.
 * At 1x because the index cannot know whether anybody has already walked those bodies; a commander
 * who arrives and finds them untouched earns five times this, and the row says so beside it.
 *
 * Stepped in millions rather than credits: nobody is choosing between 19,000,000 and 19,000,001, and
 * a slider that pretends they are is 500 million positions of false precision.
 */
export const MAX_CR = 500e6;
export const STEP_CR = 1e6;
export const sliderLabel = (n: number) =>
  n === 0 ? "anything" : n >= 1e9 ? `${(n / 1e9).toFixed(2)} bn CR` : `${Math.round(n / 1e6)} M CR`;

/**
 * What a search, once run, asks of the map below it.
 *
 * `genus` and `species` are **lowercase**, which is the sector map file's own vocabulary
 * (`"bacterium"`, `"bacterium aurasus"`). The map does the widening from a genus to its taxa,
 * because the map is what holds the file that knows which taxa exist.
 */
export interface GalaxySearchApplied {
  genus: string | null;
  species: string | null;
  /** What to call this filter on screen. */
  label: string;
  hits: GalaxyValueHitDTO[];
  matchedSystems: number;
}

/**
 * The strongest evidence a system carries, which is what colours its row.
 *
 * Strongest rather than all of them: a system with a confirmed species *and* unexplored signals is
 * best described by the species, and the extra signals show up in the body count beside it.
 */
function evidence(tiers: number): { label: string; className: string; help: string } {
  if (tiers & TIER_CODEX)
    return {
      label: "species",
      className: "gsx-tier gsx-tier--codex",
      help: "A commander logged a species here on foot. The strongest evidence there is.",
    };
  if (tiers & TIER_DSS)
    return {
      label: "genus",
      className: "gsx-tier gsx-tier--dss",
      help: "Somebody mapped a body here with probes, so the genus is known but not which species.",
    };
  if (tiers & TIER_FSS)
    return {
      label: "signals",
      className: "gsx-tier gsx-tier--fss",
      help: "An FSS scan counted biological signals. Nothing has named them.",
    };
  return { label: "—", className: "gsx-tier", help: "No biological evidence recorded." };
}

/**
 * The results, in a window over the map rather than in the page under it.
 *
 * The owner's ranking of the two: *"the main focus there is the map, the list is just a 'nice to
 * have' and for people who will find it easier than dealing with the map"*. A 200-row table in the
 * page pushed the thing it describes off the screen, which inverted that — so the table opens on
 * request and closes again, and the map keeps the page.
 *
 * It reuses {@link useModal}, so it behaves like every other dialog in the app: Escape closes it,
 * focus is trapped inside and handed back on the way out, and the page behind it does not scroll.
 */
function GalaxyHitsModal({
  hits,
  onClose,
  children,
}: {
  hits: readonly GalaxyValueHitDTO[];
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel gsx-hits-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gsx-hits-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="gsx-hits-title">
            {hits.length} system{hits.length === 1 ? "" : "s"}, nearest first
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="fdb-scroll gsx-hits-scroll">{children}</div>
      </div>
    </div>
  );
}

export function GalaxySearchPanel({ onApply }: { onApply: (applied: GalaxySearchApplied | null) => void }) {
  const [cat, setCat] = useState<GalaxySpeciesCatalogueDTO | null>(null);
  const [result, setResult] = useState<GalaxyValueSearchDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [minCr, setMinCr] = useState(0);
  const [genusDir, setGenusDir] = useState("");
  const [speciesId, setSpeciesId] = useState("");
  const [needDss, setNeedDss] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/galaxy/species");
        if (!res.ok) {
          if (!cancelled) setError("This build has no galaxy index.");
          return;
        }
        const j = (await res.json()) as GalaxySpeciesCatalogueDTO;
        if (!cancelled) setCat(j);
      } catch {
        if (!cancelled) setError("Could not reach the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const genera = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of cat?.species ?? []) m.set(s.genusDir, s.genusName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [cat]);

  const speciesOfGenus = useMemo<GalaxySpeciesOptionDTO[]>(
    () => (cat?.species ?? []).filter((s) => !genusDir || s.genusDir === genusDir),
    [cat, genusDir],
  );

  /** A named species already fixes the price; see the header. */
  const priceLocked = speciesId !== "";

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ limit: "200" });
      q.set("minCr", String(priceLocked ? 0 : minCr));
      if (speciesId) q.set("species", speciesId);
      else if (genusDir) q.set("genus", genusDir);
      if (needDss) q.set("tiers", String(TIER_DSS));
      const res = await fetch(`/api/galaxy/worth?${q.toString()}`);
      if (!res.ok) {
        setError("This build has no galaxy index.");
        return;
      }
      const j = (await res.json()) as GalaxyValueSearchDTO;
      setResult(j);
      // A list left open from the previous search would sit over the new map showing old rows.
      setListOpen(false);

      /*
        The map is told what was *searched*, not what is selected: the pickers can be fiddled with
        for a while before anybody presses the button, and redrawing the galaxy on each keystroke of
        thought is how a map becomes unusable.
      */
      const chosen = cat?.species.find((s) => s.speciesId === speciesId) ?? null;
      const genusName = chosen?.genusName ?? genera.find(([dir]) => dir === genusDir)?.[1] ?? null;
      onApply({
        genus: genusName ? genusName.toLowerCase() : null,
        species: chosen ? chosen.displayName.toLowerCase() : null,
        label: chosen?.displayName ?? genusName ?? "everything recorded",
        hits: j.hits ?? [],
        matchedSystems: j.matchedSystems,
      });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }, [minCr, genusDir, speciesId, needDss, priceLocked, cat, genera, onApply]);

  const clear = useCallback(() => {
    setGenusDir("");
    setSpeciesId("");
    setMinCr(0);
    setNeedDss(false);
    setResult(null);
    setListOpen(false);
    onApply(null);
  }, [onApply]);

  const hits = result?.hits ?? [];

  return (
    <section className="gsx-panel gsx-panel--inline" aria-label="Search the galaxy">
      <header className="fdb-head">
        <div>
          {/*
            The same magnifying glass that used to sit in the app's top bar. It moved here with the
            panel, rather than being retired: the commander is looking for the control they know,
            and the icon is how they recognise it.
          */}
          <h2 className="fdb-title gsx-title">
            <IconGalaxySearch className="gsx-title-icon" /> Search the galaxy
          </h2>
          <p className="dim fdb-sub">
            Where anybody has recorded biology, across {cat ? crFmt.format(cat.systemCount) : "5.3 million"}{" "}
            systems. These are sightings somebody logged, not predictions — nearest to you first, and
            the map below follows what you search for.
          </p>
        </div>
      </header>

      {error ? <p className="fdb-empty">{error}</p> : null}
      {!cat && !error ? <p className="fdb-empty">Reading the index…</p> : null}

      {cat?.available ? (
        <>
          <div className="gsx-controls">
            <label className="gsx-field">
              Genus
              <select
                value={genusDir}
                onChange={(e) => {
                  setGenusDir(e.target.value);
                  setSpeciesId("");
                }}
              >
                <option value="">Any genus</option>
                {genera.map(([dir, name]) => (
                  <option key={dir} value={dir}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="gsx-field">
              Species
              <select value={speciesId} onChange={(e) => setSpeciesId(e.target.value)}>
                <option value="">Any species</option>
                {speciesOfGenus.map((s) => (
                  <option key={s.speciesId} value={s.speciesId}>
                    {s.displayName} — {cr(s.baseCr)} ({crFmt.format(s.systemCount)} systems)
                  </option>
                ))}
              </select>
            </label>

            <div className={`gsx-field gsx-price${priceLocked ? " gsx-price--locked" : ""}`}>
              <span>
                System worth at least <strong className="gsx-price-value">{sliderLabel(minCr)}</strong>
              </span>
              <input
                type="range"
                className="gsx-slider"
                min={0}
                max={MAX_CR}
                step={STEP_CR}
                value={minCr}
                disabled={priceLocked}
                onChange={(e) => setMinCr(Number(e.target.value))}
                aria-label="Minimum system value in credits"
              />
              {/*
                Said out loud rather than left as a greyed control. A commander who picked a species
                and then found the price ignored would reasonably think the search was broken.
              */}
              {priceLocked ? (
                <span className="dim gsx-note">
                  A named species already has a price — clear it to filter by value.
                </span>
              ) : (
                <span className="dim gsx-note">
                  Everything the codex knows there, at list price. Five times that if nobody has landed
                  yet.
                </span>
              )}
            </div>

            <label className="gsx-field gsx-check">
              <input type="checkbox" checked={needDss} onChange={(e) => setNeedDss(e.target.checked)} />
              Mapped only
              <span className="dim gsx-note">Somebody has probed a body here, so the genus is known.</span>
            </label>

            <button type="button" className="gsx-go" onClick={() => void run()} disabled={busy}>
              {busy ? "Searching…" : "Search"}
            </button>
            {result ? (
              <button type="button" className="gsx-clear" onClick={clear}>
                Clear
              </button>
            ) : null}
          </div>

          {result ? (
            <div className="fdb-summary">
              <span>
                <strong>{crFmt.format(result.matchedSystems)}</strong> systems
              </span>
              <span>
                <strong>{result.speciesConsidered}</strong> species searched
              </span>
              {result.matchedSystems > hits.length ? (
                <span className="dim">the {hits.length} nearest are on the map</span>
              ) : null}
              {/*
                The list opens on request rather than filling the page (A3, owner's follow-up):
                *"the main focus there is the map, the list is just a 'nice to have' and for people
                who will find it easier than dealing with the map"*. So the map keeps the page and
                the table is one click away for anybody who would rather read names than marks.
              */}
              {hits.length > 0 ? (
                <button type="button" className="gsx-list-open" onClick={() => setListOpen(true)}>
                  List {hits.length} systems
                </button>
              ) : null}
            </div>
          ) : null}

          {listOpen && result ? (
            <GalaxyHitsModal hits={hits} onClose={() => setListOpen(false)}>
              <table className="fdb-table">
                <thead>
                  <tr>
                    <th>System</th>
                    <th className="fdb-num">Away</th>
                    <th>Evidence</th>
                    <th className="fdb-num">Bodies</th>
                    <th>What is there</th>
                    <th className="fdb-num">System worth</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {hits.map((h) => {
                    const ev = evidence(h.tiers);
                    return (
                      <tr key={h.systemAddress} className="fdb-row">
                        <td className="fdb-sys">{h.starSystem}</td>
                        <td className="fdb-num dim">{ly(h.distanceLy)}</td>
                        <td>
                          <span className={ev.className} title={ev.help}>
                            {ev.label}
                          </span>
                        </td>
                        {/* 0 means Spansh does not know, which is not a system with no bodies. */}
                        <td className="fdb-num dim">{h.bodyCount || "—"}</td>
                        <td className="gsx-species">
                          {h.species.map((s) => s.displayName).join(", ")}
                          {h.totalKnownSpecies > h.species.length ? (
                            <span className="dim"> +{h.totalKnownSpecies - h.species.length} more</span>
                          ) : null}
                        </td>
                        {/*
                          Both figures, because the index genuinely cannot say whether anybody has
                          walked these bodies — that only becomes knowable from the commander's own
                          journal once they arrive. Where it *is* known, the app shows one number;
                          here it is honestly open.
                        */}
                        <td className="fdb-num fdb-floor">
                          {cr(h.systemCr)}
                          <span className="dim gsx-ff"> · {cr(h.systemFirstFootfallCr)} at 5×</span>
                        </td>
                        <td>
                          <CopySystemButton system={h.starSystem} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </GalaxyHitsModal>
          ) : null}
          {result && hits.length === 0 ? (
            <p className="fdb-empty">Nothing recorded matches that. Widen the genus, or lower the price.</p>
          ) : null}
          {!result ? (
            <p className="fdb-empty">Choose what you are looking for, then search. The map follows.</p>
          ) : null}
        </>
      ) : null}

      {cat && !cat.available ? (
        <p className="fdb-empty">
          This build has no galaxy index. Build one with <code>npm run feeder</code>&apos;s index script
          to search beyond your own journals.
        </p>
      ) : null}
    </section>
  );
}
