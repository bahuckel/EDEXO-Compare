/**
 * The NavRoute star finder (owner, 2026-10-04), in two halves chosen by the buttons on top:
 *
 * - **Next** — the route plotted now, read from the game's `NavRoute.json`: each system's name, star
 *   class and position. Filter by star type and name, and ask EDSM which systems it knows; one it
 *   does not is a candidate nobody has reported. ☆ keeps one as a bookmark.
 * - **Previous** — the systems you have been to, from your journals, over the last day, week, month,
 *   three months, year or all of it, with the star class each jump named. No EDSM: they are yours.
 *
 * Choosing one shrinks the other into a "‹" that brings both back. The listed systems are marked on
 * the map.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { STAR_CLASSES, starClassIndex } from "@shared/galaxyTraits";
import type { GalaxyRouteDTO, GalaxyVisitedDTO } from "@shared/types";
import { SystemBookmarkButton } from "./BookmarkButton";
import { CopySystemButton } from "./CopySystemButton";
import { isNum, oneOf, usePersistedState } from "./usePersistedState";

/** A system as the map marks it. */
export interface NavRouteSystemDTO {
  address: number;
  name: string;
  starClass: string;
  pos: [number, number, number];
  edsm?: boolean;
  visited?: boolean;
}
interface NavRoutesDTO {
  systems: { address: number; edsm?: boolean }[];
  checking: { done: number; total: number; note: string | null } | null;
}

type Half = "none" | "next" | "previous";
type EdsmFilter = "all" | "missing" | "known" | "unchecked";
const RANGES: { days: number; label: string }[] = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "365d" },
  { days: 0, label: "All" },
];
/** Rows drawn at once; the filters narrow the rest. */
const ROW_CAP = 400;

const classKey = (sc: string) => {
  const i = starClassIndex(sc);
  return i >= 0 ? STAR_CLASSES[i]!.key : "?";
};
const classLabel = (key: string) => STAR_CLASSES.find((c) => c.key === key)?.label ?? "Unknown";
const coords = (p: [number, number, number]) => p.map((v) => (Math.round(v * 100) / 100).toLocaleString("en-US")).join(" / ");

