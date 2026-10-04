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
import { useCallback, useEffect, useMemo, useState } from "react";
import { Select } from "./ui/Select";
import { MenuRow, MenuToggle } from "./galaxy3d/G3dMenu";
import type {
  GalaxyBodyScanDTO,
  GalaxyRegionsDTO,
  GalaxySpeciesCatalogueDTO,
  GalaxySpeciesOptionDTO,
  GalaxyValueSearchDTO,
} from "@shared/types";
import { CopySystemButton } from "./CopySystemButton";
import { IconGalaxySearch } from "./ui/icons";
import { TIER_DSS, crFmt, cr, ly, MAX_CR, STEP_CR, sliderLabel, evidence } from "./galaxySearchShared";
import type { GalaxySearchApplied } from "./galaxySearchShared";
import { GalaxyHitsModal, GalaxyPossibleModal } from "./GalaxySearchModals";
import { fmtPct } from "@shared/format";
import { Tooltip } from "./ui/Tooltip";
export { MAX_CR, STEP_CR, sliderLabel } from "./galaxySearchShared";
export type { GalaxySearchMark, GalaxySearchApplied } from "./galaxySearchShared";

export function GalaxySearchPanel({
  onApply,
  commanderRegionId,
  variant = "page",
}: {
  onApply: (applied: GalaxySearchApplied | null) => void;
  /**
   * "menu": the 3D galaxy map's Search drawer (owner, 2026-10-04: the insides as the game's menu rows) —
   * no header (the drawer has its title and [?]), each control a row. "page": the classic map's panel.
   */
  variant?: "page" | "menu";
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

  const menu = variant === "menu";
  const genusOptions = [
    { value: "", label: "Any genus" },
    ...genera.map(([dir, name]) => ({ value: dir, label: name })),
  ];
  const speciesOptions = [
    { value: "", label: "Any species" },
    ...speciesOfGenus.map((s) => ({
      value: s.speciesId,
      label: `${s.displayName} — ${cr(s.baseCr)} (${crFmt.format(s.systemCount)} systems)`,
    })),
  ];
  const regionOptions = [
    { value: "0", label: "Choose a region" },
    ...(regions?.regions ?? []).map((r) => ({
      value: String(r.regionId),
      label: `${r.name} (${crFmt.format(r.systemCount)})`,
    })),
  ];
  const onGenus = (v: string) => {
    setGenusDir(v);
    setSpeciesId("");
  };

  /* The same controls as rows: the label on the left, the value in its box on the right. */
  const menuControls = (
    <div className="g3d-menu__rows gsx-menu">
      <MenuRow label="Genus" hint="The genus to look for; Any genus searches them all">
        <Select
          className="g3d-row__val g3d-row__select"
          ariaLabel="Genus"
          value={genusDir}
          options={genusOptions}
          onChange={onGenus}
        />
      </MenuRow>
      <MenuRow
        label="Species"
        hint="One species of the genus, with its list price and how many systems have it"
      >
        <Select
          className="g3d-row__val g3d-row__select"
          ariaLabel="Species"
          value={speciesId}
          options={speciesOptions}
          onChange={setSpeciesId}
          menuMinWidth={320}
        />
      </MenuRow>
      {possible ? (
        <>
          <MenuRow
            label="Region"
            hint="One region at a time — a few seconds each. The largest takes longest."
          >
            <Select
              className="g3d-row__val g3d-row__select"
              ariaLabel="Region"
              value={String(regionId)}
              options={regionOptions}
              onChange={(v) => setRegionId(Number(v))}
            />
          </MenuRow>
          <p className="g3d-menu__sub">Include</p>
          <MenuToggle
            label="Signals only"
            hint="Bodies an FSS counted signals on, and nobody followed up"
            on={wantFss}
            set={setWantFss}
          />
          <MenuToggle
            label="Already probed"
            hint="Bodies somebody mapped with probes: their genus is known"
            on={wantDss}
            set={setWantDss}
          />
          <MenuToggle
            label="Already walked"
            hint="Systems with a species somebody logged on foot"
            on={wantWalked}
            set={setWantWalked}
          />
          <MenuRow
            label="Biology likely by gravity"
            hint="From your journals: of landable bodies with an atmosphere, every one below 0.25 g carried biology and none above 0.65 g did. Signal presence, not species."
          >
            <input
              className="g3d-row__range"
              type="range"
              min={0}
              max={90}
              step={10}
              value={minGravityOdds}
              onChange={(e) => setMinGravityOdds(Number(e.target.value))}
              aria-label="Least likely body to list, by gravity"
            />
            <span className="g3d-row__num">{minGravityOdds > 0 ? `≥ ${fmtPct(minGravityOdds)}` : "any"}</span>
          </MenuRow>
        </>
      ) : (
        <>
          <MenuRow
            label="Worth at least"
            hint={
              priceLocked
                ? "A named species already has a price — clear it to filter by value."
                : "Everything the codex knows in the system, at list price. Five times that if nobody has landed yet."
            }
          >
            <input
              type="range"
              className="g3d-row__range"
              min={0}
              max={MAX_CR}
              step={STEP_CR}
              value={minCr}
              disabled={priceLocked}
              onChange={(e) => setMinCr(Number(e.target.value))}
              aria-label="Minimum system value in credits"
            />
            <span className="g3d-row__num">{sliderLabel(minCr)}</span>
          </MenuRow>
          <MenuToggle
            label="Mapped only"
            hint="Somebody has probed a body here, so the genus is known"
            on={needDss}
            set={setNeedDss}
          />
        </>
      )}
      <div className="g3d-row g3d-row--buttons">
        <button
          type="button"
          className="g3d-btn g3d-btn--on"
          onClick={() => void (possible ? runPossible() : run())}
          disabled={busy || (possible && !canScan)}
        >
          {busy ? "Searching…" : "Search"}
        </button>
        {result || scan ? (
          <button type="button" className="g3d-btn" onClick={clear}>
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <section
      className={menu ? "gsx-panel--menu" : "gsx-panel gsx-panel--inline"}
      aria-label="Search the galaxy"
    >
      {menu ? null : (
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
                  Bodies whose conditions suit the species, in systems nobody has walked — the same gates the
                  app applies when you are standing there. A shortlist, not a sighting.
                </>
              ) : (
                <>
                  Where anybody has recorded biology, across{" "}
                  {cat ? crFmt.format(cat.systemCount) : "5.3 million"} systems. These are sightings somebody
                  logged, not predictions — nearest to you first, and the map below follows what you search
                  for.
                </>
              )}
            </p>
          </div>
        </header>
      )}

      {/*
        The mode switch appears only where there is a body file to search. On every other install
        the panel is exactly what it was, rather than offering a question that cannot be answered.
      */}
      {regions?.available && menu ? (
        <div className="g3d-row g3d-row--buttons" role="group" aria-label="What to search for">
          <button
            type="button"
            className={possible ? "g3d-btn" : "g3d-btn g3d-btn--on"}
            aria-pressed={!possible}
            onClick={() => switchMode("recorded")}
          >
            Recorded
          </button>
          <button
            type="button"
            className={possible ? "g3d-btn g3d-btn--on" : "g3d-btn"}
            aria-pressed={possible}
            onClick={() => switchMode("possible")}
          >
            Could be there
          </button>
        </div>
      ) : regions?.available ? (
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
          {menu ? (
            menuControls
          ) : (
            <div className="gsx-controls">
              <label className="gsx-field">
                Genus
                <Select value={genusDir} options={genusOptions} onChange={onGenus} />
              </label>

              <label className="gsx-field">
                Species
                <Select
                  value={speciesId}
                  options={speciesOptions}
                  onChange={setSpeciesId}
                  menuMinWidth={320}
                />
              </label>

              {possible ? (
                <>
                  <label className="gsx-field">
                    Region
                    <Select
                      value={String(regionId)}
                      options={regionOptions}
                      onChange={(v) => setRegionId(Number(v))}
                    />
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
                      <input
                        type="checkbox"
                        checked={wantFss}
                        onChange={(e) => setWantFss(e.target.checked)}
                      />
                      Signals only
                    </label>
                    <label className="gsx-check">
                      <input
                        type="checkbox"
                        checked={wantDss}
                        onChange={(e) => setWantDss(e.target.checked)}
                      />
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
                      An FSS counted signals and nobody followed it up; a probed body already has its genus; a
                      walked system has a species somebody logged on foot.
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
                        {minGravityOdds > 0 ? `at least ${fmtPct(minGravityOdds)}` : "any"}
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
                      From this commander&rsquo;s journals: of landable bodies with an atmosphere, every one
                      below 0.25 g carried biology and none above 0.65 g did. Signal presence, not species —
                      and his flying, not a survey of the galaxy.
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
                        Everything the codex knows there, at list price. Five times that if nobody has landed
                        yet.
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
          )}

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
                <Tooltip
                  text={
                    "A region is walked in system order, so an answer that ran out of time covers the first part of it rather than a spread across it — the nearest row here is the nearest in that part, not in the region. Name a single species to search the whole of it."
                  }
                >
                  <span className="gsx-partial">
                    covered {Math.round((scan.systemsSearched / Math.max(1, scan.systemsInRegion)) * 100)}% of{" "}
                    {scan.regionName ?? "the region"} — ran out of time
                  </span>
                </Tooltip>
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
                  map: {result.spread.length} of {crFmt.format(result.spreadCells ?? result.spread.length)}{" "}
                  sectors
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
                  </tr>
                </thead>
                <tbody>
                  {hits.map((h) => {
                    const ev = evidence(h.tiers);
                    return (
                      <tr key={h.systemAddress} className="fdb-row">
                        <td className="fdb-sys">
                          {h.starSystem}
                          <CopySystemButton system={h.starSystem} />
                        </td>
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </GalaxyHitsModal>
          ) : null}
          {possible && scan && scanBodies === 0 ? (
            <p className="fdb-empty">
              Nothing in {scan.regionName ?? "that region"} suits it. Try another region, or include bodies
              somebody has already probed.
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
          This build has no galaxy index. Build one with <code>npm run feeder</code>&apos;s index script to
          search beyond your own journals.
        </p>
      ) : null}
    </section>
  );
}
