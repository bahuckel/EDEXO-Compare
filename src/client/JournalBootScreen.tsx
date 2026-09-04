import type { JournalBootProgressDTO } from "@shared/types";

export function JournalBootScreen({ boot, connected }: { boot: JournalBootProgressDTO; connected: boolean }) {
  const pct = Math.max(0, Math.min(100, boot.percent));
  const detail = boot.filesTotal > 0 ? `${boot.filesDone} / ${boot.filesTotal} journal logs` : null;

  return (
    <div className="journal-boot">
      <div className="journal-boot__glow" aria-hidden />
      <div className="journal-boot__panel">
        <div className="journal-boot__header">
          <div className="journal-boot__orb" aria-hidden>
            <span className="journal-boot__orb-ring" />
            <span className="journal-boot__orb-core" />
          </div>
          <h1 className="journal-boot__title">ED Exo Compare</h1>
          <p className="journal-boot__subtitle">Loading journal data</p>
        </div>

        <div
          className="journal-boot__meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          role="progressbar"
        >
          <div className="journal-boot__meter-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="journal-boot__pct-row">
          <span className="journal-boot__pct">{pct}%</span>
          <span className={`journal-boot__link ${connected ? "journal-boot__link--live" : ""}`}>
            {connected ? "Live updates" : "Connecting…"}
          </span>
        </div>

        <p className="journal-boot__message">{boot.message}</p>
        {detail ? <p className="journal-boot__detail">{detail}</p> : null}
      </div>
    </div>
  );
}
