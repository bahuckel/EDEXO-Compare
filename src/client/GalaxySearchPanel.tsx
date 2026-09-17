/**
 * Search the galaxy: where has anybody recorded the thing you are looking for?
 *
 * The counterpart to the backlog panel. That one answers "what have *I* left unfinished"; this one
 * answers "what is out there at all", over 5.3 million systems nobody in this app has visited.
 *
 * The two must not be confused, so they are separate screens with separate words.
 *
 * ## Two questions, one set of pickers
 *
 * **Recorded** is a sighting: somebody logged this species in this system, and the codex has it.
 * **Could be there** is a shortlist: a body whose conditions suit the species, in a system nobody
 * has walked — the owner's ask, *"someone might have just FSS-ed the place and left… we can pretty
 * easily determine if there is going to be plant X"*.
 *
 * They share the genus and species pickers because they are the same question about the same
 * organism; what changes is who is being asked. Everything else differs, and the panel says which
 * it is in the subtitle, on the switch, and again above the list — because the difference between
 * "somebody found this" and "this would be offered here" is the whole value of the recorded list,
 * and one blurred sentence would cost it.
 *
 * The predicted half only appears where there is a body file to search, which is the machine that
 * built one from a galaxy dump. Everywhere else the panel is exactly what it was.
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
  GalaxyBodyScanDTO,
  GalaxyRegionsDTO,
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
 * One place the search found, as the map needs it.
 *
 * The map draws *places*, so this is the whole of what it is told about one: where it is, what it
 * is called, and one line of prose for the tooltip. `note` exists because the two searches make
 * different claims — "19,010,800 CR recorded" is a sighting somebody logged, "2 bodies could hold
 * it" is a shortlist — and a map that printed credits over a prediction would be quietly lying.
 */
export interface GalaxySearchMark {
  systemAddress: number;
  starSystem: string;
  x: number;
  y: number;
  z: number;
  distanceLy: number | null;
  /** What this mark is, in a few words. Goes straight into the tooltip. */
  note: string;
}

/**
 * What a search, once run, asks of the map below it.
 *
 * `genus` and `species` are **lowercase**, which is the sector map file's own vocabulary
 * (`"bacterium"`, `"bacterium aurasus"`). The map does the widening from a genus to its taxa,
 * because the map is what holds the file that knows which taxa exist.
 *
 * Both are **null in predicted mode**, deliberately. Those names light up the sectors where the
 * corpus has *recorded* the taxon, and a predicted search is by definition about the places where
 * nobody has. Narrowing the sectors to recorded ground while the marks sit outside it would be the
 * map contradicting itself.
 */
