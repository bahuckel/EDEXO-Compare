/**
 * The phenomena card on the system row (shared/nspOutlook.ts): what the commander met here, what
 * EDAstro has logged here, or — when neither knows — the chance of one, from how many its
 * neighbourhood has, with the nearest kinds. Shown only when there is something to say, which needs
 * his own sightings or the EDAstro phenomena download.
 */
import type { ReactNode } from "react";
import type { NspOutlookDTO } from "@shared/nspOutlook";
import { NSP_CHANCE_WORDS } from "@shared/nspOutlook";

const CHANCE_LABEL = { low: "Low", medium: "Medium", high: "High" } as const;

export function NspCard({ o }: { o: NspOutlookDTO | null | undefined }) {
  if (!o) return null;
  const named = o.seen.filter(Boolean);
  const signalOnly = o.seen.length > 0 && named.length === 0;
  if (!o.seen.length && !o.logged.length && !o.guess && !o.nearest.length) return null;
  const nearTitle = o.nearest.length
    ? "\nNearest known: " + o.nearest.map((n) => `${n.name} — ${n.system}, ${n.distanceLy} ly`).join("; ")
    : "";
  const loggedTitle = o.loggedDetail.length ? `\nLogged on EDAstro: ${o.loggedDetail.join(", ")}` : "";
  const families = (list: string[]) => (
    <>
      <span className="nsp-card__known">{list.slice(0, 3).join(", ")}</span>
      {list.length > 3 ? <span className="dim"> +{list.length - 3}</span> : null}
    </>
  );

  let title: string;
  let body: ReactNode;
  if (named.length) {
    title = "You met these here (your journals)." + loggedTitle + nearTitle;
    body = families(named);
  } else if (signalOnly) {
    title = "Your FSS found a phenomenon here; drop in at the signal to see which." + loggedTitle + nearTitle;
    body = o.logged.length ? (
      <>
        <span className="nsp-card__known">Signal here</span>
        <span className="dim"> · EDAstro: </span>
        {families(o.logged)}
      </>
    ) : (
      <span className="nsp-card__known">Signal here — drop in to see which</span>
    );
  } else if (o.logged.length) {
    title = "Logged here by other commanders (EDAstro's codex file)." + loggedTitle + nearTitle;
    body = (
      <>
        {families(o.logged)}
        <span className="dim"> · on EDAstro</span>
      </>
    );
  } else if (o.guess && !o.guess.thin) {
    const g = o.guess;
    title =
      `A guess from the neighbourhood: ${g.nspSystems.toLocaleString()} of ${g.knownSystems.toLocaleString()} known systems within ${g.radiusLy} ly have a phenomenon.` +
      ` "${CHANCE_LABEL[g.chance]}" meant ${NSP_CHANCE_WORDS[g.chance]} in a test on EDAstro's data. The FSS says for sure on arrival.` +
      nearTitle;
    body = (
      <>
        <span className={`nsp-card__chance nsp-card__chance--${g.chance}`}>{CHANCE_LABEL[g.chance]} chance</span>
        <span className="dim">
          {" "}
          · {g.nspSystems.toLocaleString()} within {g.radiusLy} ly
        </span>
      </>
    );
  } else if (o.guess?.thin) {
    title =
      `Only ${o.guess.knownSystems} known systems within ${o.guess.radiusLy} ly: too few to guess from. The FSS says for sure on arrival.` +
      nearTitle;
    body = <span className="dim">Too little explored around here</span>;
  } else {
    title = "Nothing known here." + nearTitle;
    body = <span className="dim">None known here</span>;
  }
  const near = o.nearest[0];
  return (
    <section className="nsp-card cockpit-card" title={title}>
      <span className="sys-card__k">Phenomena</span>
      <span className="nsp-card__line">{body}</span>
      {near && !o.seen.length && !o.logged.length ? (
        <span className="nsp-card__near dim">
          nearest: {near.name}, {near.distanceLy} ly
        </span>
      ) : null}
    </section>
  );
}
