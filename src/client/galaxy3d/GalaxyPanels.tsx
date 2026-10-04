/**
 * The 3D map's side panels (G2–G3): a galaxy-index system (other commanders' records), one of the
 * commander's own systems (their journals), and a codex dot. Each fetches what it shows.
 */
import { useEffect, useState } from "react";
import type { GalaxyMySystemDTO, GalaxySectorDTO, GalaxySystemDTO } from "@shared/types";
import { formatCount, formatValue } from "./clusters";
import { fmtCrExact, fmtLy } from "@shared/format";
import type { CodexMapSystemDTO } from "@shared/dto/codexMap.js";
import { CopySystemButton } from "../CopySystemButton";
import { SystemBookmarkButton } from "../BookmarkButton";

const cr = fmtCrExact;

/** Fetch JSON for a key; "loading" while it runs, "error" when it fails. */
function useJson<T>(url: string | null): T | "loading" | "error" | null {
  const [v, setV] = useState<T | "loading" | "error" | null>(null);
  useEffect(() => {
    if (!url) {
      setV(null);
      return;
    }
    let live = true;
    setV("loading");
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setV(d))
      .catch(() => live && setV("error"));
    return () => {
      live = false;
    };
  }, [url]);
  return v;
}

/**
 * The galaxy index's record: evidence, species at 1×, total. By ordinal (a picked dot) or by id64
 * (a search hit); `fallbackName` titles a hit the index does not have.
 */
