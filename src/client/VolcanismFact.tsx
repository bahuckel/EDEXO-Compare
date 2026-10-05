/**
 * The Planetary body card's Volcanism field (owner, 2026-10-05, shared/geology.ts): the volcanism, the
 * geological signal count and a CX mark when something down there is a new codex entry for this
 * region. The same size as the card's other fields; hover (or tap) lists what could be down there,
 * each Scanned, New Codex or Already in Codex for this region.
 */
import type { BodyGeologyDTO, GeologyStatus } from "@shared/geology";
import { Tooltip } from "./ui/Tooltip";

const STATUS: Record<GeologyStatus, string> = {
  scanned: "Scanned",
  new: "New Codex",
  region: "Already in Codex for this region",
  unknown: "Codex region unknown",
};

export function VolcanismFact({ geology }: { geology: BodyGeologyDTO | null | undefined }) {
  const g = geology ?? null;
  const fresh = g?.candidates.some((c) => c.status === "new") ?? false;
  const value = g?.volcanism ?? "None";
  const pop = (
    <div className="volc-pop">
      <div className="volc-pop__head">
        {g?.volcanism ?? "No volcanism"}
        {g?.signals != null ? ` · ${g.signals} geological signal${g.signals === 1 ? "" : "s"}` : ""}
      </div>
      {g && g.candidates.length ? (
        <ul className="volc-pop__list">
          {g.candidates.map((c) => (
            <li key={c.codexId} className={`volc-pop__row volc-pop__row--${c.status}`}>
              <span>{c.name}</span>
              <span className="volc-pop__status">{STATUS[c.status]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="volc-pop__note">
          {g?.volcanism
            ? "No surface geology recorded for this volcanism on this type of body."
            : "No surface geology without volcanism."}
        </p>
      )}
      {g?.volcanism && !g.signals ? (
        <p className="volc-pop__note">
          {g.signals === 0
            ? "The FSS counted no geological signals here."
            : "No geological signals counted yet: an FSS or a DSS says whether any are here."}
        </p>
      ) : null}
      {g?.candidates.length ? (
        <p className="volc-pop__note">
          What Spansh lists on bodies with this volcanism and body type
          {g.region ? `; codex for ${g.region}` : ""}.
        </p>
      ) : null}
    </div>
  );
  return (
    <Tooltip text={pop} className="fact volc-fact">
      <span className="fact-k">
        Volcanism
        {fresh ? (
          <span
            className="species-codex-mark volc-cx"
            aria-label="A new codex entry for this region could be down there"
          >
            CX
          </span>
        ) : null}
      </span>
      <span className="fact-v" tabIndex={0}>
        {value}
        {g?.signals ? <small> · {g.signals} geo</small> : null}
      </span>
    </Tooltip>
  );
}