export interface GalaxySearchApplied {
  genus: string | null;
  species: string | null;
  /** What to call this filter on screen. */
  label: string;
  /**
   * What the **map** draws: one system per matching sector cell, over the whole search.
   *
   * Not the same rows the list shows. The list is nearest-first, which is right for choosing where
   * to fly and wrong for seeing where a species lives — the 200 nearest matches to a commander sit
   * inside about twelve pixels of a galaxy-wide plot, which is what the owner saw and could not
   * identify. Falls back to the nearest hits on a server that has no spread to give.
   */
  hits: GalaxySearchMark[];
  /** Distinct sector cells that matched, before the sample was capped. */
  spreadCells: number;
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

/**
 * The bodies a predicted search found, in the same window the recorded list uses.
 *
 * A body table rather than a system table: the answer is "this world would be offered that plant",
 * and the world is what the commander has to fly to and land on. The system is the heading.
 */
function GalaxyPossibleModal({
  result,
  onClose,
}: {
  result: GalaxyBodyScanDTO;
  onClose: () => void;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const bodies = result.hits.reduce((n, h) => n + h.bodies.length, 0);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel gsx-hits-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gsx-possible-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="gsx-possible-title">
            {bodies} bod{bodies === 1 ? "y" : "ies"} in {result.hits.length} system
            {result.hits.length === 1 ? "" : "s"}
            {/* Never "nearest first" over a partial walk — see the summary row for why. */}
            {result.truncated ? ", nearest in the part searched" : ", nearest first"}
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="fdb-scroll gsx-hits-scroll">
          {/*
            Said once, at the top of the list, rather than beside every row. Every row here is the
            same kind of claim and repeating it would turn a warning into wallpaper.
          */}
          <p className="dim gsx-caveat">
            These are bodies whose conditions suit the species — the same gates the app applies when
            you are standing there. Nobody has confirmed anything on them.
          </p>
          <table className="fdb-table">
            <thead>
              <tr>
                <th>Body</th>
                <th className="fdb-num">Away</th>
                <th>Conditions</th>
                <th className="fdb-num">Signals</th>
                <th>Could be</th>
                <th className="fdb-num">At 5×</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result.hits.map((h) =>
                h.bodies.map((b, i) => (
                  <tr key={`${h.systemAddress}:${b.bodyId}`} className="fdb-row">
                    <td className="fdb-sys">
                      {b.bodyName}
                      {b.probed ? (
                        <span className="dim gsx-ff" title="Somebody has mapped this body with probes.">
                          {" "}
                          · probed
                        </span>
                      ) : null}
                      {h.walked ? (
                        <span className="dim gsx-ff" title="Somebody has logged a species in this system.">
                          {" "}
                          · walked
                        </span>
                      ) : null}
                    </td>
                    {/* Once per system: the distance is the system's, and repeating it reads as detail. */}
                    <td className="fdb-num dim">{i === 0 ? ly(h.distanceLy) : ""}</td>
                    <td className="gsx-species">
                      {[
                        b.planetClass || "unknown class",
                        b.atmosphere || "no atmosphere",
                        `${Math.round(b.temperatureK)} K`,
                        `${b.gravityG.toFixed(2)} g`,
                        /*
                          The odds beside the gravity that produced them, so the number is read as
                          a consequence of the body rather than a verdict on it. Absent for an
                          airless body or one the dump never measured — see gravityBiologyOdds.ts.
                        */
                        b.gravityOdds ? `${b.gravityOdds.observedPct}% carry biology` : null,
                        h.starType ? `${h.starType} star` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                    {/*
                      The FSS count is the hard fact on the row: the game puts one genus per signal,
                      so it is how many different plants are down there whatever anybody predicts.
                    */}
                    <td className="fdb-num">{b.bioCount || "—"}</td>
                    <td className="gsx-species">{b.species.map((s) => s.displayName).join(", ")}</td>
                    <td className="fdb-num fdb-floor">
                      {b.species[0] ? cr(b.species[0].firstFootfallCr) : "—"}
                    </td>
                    <td>{i === 0 ? <CopySystemButton system={h.starSystem} /> : null}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function GalaxySearchPanel({
  onApply,
  commanderRegionId,
}: {
  onApply: (applied: GalaxySearchApplied | null) => void;
  /**
   * The region the commander is in, so the picker opens on the one they are standing in.
   *
   * Resolved by the map screen, which already holds both the region map and the ship's position.
   * Null simply means the picker starts empty and waits to be told.
   */
  commanderRegionId?: number | null;
}) {
  const [cat, setCat] = useState<GalaxySpeciesCatalogueDTO | null>(null);
  const [result, setResult] = useState<GalaxyValueSearchDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [minCr, setMinCr] = useState(0);
  const [genusDir, setGenusDir] = useState("");
  const [speciesId, setSpeciesId] = useState("");
  const [needDss, setNeedDss] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  /*
    The second question this panel can ask.

    "Recorded" is a sighting somebody logged; "possible" is a body whose conditions suit the plant
    in a system nobody has walked. They share the genus and species pickers because they are the
    same question about the same organism — what changes is who is being asked.
  */
  const [mode, setMode] = useState<"recorded" | "possible">("recorded");
  const [regions, setRegions] = useState<GalaxyRegionsDTO | null>(null);
  const [regionId, setRegionId] = useState(0);
  const [wantFss, setWantFss] = useState(true);
  const [wantDss, setWantDss] = useState(false);
  const [wantWalked, setWantWalked] = useState(false);
  /*
    A floor on "does this body have biology at all", from the gravity curve in the commander's own
    journals (server/gravityBiologyOdds.ts). Off by default: the shortlist's gates are a superset of
    the matcher's, and a curve measured from one commander's flying should narrow the list only when
    he says so.
  */
  const [minGravityOdds, setMinGravityOdds] = useState(0);
  const [scan, setScan] = useState<GalaxyBodyScanDTO | null>(null);
  const [scanListOpen, setScanListOpen] = useState(false);

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

  /*
    The body file is optional and local — it is built from a galaxy dump and never ships — so a 404
    here is the ordinary case, not a failure. The mode switch simply does not appear.
  */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/galaxy/regions")
      .then((r) => (r.ok ? (r.json() as Promise<GalaxyRegionsDTO>) : null))
      .then((j) => {
        if (!cancelled && j) setRegions(j);
      })
      .catch(() => {
        /* no body file, no predicted search */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Open on the commander's own region once both halves are known, and never override a choice. */
  useEffect(() => {
    if (regionId === 0 && commanderRegionId && regions?.available) setRegionId(commanderRegionId);
  }, [commanderRegionId, regions, regionId]);

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
      const rows = j.spread?.length ? j.spread : (j.hits ?? []);
      onApply({
        genus: genusName ? genusName.toLowerCase() : null,
        species: chosen ? chosen.displayName.toLowerCase() : null,
        label: chosen?.displayName ?? genusName ?? "everything recorded",
        hits: rows.map((h) => ({
          systemAddress: h.systemAddress,
          starSystem: h.starSystem,
          x: h.x,
          y: h.y,
          z: h.z,
          distanceLy: h.distanceLy,
          note: `${cr(h.systemCr)} recorded`,
        })),
        spreadCells: j.spreadCells ?? 0,
        matchedSystems: j.matchedSystems,
      });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }, [minCr, genusDir, speciesId, needDss, priceLocked, cat, genera, onApply]);

  const runPossible = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ limit: "200", regionId: String(regionId) });
      if (speciesId) q.set("species", speciesId);
      else if (genusDir) q.set("genus", genusDir);
      q.set("fss", wantFss ? "1" : "0");
      q.set("dss", wantDss ? "1" : "0");
      q.set("walked", wantWalked ? "1" : "0");
      if (minGravityOdds > 0) q.set("minGravityOdds", String(minGravityOdds));
      const res = await fetch(`/api/galaxy/possible?${q.toString()}`);
      if (!res.ok) {
        setError("This machine has no galaxy body file.");
        return;
      }
      const j = (await res.json()) as GalaxyBodyScanDTO;
      setScan(j);
      setScanListOpen(false);

      const chosen = cat?.species.find((s) => s.speciesId === speciesId) ?? null;
      const genusName = chosen?.genusName ?? genera.find(([dir]) => dir === genusDir)?.[1] ?? null;
      const rows = j.spread?.length ? j.spread : (j.hits ?? []);
      onApply({
        /*
          No taxon for the sector filter, on purpose. Those names narrow the map to the sectors
          where the corpus has *recorded* the species, and every mark in this mode is somewhere it
          has not — the map would hide exactly the ground the answer is about.
        */
        genus: null,
        species: null,
        label: `${chosen?.displayName ?? genusName ?? "biology"} — possible in ${j.regionName ?? "this region"}`,
        hits: rows.map((h) => ({
          systemAddress: h.systemAddress,
          starSystem: h.starSystem,
          x: h.x,
          y: h.y,
          z: h.z,
          distanceLy: h.distanceLy,
          note: `${h.bodies.length} bod${h.bodies.length === 1 ? "y" : "ies"} could hold it`,
        })),
        spreadCells: j.spreadCells ?? 0,
        matchedSystems: j.matchedSystems,
      });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }, [regionId, speciesId, genusDir, wantFss, wantDss, wantWalked, minGravityOdds, cat, genera, onApply]);

  const clear = useCallback(() => {
    setGenusDir("");
    setSpeciesId("");
    setMinCr(0);
    setNeedDss(false);
    setResult(null);
    setScan(null);
    setListOpen(false);
    setScanListOpen(false);
    onApply(null);
  }, [onApply]);

  /** Switching the question throws away the other question's answer rather than leaving it on the map. */
  const switchMode = useCallback(
    (next: "recorded" | "possible") => {
      if (next === mode) return;
      setMode(next);
      setResult(null);
      setScan(null);
      setListOpen(false);
      setScanListOpen(false);
      onApply(null);
    },
    [mode, onApply],
  );

  const hits = result?.hits ?? [];
  const possible = mode === "possible";
  const scanBodies = scan?.hits.reduce((n, h) => n + h.bodies.length, 0) ?? 0;
  /** Nothing chosen searches every species in the region, which is slow and answers nothing. */
  const canScan = regionId > 0 && (speciesId !== "" || genusDir !== "") && (wantFss || wantDss);

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
            {possible ? (
              <>
                Bodies whose conditions suit the species, in systems nobody has walked — the same
                gates the app applies when you are standing there. A shortlist, not a sighting.
              </>
            ) : (
              <>
                Where anybody has recorded biology, across{" "}
                {cat ? crFmt.format(cat.systemCount) : "5.3 million"} systems. These are sightings
                somebody logged, not predictions — nearest to you first, and the map below follows
                what you search for.
              </>
            )}
          </p>
        </div>
      </header>

      {/*
        The mode switch appears only where there is a body file to search. On every other install
        the panel is exactly what it was, rather than offering a question that cannot be answered.
      */}
      {regions?.available ? (
        <div className="gsx-modes" role="group" aria-label="What to search for">
          <button
            type="button"
            className={possible ? "gsx-mode" : "gsx-mode gsx-mode--on"}
            onClick={() => switchMode("recorded")}
          >
            Recorded
          </button>
          <button
            type="button"
            className={possible ? "gsx-mode gsx-mode--on" : "gsx-mode"}
            onClick={() => switchMode("possible")}
          >
            Could be there
          </button>
        </div>
      ) : null}

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

            {possible ? (
              <>
                <label className="gsx-field">
                  Region
                  <select value={regionId} onChange={(e) => setRegionId(Number(e.target.value))}>
                    <option value={0}>Choose a region</option>
                    {(regions?.regions ?? []).map((r) => (
                      <option key={r.regionId} value={r.regionId}>
                        {r.name} ({crFmt.format(r.systemCount)})
                      </option>
                    ))}
                  </select>
                  {/*
                    The reason the search is scoped at all, said where the choice is made. A region
                    is seconds; the galaxy is forty-two of those and an answer nobody can act on.
                  */}
                  <span className="dim gsx-note">
                    One region at a time — a few seconds each. The largest takes longest.
                  </span>
                </label>

                {/*
                  Three independent ticks, the owner's own design: *"I choose filters
                  FSS/DSS/ScanOrganic as proof. If ScanOrganic is not selected it excludes them."*
                  The first two describe a body, the third a system.
                */}
                <div className="gsx-field gsx-evidence" role="group" aria-label="What evidence to allow">
                  <span>Include</span>
                  <label className="gsx-check">
                    <input type="checkbox" checked={wantFss} onChange={(e) => setWantFss(e.target.checked)} />
                    Signals only
                  </label>
                  <label className="gsx-check">
                    <input type="checkbox" checked={wantDss} onChange={(e) => setWantDss(e.target.checked)} />
                    Already probed
                  </label>
                  <label className="gsx-check">
                    <input
                      type="checkbox"
                      checked={wantWalked}
                      onChange={(e) => setWantWalked(e.target.checked)}
                    />
                    Already walked
                  </label>
                  <span className="dim gsx-note">
                    An FSS counted signals and nobody followed it up; a probed body already has its
                    genus; a walked system has a species somebody logged on foot.
                  </span>
                </div>
                {/*
                  The gravity floor.

                  A separate question from the evidence ticks: those ask what is known about a body,
                  this asks how often a body like it turns out to have anything growing on it. Off by
                  default, and the figure is shown on every row whether or not it filters, so the
                  curve can be read before it is trusted.
                */}
                <div className="gsx-field gsx-gravity">
                  <span>
                    Biology likely by gravity{" "}
                    <strong className="gsx-price-value">
                      {minGravityOdds > 0 ? `at least ${minGravityOdds} %` : "any"}
                    </strong>
                  </span>
                  <input
                    className="gsx-slider"
                    type="range"
                    min={0}
                    max={90}
                    step={10}
                    value={minGravityOdds}
                    onChange={(e) => setMinGravityOdds(Number(e.target.value))}
                    aria-label="Least likely body to list, by gravity"
                  />
                  <span className="dim gsx-note">
                    From this commander&rsquo;s journals: of landable bodies with an atmosphere,
                    every one below 0.25 g carried biology and none above 0.65 g did. Signal presence,
                    not species — and his flying, not a survey of the galaxy.
                  </span>
                </div>
              </>
            ) : (
              <>
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
                    Said out loud rather than left as a greyed control. A commander who picked a
                    species and then found the price ignored would reasonably think the search was
                    broken.
                  */}
                  {priceLocked ? (
                    <span className="dim gsx-note">
                      A named species already has a price — clear it to filter by value.
                    </span>
                  ) : (
                    <span className="dim gsx-note">
                      Everything the codex knows there, at list price. Five times that if nobody has
                      landed yet.
                    </span>
                  )}
                </div>

                <label className="gsx-field gsx-check">
                  <input type="checkbox" checked={needDss} onChange={(e) => setNeedDss(e.target.checked)} />
                  Mapped only
                  <span className="dim gsx-note">
                    Somebody has probed a body here, so the genus is known.
                  </span>
                </label>
              </>
            )}

            <button
              type="button"
              className="gsx-go"
              onClick={() => void (possible ? runPossible() : run())}
              disabled={busy || (possible && !canScan)}
            >
              {busy ? "Searching…" : "Search"}
            </button>
            {result || scan ? (
              <button type="button" className="gsx-clear" onClick={clear}>
                Clear
              </button>
            ) : null}
          </div>

          {possible && !canScan && !busy ? (
            <p className="fdb-empty">
              {regionId === 0
                ? "Choose a region to search."
                : !wantFss && !wantDss
                  ? "Tick at least one kind of body to include."
                  : "Choose a genus or a species — searching every plant in a region answers nothing."}
            </p>
          ) : null}

          {possible && scan ? (
            <div className="fdb-summary">
              {/*
                Both figures are the whole answer, not the part on screen.

                They were `scanBodies` and `matchedSystems` — the bodies in the two hundred systems
                the list returns, against every system that matched — which read as "383 bodies in
                98,031 systems" and described no population at all. What the list holds is the
                button's job to say.
              */}
              <span>
                <strong>{crFmt.format(scan.bodiesMatched)}</strong> bodies
              </span>
              <span>
                in <strong>{crFmt.format(scan.matchedSystems)}</strong> systems
              </span>
              {/*
                How much ground the answer covers, because the claim is a weak one and its size is
                what makes it readable: a hundred matches out of three million bodies is a different
                statement from a hundred out of two hundred.
              */}
              <span className="dim">
                {crFmt.format(scan.bodiesScanned)} bodies searched in {(scan.elapsedMs / 1000).toFixed(1)} s
              </span>
              {/*
                A truncated answer names the fraction of the region it covers, and does not call
                itself nearest-first.

                The walk goes through a region in system order, so running out of time leaves a
                *prefix* rather than a sample — the nearest match in the part that was reached is
                not the nearest match in the region. Saying "partial" alone would let a commander
                read the top row as the closest one, which is the one thing this list is for.
              */}
              {scan.truncated ? (
                <span
                  className="gsx-partial"
                  title="A region is walked in system order, so an answer that ran out of time covers the first part of it rather than a spread across it — the nearest row here is the nearest in that part, not in the region. Name a single species to search the whole of it."
                >
                  covered {Math.round((scan.systemsSearched / Math.max(1, scan.systemsInRegion)) * 100)}
                  % of {scan.regionName ?? "the region"} — ran out of time
                </span>
              ) : null}
              {scanBodies > 0 ? (
                <button type="button" className="gsx-list-open" onClick={() => setScanListOpen(true)}>
                  {/* Says what opens, which is the nearest few systems rather than every match. */}
                  List the nearest {crFmt.format(scan.hits.length)} system
                  {scan.hits.length === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>
          ) : null}

          {!possible && result ? (
            <div className="fdb-summary">
              <span>
                <strong>{crFmt.format(result.matchedSystems)}</strong> systems
              </span>
              <span>
                <strong>{result.speciesConsidered}</strong> species searched
              </span>
              {/*
                The two numbers describe different things now and saying so is the whole point:
                the list is the nearest few, the map is a galaxy-wide sample one system per sector.
              */}
              {result.spread?.length ? (
                <span className="dim">
                  map: {result.spread.length} of{" "}
                  {crFmt.format(result.spreadCells ?? result.spread.length)} sectors
                </span>
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

          {scanListOpen && scan ? (
            <GalaxyPossibleModal result={scan} onClose={() => setScanListOpen(false)} />
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
          {possible && scan && scanBodies === 0 ? (
            <p className="fdb-empty">
              Nothing in {scan.regionName ?? "that region"} suits it. Try another region, or include
              bodies somebody has already probed.
            </p>
          ) : null}
          {!possible && result && hits.length === 0 ? (
            <p className="fdb-empty">Nothing recorded matches that. Widen the genus, or lower the price.</p>
          ) : null}
          {!result && !scan ? (
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
