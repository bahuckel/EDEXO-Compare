import { useEffect, useState } from "react";
import type { FeederStatusDTO } from "@shared/types";

/**
 * Feeder state, in the Options modal.
 *
 * The feeder builds the exomastery profiles the app ranks with, from a 250 MB corpus of raw EDSM
 * sample packs that never ships. This panel answers the one question that matters about it: **is the
 * data the app is ranking with the data the corpus actually holds?** Before the feeder was merged
 * into the app the answer was no on 72 of 79 profiles — every profile was installed by hand, so
 * every profile could be skipped by hand — and nothing anywhere said so.
 *
 * Renders nothing when there is no corpus on this machine, which is every normal install.
 */
export function FeederStatusPanel() {
  const [status, setStatus] = useState<FeederStatusDTO | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/feeder/status");
        // 501 is the normal answer on a build with no feeder: not an error worth showing.
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const j = (await res.json()) as FeederStatusDTO;
        if (!cancelled) setStatus(j);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || !status?.available) return null;

  const { snapshot, behind, unmatchedCorpusLabels } = status;
  const profileMb = (status.profileBytes / 1048576).toFixed(2);
  const coverage = `${status.speciesRowsWithProfile} of ${status.speciesRows}`;

  return (
    <section className="options-meta-block options-feeder">
      <p className="dim" style={{ marginBottom: "0.55rem", lineHeight: 1.45 }}>
        <strong>Exobiology data feeder</strong> — builds the habitat profiles used to rank candidate species.
        Run it with <code>npm run feeder -- run</code>; this panel reports what it has produced.
      </p>

      <dl className="options-feeder-grid">
        <dt>Species with a profile</dt>
        <dd>
          {coverage}
          <span className="dim"> · {profileMb} MB installed</span>
        </dd>

        <dt>Hydrated from EDSM</dt>
        <dd>
          {status.hydratedSpecies}
          {snapshot ? <span className="dim"> of {snapshot.corpusSpecies} in the corpus</span> : null}
        </dd>

        {snapshot ? (
          <>
            <dt>Corpus</dt>
            <dd>
              {snapshot.uniqueSystems.toLocaleString()} systems · {snapshot.uniquePlanets.toLocaleString()}{" "}
              planets · {snapshot.uniqueSightings.toLocaleString()} sightings
              <span className="dim"> · {snapshot.cumulativeCsvRows.toLocaleString()} CSV lines</span>
            </dd>
          </>
        ) : null}
      </dl>

      {status.behindCount > 0 ? (
        <div className="options-feeder-behind">
          <p className="warn tiny" style={{ marginBottom: "0.35rem" }}>
            {status.behindCount} profile{status.behindCount === 1 ? " is" : "s are"} behind the corpus —{" "}
            {status.behindOccurrences.toLocaleString()} observed bodies are not in the data the app ranks
            with.
          </p>
          <p className="dim tiny" style={{ marginBottom: "0.4rem" }}>
            <code>npm run feeder -- run</code> fetches the missing bodies and reinstalls them.
          </p>
          <ul className="options-feeder-list">
            {behind.slice(0, 8).map((b) => (
              <li key={b.species}>
                <span className="options-feeder-species">{b.species}</span>
                <span className="dim">
                  {" "}
                  {b.profileSamples} → {b.corpusOccurrences}
                </span>
              </li>
            ))}
          </ul>
          {status.behindCount > 8 ? <p className="dim tiny">… and {status.behindCount - 8} more</p> : null}
        </div>
      ) : (
        <p className="dim tiny">Every installed profile is built from everything the corpus holds.</p>
      )}

      {unmatchedCorpusLabels.length > 0 ? (
        <p className="dim tiny" style={{ marginTop: "0.5rem", lineHeight: 1.45 }}>
          {unmatchedCorpusLabels.length} corpus species have no row in the species database and are not
          installed: <span className="options-feeder-species">{unmatchedCorpusLabels.join(", ")}</span>. Left
          alone deliberately — the Anemone colour variants would have to be folded into a single
          <code> Anemone </code> row, which would describe a habitat none of them has.
        </p>
      ) : null}

      {snapshot ? (
        <p className="dim tiny" style={{ marginTop: "0.5rem" }}>
          Corpus figures from the last <code>feeder {snapshot.lastCommand}</code> ·{" "}
          {new Date(snapshot.writtenAtIso).toLocaleString()}. Profile figures are read live.
        </p>
      ) : (
        <p className="dim tiny" style={{ marginTop: "0.5rem" }}>
          Corpus counts appear after the first <code>npm run feeder -- status</code>.
        </p>
      )}
    </section>
  );
}
