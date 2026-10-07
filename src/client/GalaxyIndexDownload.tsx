/**
 * The galaxy index as its own download (owner, 2026-10-04, plan 4.2: "separate download button marked
 * as EDAstro again, with size"). Shown over the map when the index is not on this PC; the download
 * runs on the server, and the map reloads once it is in place.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fmtPct } from "@shared/format";
import { MenuRow } from "./galaxy3d/G3dMenu";

interface IndexStatus {
  present: boolean;
  files?: { name: string; bytes: number | null }[];
  downloading: { name: string; done: number; total: number | null } | null;
  error: string | null;
  downloadBytes: number | null;
  /** The release holds newer files (galaxyIndexFiles.ts); null until it has been asked. */
  updateAvailable?: boolean | null;
}

const mb = (n: number) => `${Math.round(n / 1e6).toLocaleString()} MB`;

export function GalaxyIndexDownload() {
  const [st, setSt] = useState<IndexStatus | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/galaxy/index");
      if (r.ok) setSt((await r.json()) as IndexStatus);
    } catch {
      /* the next poll */
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // While it downloads: poll, and reload the map the moment the index is there.
  useEffect(() => {
    if (!st?.downloading) return;
    const t = window.setInterval(() => void load(), 1000);
    return () => window.clearInterval(t);
  }, [st?.downloading, load]);
  useEffect(() => {
    if (st?.present && sessionStorage.getItem("galaxyIndexDownloading") === "1") {
      sessionStorage.removeItem("galaxyIndexDownloading");
      window.location.reload();
    }
  }, [st?.present]);

  if (!st || st.present) return null;
  const d = st.downloading;
  const pct = d && d.total ? Math.round((d.done / d.total) * 100) : null;
  return (
    <div className="g3d-index-download" role="dialog" aria-label="Download the galaxy index">
      <h3>The galaxy map needs its index</h3>
      <p>
        Every system with recorded biology — 5.3 million — built from <strong>EDAstro</strong>&apos;s codex data, with
        the stars and planets from Spansh&apos;s galaxy dump. It is a separate download, kept beside your settings so
        updates leave it alone.
      </p>
      {d ? (
        <div className="g3d-index-download__progress" aria-live="polite">
          <div className="g3d-index-download__bar">
            <span style={{ width: `${pct ?? 5}%` }} />
          </div>
          <span>
            {d.name}: {mb(d.done)}
            {d.total ? ` of ${mb(d.total)}` : ""}
            {pct != null ? ` (${fmtPct(pct)})` : ""}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="g3d-btn g3d-btn--primary-small"
          onClick={() => {
            sessionStorage.setItem("galaxyIndexDownloading", "1");
            void fetch("/api/galaxy/index/download", { method: "POST" }).then(() => load());
          }}
          title="Download the galaxy index (EDAstro data) from the app's GitHub release"
        >
          Download from EDAstro data{st.downloadBytes ? ` · ${mb(st.downloadBytes)}` : ""}
        </button>
      )}
      {st.error ? <p className="g3d-error">The download stopped: {st.error}. Try again.</p> : null}
    </div>
  );
}

/*
  The index in the map's View menu (owner, 2026-10-07: "I still don't see a way to download the index in
  the galaxy map"): what is here, and Update when the release holds newer files — else Download again.
  The map reloads once the new files are in place.
*/
export function GalaxyIndexRow() {
  const [st, setSt] = useState<IndexStatus | null>(null);
  const wasDownloading = useRef(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/galaxy/index");
      if (r.ok) setSt((await r.json()) as IndexStatus);
    } catch {
      /* the next poll */
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (st?.downloading) {
      wasDownloading.current = true;
      const t = window.setInterval(() => void load(), 1000);
      return () => window.clearInterval(t);
    }
    if (wasDownloading.current && st && !st.error) window.location.reload();
    wasDownloading.current = false;
  }, [st, load]);
  if (!st?.present) return null;
  const here = (st.files ?? []).reduce((a, f) => a + (f.bytes ?? 0), 0);
  const d = st.downloading;
  const pct = d && d.total ? Math.round((d.done / d.total) * 100) : null;
  const update = st.updateAvailable === true;
  return (
    <MenuRow
      label="Galaxy index"
      hint="EDAstro's codex data with Spansh's stars and planets, downloaded from the app's GitHub release and kept beside your settings. Update fetches the newer files when the release has them."
    >
      {d ? (
        <span className="g3d-row__val" aria-live="polite">
          {pct != null ? fmtPct(pct) : mb(d.done)}
        </span>
      ) : (
        <button
          type="button"
          className={`g3d-btn${update ? " g3d-btn--primary-small" : ""}`}
          title={`${mb(here)} here${st.downloadBytes ? `, ${mb(st.downloadBytes)} on the release` : ""}`}
          onClick={() => void fetch("/api/galaxy/index/download", { method: "POST" }).then(() => load())}
        >
          {update ? `Update · ${st.downloadBytes ? mb(st.downloadBytes) : ""}` : "Download again"}
        </button>
      )}
      {st.error ? <span className="g3d-error"> {st.error}</span> : null}
    </MenuRow>
  );
}
