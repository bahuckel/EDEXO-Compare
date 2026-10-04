/**
 * The NavRoute star finder (owner, 2026-10-04): every route plotted in the game's galaxy map is kept
 * with each system's star class (navRouteLog.ts). This drawer lists them — filter by star type and
 * name, see whether EDSM knows each one, check the ones you pick, and keep the stars you want with ☆.
 * The filtered systems are marked on the map.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { STAR_CLASSES, starClassIndex } from "@shared/galaxyTraits";
import { SystemBookmarkButton } from "./BookmarkButton";
import { CopySystemButton } from "./CopySystemButton";

export interface NavRouteSystemDTO {
  address: number;
  name: string;
  starClass: string;
  pos: [number, number, number];
  firstSeen: string;
  lastSeen: string;
  routes: number;
  edsm?: boolean;
}
interface NavRoutesDTO {
  routes: { at: string; from: string; to: string; count: number }[];
  systems: NavRouteSystemDTO[];
  checking: { done: number; total: number; note: string | null } | null;
  last: number[];
}

type EdsmFilter = "all" | "missing" | "known" | "unchecked";
/** Rows drawn at once; the filters narrow the rest. */
const ROW_CAP = 400;

const classKey = (sc: string) => {
  const i = starClassIndex(sc);
  return i >= 0 ? STAR_CLASSES[i]!.key : "?";
};
const classLabel = (key: string) => STAR_CLASSES.find((c) => c.key === key)?.label ?? "Unknown";

export function GalaxyNavRoutePanel({
  onShown,
  onFly,
}: {
  /** The systems the filters leave, for the map's markers. */
  onShown: (systems: NavRouteSystemDTO[]) => void;
  onFly: (s: NavRouteSystemDTO) => void;
}) {
  const [data, setData] = useState<NavRoutesDTO | null>(null);
  const [classes, setClasses] = useState<Set<string>>(new Set());
  const [edsm, setEdsm] = useState<EdsmFilter>("all");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/navroutes");
      if (r.ok) setData((await r.json()) as NavRoutesDTO);
    } catch {
      /* the next poll */
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // While EDSM is being asked, follow its progress.
  useEffect(() => {
    if (!data?.checking) return;
    const t = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(t);
  }, [data?.checking, load]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of data?.systems ?? []) m.set(classKey(s.starClass), (m.get(classKey(s.starClass)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.systems ?? []).filter((s) => {
      if (classes.size && !classes.has(classKey(s.starClass))) return false;
      if (needle && !s.name.toLowerCase().includes(needle)) return false;
      if (edsm === "missing" && s.edsm !== false) return false;
      if (edsm === "known" && s.edsm !== true) return false;
      if (edsm === "unchecked" && s.edsm !== undefined) return false;
      return true;
    });
  }, [data, classes, edsm, q]);
  useEffect(() => onShown(shown), [shown, onShown]);

  const unchecked = shown.filter((s) => s.edsm === undefined);
  const toggle = (k: string) =>
    setClasses((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  if (!data) return <p className="g3d-panel__note">Loading your routes…</p>;
  if (!data.systems.length)
    return (
      <p className="g3d-panel__note">
        Plot a route in the game&apos;s galaxy map: every system on it, with its star class, is listed here — a free survey
        of the star types along the way. Long routes find the most.
      </p>
    );
  const ck = data.checking;
  return (
    <div className="g3d-navroute">
      <p className="g3d-panel__note">
        {data.systems.length.toLocaleString()} systems from {data.routes.length} route{data.routes.length === 1 ? "" : "s"}{" "}
        you plotted.
      </p>
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
      <div className="g3d-navroute__row">
        <input
          className="g3d-find__input g3d-filter__search"
          type="search"
          placeholder="System name"
          aria-label="Filter by system name"
          value={q}
          onChange={(ev) => setQ(ev.target.value)}
        />
        <select
          className="g3d-select"
          aria-label="EDSM"
          value={edsm}
          onChange={(ev) => setEdsm(ev.target.value as EdsmFilter)}
          title="Whether EDSM knows the system: one it does not is a candidate nobody has reported"
        >
          <option value="all">EDSM: all</option>
          <option value="missing">Not in EDSM</option>
          <option value="known">In EDSM</option>
          <option value="unchecked">Not checked yet</option>
        </select>
      </div>
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
            }).then(() => load())
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
        <button
          type="button"
          className="g3d-btn g3d-navroute__clear"
          onClick={() => {
            if (window.confirm("Forget every route and system in this list?")) void fetch("/api/navroutes", { method: "DELETE" }).then(() => load());
          }}
          title="Forget every route kept here"
        >
          Clear
        </button>
      </div>
      <ul className="g3d-navroute__list">
        {shown.slice(0, ROW_CAP).map((s) => (
          <li key={s.address} className="g3d-navroute__item">
            <span className="g3d-navroute__class" title={`${classLabel(classKey(s.starClass))} (${s.starClass || "?"})`}>
              {s.starClass || "?"}
            </span>
            <button type="button" className="g3d-navroute__name" onClick={() => onFly(s)} title="Show it on the map">
              {s.name}
            </button>
            <span
              className={`g3d-navroute__edsm g3d-navroute__edsm--${s.edsm === true ? "known" : s.edsm === false ? "missing" : "unchecked"}`}
              title={s.edsm === true ? "EDSM knows this system" : s.edsm === false ? "Not in EDSM: nobody has reported it there" : "Not checked yet"}
            >
              {s.edsm === true ? "EDSM ✓" : s.edsm === false ? "not in EDSM" : "—"}
            </span>
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
    </div>
  );
}
