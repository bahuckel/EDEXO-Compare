/**
 * The galaxy index as its own download (owner, 2026-10-04, plan 4.2: "separate download button marked
 * as EDAstro again, with size"). Shown over the map when the index is not on this PC; the download
 * runs on the server, and the map reloads once it is in place.
 */
import { useCallback, useEffect, useState } from "react";
import { fmtPct } from "@shared/format";

interface IndexStatus {
  present: boolean;
  downloading: { name: string; done: number; total: number | null } | null;
  error: string | null;
  downloadBytes: number | null;
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