export function GalaxyNavRoutePanel({
  next,
  onShown,
  onFly,
}: {
  /** The route plotted now (from the map's route poll). */
  next: GalaxyRouteDTO["navRoute"];
  /** The systems the filters leave, for the map's markers. */
  onShown: (systems: NavRouteSystemDTO[]) => void;
  onFly: (s: NavRouteSystemDTO) => void;
}) {
  const [half, setHalf] = usePersistedState<Half>("galaxy.navroute.half", "none", oneOf("none", "next", "previous"));
  const [days, setDays] = usePersistedState("galaxy.navroute.days", 7, isNum);
  const [classes, setClasses] = useState<Set<string>>(new Set());
  const [edsmFilter, setEdsmFilter] = useState<EdsmFilter>("all");
  const [q, setQ] = useState("");

  // EDSM's answers, kept by the route log (navRouteLog.ts) for every system on a plotted route.
  const [log, setLog] = useState<NavRoutesDTO | null>(null);
  const loadLog = useCallback(async () => {
    try {
      const r = await fetch("/api/navroutes");
      if (r.ok) setLog((await r.json()) as NavRoutesDTO);
    } catch {
      /* the next poll */
    }
  }, []);
  useEffect(() => {
    if (half === "next") void loadLog();
  }, [half, loadLog]);
  useEffect(() => {
    if (!log?.checking) return;
    const t = window.setInterval(() => void loadLog(), 2000);
    return () => window.clearInterval(t);
  }, [log?.checking, loadLog]);

  const [visited, setVisited] = useState<GalaxyVisitedDTO | null>(null);
  // "Reading your journals…" stayed for good when the answer never came.
  const [visitedFailed, setVisitedFailed] = useState(false);
  useEffect(() => {
    if (half !== "previous") return;
    let live = true;
    setVisited(null);
    setVisitedFailed(false);
    fetch(`/api/galaxy/visited?days=${days}`)
      .then((r) => (r.ok ? (r.json() as Promise<GalaxyVisitedDTO>) : null))
      .then((d) => {
        if (!live) return;
        if (d) setVisited(d);
        else setVisitedFailed(true);
      })
      .catch(() => live && setVisitedFailed(true));
    return () => {
      live = false;
    };
  }, [half, days]);

  const list: (NavRouteSystemDTO & { at?: string })[] = useMemo(() => {
    if (half === "next") {
      const edsm = new Map((log?.systems ?? []).map((s) => [s.address, s.edsm]));
      return next.map((s) => ({
        address: s.address,
        name: s.name,
        starClass: s.starClass,
        pos: [s.x, s.y, s.z],
        edsm: edsm.get(s.address),
        visited: s.visited,
      }));
    }
    if (half === "previous") {
      return (visited?.systems ?? []).map((s) => ({
        address: s.address,
        name: s.name,
        starClass: s.starClass,
        pos: [s.x, s.y, s.z],
        visited: true,
        at: s.at,
      }));
    }
    return [];
  }, [half, next, log, visited]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of list) m.set(classKey(s.starClass), (m.get(classKey(s.starClass)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((s) => {
      if (classes.size && !classes.has(classKey(s.starClass))) return false;
      if (needle && !s.name.toLowerCase().includes(needle)) return false;
      if (half === "next") {
        if (edsmFilter === "missing" && s.edsm !== false) return false;
        if (edsmFilter === "known" && s.edsm !== true) return false;
        if (edsmFilter === "unchecked" && s.edsm !== undefined) return false;
      }
      return true;
    });
  }, [list, classes, edsmFilter, q, half]);
  useEffect(() => onShown(shown), [shown, onShown]);

  const choose = (h: Half) => {
    setHalf(h);
    setClasses(new Set());
    setQ("");
  };
  const toggle = (k: string) =>
    setClasses((cur) => {
      const n = new Set(cur);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const unchecked = shown.filter((s) => s.edsm === undefined);
  const ck = log?.checking ?? null;

  const halfButton = (h: Exclude<Half, "none">, label: string, sub: string) => {
    const other = half !== "none" && half !== h;
    return (
      <button
        type="button"
        className={`g3d-nr-half${half === h ? " g3d-nr-half--on" : ""}${other ? " g3d-nr-half--shrunk" : ""}`}
        aria-pressed={half === h}
        aria-label={other ? "Back to Previous and Next" : label}
        title={other ? "Back to Previous and Next" : sub}
        onClick={() => (other ? choose("none") : choose(h))}
      >
        <span className="g3d-nr-half__back" aria-hidden="true">
          ‹
        </span>
        <span className="g3d-nr-half__text">
          <strong>{label}</strong>
          <small>{sub}</small>
        </span>
      </button>
    );
  };

  return (
    <div className="g3d-navroute">
      <div className={`g3d-nr-halves g3d-nr-halves--${half}`}>
        {halfButton("previous", "Previous", "Systems you have been to")}
        {halfButton("next", "Next", "The route plotted now")}
      </div>

      {half === "none" ? (
        <p className="g3d-panel__note">
          <strong>Next</strong> lists the route you have plotted in the game, with each system's star class, to find neutron
          stars, Wolf-Rayets or black holes on the way and check which EDSM does not know. <strong>Previous</strong> lists the
          systems you have been to.
        </p>
      ) : null}

      {half === "previous" ? (
        <div className="g3d-navroute__chips" role="group" aria-label="When">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              className={days === r.days ? "g3d-filter__chip g3d-navroute__chip--on" : "g3d-filter__chip g3d-navroute__chip"}
              aria-pressed={days === r.days}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}

      {half !== "none" ? (
        <>
          <p className="g3d-panel__note">
            {half === "next"
              ? next.length
                ? `${next.length.toLocaleString()} systems on the route plotted now.`
                : "No route plotted: plot one in the game's galaxy map."
              : visited
                ? `${visited.systems.length.toLocaleString()} systems ${days ? `in the last ${RANGES.find((r) => r.days === days)?.label}` : "in your journals"}.`
                : visitedFailed
                  ? "Your journals could not be read."
                  : (
                      <>
                        <span className="inline-spinner" aria-hidden /> Reading your journals…
                      </>
                    )}
          </p>
          {counts.length ? (
            <div className="g3d-navroute__chips" aria-label="Star type">
              {counts.map(([k, n]) => (
                <button
                  key={k}
                  type="button"
                  className={classes.has(k) ? "g3d-filter__chip g3d-navroute__chip--on" : "g3d-filter__chip g3d-navroute__chip"}
                  aria-pressed={classes.has(k)}
                  onClick={() => toggle(k)}
                  title={`${classLabel(k)}: ${n.toLocaleString()} systems`}
                >
                  {k} {n.toLocaleString()}
                </button>
              ))}
            </div>
          ) : null}
          <div className="g3d-navroute__row">
            <input
              className="g3d-find__input g3d-filter__search"
              type="search"
              placeholder="System name"
              aria-label="Filter by system name"
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
            />
            {half === "next" ? (
              <select
                className="g3d-select"
                aria-label="EDSM"
                value={edsmFilter}
                onChange={(ev) => setEdsmFilter(ev.target.value as EdsmFilter)}
                title="Whether EDSM knows the system: one it does not is a candidate nobody has reported"
              >
                <option value="all">EDSM: all</option>
                <option value="missing">Not in EDSM</option>
                <option value="known">In EDSM</option>
                <option value="unchecked">Not checked yet</option>
              </select>
            ) : null}
          </div>
          {half === "next" ? (
            <div className="g3d-navroute__row">
              <button
                type="button"
                className="g3d-btn"
                disabled={!unchecked.length || !!ck}
                onClick={() =>
                  void fetch("/api/navroutes/edsm-check", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ addresses: unchecked.map((s) => s.address) }),
                  }).then(() => loadLog())
                }
                title="Ask EDSM about the systems listed that have not been checked: forty a request, five seconds apart"
              >
                Check EDSM ({unchecked.length.toLocaleString()})
              </button>
              {ck ? (
                <span className="g3d-navroute__progress" aria-live="polite">
                  {ck.note ?? `Asking EDSM… ${ck.done.toLocaleString()} / ${ck.total.toLocaleString()}`}
                </span>
              ) : null}
            </div>
          ) : null}
          <ul className="g3d-navroute__list">
            {shown.slice(0, ROW_CAP).map((s) => (
              <li key={s.address} className="g3d-navroute__item">
                <span className="g3d-navroute__class" title={`${classLabel(classKey(s.starClass))} (${s.starClass || "?"})`}>
                  {s.starClass || "?"}
                </span>
                <button type="button" className="g3d-navroute__name" onClick={() => onFly(s)} title={`Show it on the map · ${coords(s.pos)}`}>
                  {s.name}
                  <small className="g3d-navroute__sub">{s.at ? s.at.slice(0, 16).replace("T", " ") : coords(s.pos)}</small>
                </button>
                {half === "next" ? (
                  <span
                    className={`g3d-navroute__edsm g3d-navroute__edsm--${s.edsm === true ? "known" : s.edsm === false ? "missing" : "unchecked"}`}
                    title={
                      s.edsm === true ? "EDSM knows this system" : s.edsm === false ? "Not in EDSM: nobody has reported it there" : "Not checked yet"
                    }
                  >
                    {s.edsm === true ? "EDSM ✓" : s.edsm === false ? "not in EDSM" : "—"}
                  </span>
                ) : null}
                <CopySystemButton system={s.name} />
                <SystemBookmarkButton system={s.name} systemAddress={s.address} pos={{ x: s.pos[0], y: s.pos[1], z: s.pos[2] }} />
              </li>
            ))}
          </ul>
          {shown.length > ROW_CAP ? (
            <p className="g3d-panel__note">
              Showing {ROW_CAP} of {shown.length.toLocaleString()}: pick a star type or type a name to narrow it.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