export function IndexRecord({
  ordinal,
  addr,
  heading,
  fallbackName,
}: {
  ordinal?: number;
  addr?: string;
  heading?: boolean;
  fallbackName?: string;
}) {
  const d = useJson<GalaxySystemDTO>(
    ordinal != null ? `/api/galaxy/system?i=${ordinal}` : `/api/galaxy/system?addr=${encodeURIComponent(addr ?? "")}`,
  );
  if (d === null || d === "loading") return <p>Loading…</p>;
  if (d === "error")
    return fallbackName ? (
      <h2 className="g3d-panel__name">
        {fallbackName}
        <CopySystemButton system={fallbackName} />
      </h2>
    ) : (
      <p className="g3d-error">Could not load this system.</p>
    );
  return (
    <>
      {heading ? (
        <>
          <h2 className="g3d-panel__name">
            {d.name}
            <CopySystemButton system={d.name} />
          </h2>
          <p className="g3d-panel__bm">
            <SystemBookmarkButton system={d.name} systemAddress={Number(d.id64)} pos={{ x: d.x, y: d.y, z: d.z }} />
          </p>
        </>
      ) : null}
      <p className="g3d-panel__meta">
        {d.region ?? "Outside the named regions"} · {fmtLy(d.distanceFromSolLy)} from Sol
        {d.bodyCount ? ` · ${d.bodyCount} bodies` : ""}
      </p>
      <p className="g3d-panel__chips">
        {d.evidence.dss ? <span className="g3d-chip g3d-chip--dss">Mapped (DSS)</span> : null}
        {d.evidence.codex ? <span className="g3d-chip g3d-chip--codex">Codex logged</span> : null}
        {d.evidence.fss ? <span className="g3d-chip">Signals seen</span> : null}
        {d.evidence.bodiesKnown ? <span className="g3d-chip">Bodies catalogued</span> : null}
      </p>
      {d.species.length ? (
        <table className="g3d-species">
          <tbody>
            {d.species
              .slice()
              .sort((a, b) => (b.baseCr ?? 0) - (a.baseCr ?? 0))
              .map((s) => (
                <tr key={s.speciesId}>
                  <td>{s.displayName}</td>
                  <td className="g3d-num">{cr(s.baseCr)}</td>
                </tr>
              ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Recorded here</td>
              <td className="g3d-num">{cr(d.valueCr)}</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p className="g3d-panel__note">Biological signals, no species recorded yet.</p>
      )}
      <p className="g3d-panel__note">
        Recorded by other commanders, so first footfall (×5) has most likely been taken — values are at 1×.
      </p>
    </>
  );
}

/** One of the commander's systems: what they did there, body by body, and the index's record too. */
export function MySystemRecord({ addr }: { addr: string }) {
  const d = useJson<GalaxyMySystemDTO>(`/api/galaxy/mine/system?addr=${addr}`);
  if (d === null || d === "loading") return <p>Loading…</p>;
  if (d === "error") return <p className="g3d-error">Could not load this system.</p>;
  const f = d.flags;
  return (
    <>
      <h2 className="g3d-panel__name">
        {d.name}
        <CopySystemButton system={d.name} />
      </h2>
      <p className="g3d-panel__bm">
        <SystemBookmarkButton
          system={d.name}
          systemAddress={d.addr}
          pos={d.x != null && d.y != null && d.z != null ? { x: d.x, y: d.y, z: d.z } : null}
        />
      </p>
      <p className="g3d-panel__chips">
        <span className="g3d-chip g3d-chip--you">Visited</span>
        {f & 2 ? <span className="g3d-chip">All bodies found</span> : null}
        {f & 4 ? <span className="g3d-chip g3d-chip--dss">You mapped (DSS)</span> : null}
        {f & 8 ? <span className="g3d-chip g3d-chip--you">You scanned plants</span> : null}
        {f & 32 ? <span className="g3d-chip g3d-chip--codex">◆ First discovery</span> : null}
        {f & 64 ? <span className="g3d-chip g3d-chip--codex">First footfall</span> : null}
      </p>
      {d.unfinishedFloorCr != null ? (
        <p className="g3d-panel__todo">Still waiting for you here: at least {cr(d.unfinishedFloorCr)}</p>
      ) : null}
      {d.bodies.length ? (
        <ul className="g3d-bodies">
          {d.bodies.map((b) => (
            <li key={b.name}>
              <div className="g3d-bodies__head">
                <strong>{b.name}</strong>
                <span>
                  {b.signals ? `${b.signals} bio signal${b.signals === 1 ? "" : "s"}` : ""}
                  {b.dss ? " · mapped" : ""}
                  {b.firstFootfall ? " · first footfall" : ""}
                </span>
              </div>
              {b.species.length ? (
                <ul>
                  {b.species.map((s) => (
                    <li key={s.name} className={s.analysed ? "g3d-done" : "g3d-partial"}>
                      {s.analysed ? "✓" : "…"} {s.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="g3d-panel__note">Not sampled yet.</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="g3d-panel__note">No biology here in your journals.</p>
      )}
      {d.indexOrdinal != null ? (
        <>
          <h3 className="g3d-panel__sub">What other commanders recorded here</h3>
          <IndexRecord ordinal={d.indexOrdinal} />
        </>
      ) : null}
    </>
  );
}

/** A codex dot: the region's entries at that system, ticked where this commander has them. */
export function CodexRecord({ system, region }: { system: CodexMapSystemDTO; region: string }) {
  const logged = system.entries.filter((e) => e.logged).length;
  return (
    <>
      <h2 className="g3d-panel__name">
        {system.name}
        <CopySystemButton system={system.name} />
      </h2>
      <p className="g3d-panel__meta">
        {region} · {logged} of {system.entries.length} codex entries logged in this region
      </p>
      <ul className="g3d-entries">
        {system.entries.map((e) => (
          <li key={e.key} className={e.logged ? "g3d-done" : "g3d-todo"}>
            {e.logged ? "✓" : "○"} {e.name}
          </li>
        ))}
      </ul>
      <p className="g3d-panel__note">
        From EDSM's codex records; the position is the system's sector box, so it is approximate.
      </p>
    </>
  );
}

/** A sector (every height of it): how many systems, and its most valuable ones — click one to go. */
export function SectorRecord({
  sectorKey,
  onPick,
}: {
  sectorKey: string;
  onPick: (s: GalaxySectorDTO["top"][number]) => void;
}) {
  const d = useJson<GalaxySectorDTO>(`/api/galaxy/sector?c=${sectorKey}`);
  if (d === null || d === "loading") return <p>Loading…</p>;
  if (d === "error") return <p className="g3d-error">Could not load this sector.</p>;
  return (
    <>
      <h2 className="g3d-panel__name">{d.name ?? "Unnamed sector"}</h2>
      <p className="g3d-panel__meta">{formatCount(d.systems)} systems with recorded biology</p>
      <h3 className="g3d-panel__sub">Most valuable here</h3>
      <table className="g3d-species g3d-species--pick">
        <tbody>
          {d.top.map((s) => (
            <tr key={s.ordinal} onClick={() => onPick(s)} title="Fly there">
              <td>{s.name}</td>
              <td className="g3d-num">{s.species} sp.</td>
              <td className="g3d-num">{formatValue(s.valueCr / 100_000)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="g3d-panel__note">Values at 1×, from other commanders' records.</p>
    </>
  );
}
