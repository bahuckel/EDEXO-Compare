/**
 * The phenomena card on the system row (shared/nspOutlook.ts): what the commander met here, what
 * EDAstro has logged here, or a prediction from the region, the main star and the phenomena nearby.
 * Shown only when one of those says there could be one (owner, 2026-09-30).
 */
import type { ReactNode } from "react";
import type { NspOutlookDTO } from "@shared/nspOutlook";
import { nspCardWorthShowing, nspChanceWord, nspOdds } from "@shared/nspOutlook";

export function NspCard({ o }: { o: NspOutlookDTO | null | undefined }) {
  if (!o || !nspCardWorthShowing(o)) return null;
  const named = o.seen.filter(Boolean);
  const signalOnly = o.seen.length > 0 && named.length === 0;
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
  let why: string | null = null;
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
  } else {
    const g = o.guess!;
    const pct = Math.round(g.p * 100);
    title =
      `A prediction from what this system is: ${pct} %, ${nspOdds(g.p)}.` +
      (g.reasons.length ? `\nWhy: ${g.reasons.join("; ")}.` : "") +
      "\nMeasured on EDAstro's codex file (1.9 M systems). The FSS says for sure on arrival." +
      nearTitle;
    body = (
      <>
        <span className={`nsp-card__chance nsp-card__chance--${g.p >= 0.3 ? "high" : g.p >= 0.1 ? "medium" : "low"}`}>
          {nspChanceWord(g.p)}
        </span>
        <span className="dim"> · {nspOdds(g.p)}</span>
      </>
    );
    why = g.reasons[0] ?? null;
  }
  return (
    <section className="nsp-card cockpit-card" title={title}>
      <span className="sys-card__k">Phenomena</span>
      <span className="nsp-card__line">{body}</span>
      {why ? <span className="nsp-card__near dim">{why}</span> : null}
    </section>
  );
}
