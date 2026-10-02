/**
 * The System card row under the app bar (Discord batch O-E2, owner 2026-09-26).
 *
 * It replaces the name pill in the app bar and the "Stars / Notable" strip under it: neon chips in
 * one row that faded out on the right with the scrollbar hidden, so anything past the fade could not
 * be reached with a mouse. Now the system is a card of its own — name, what kind of place it is, where
 * the data came from, four figures — followed by one card per star and a card of notable bodies, all
 * of which wrap instead of fading.
 *
 * Kept short on his first look (owner, 2026-09-26): the map is the "Map" button beside the name, not
 * a small copy under the row; the four figures (bodies, bio bodies, signals, best), the "System"
 * label and the "Journal" source chip went — the body strip and the sell range already say the
 * figures, and the journal is the default source. Each star is one line with a coloured dot for what it
 * is good for.
 */
import type { MouseEvent as ReactMouseEvent } from "react";
import type { NotableBodyInfo, PrimaryStarHeaderEntryDTO, SystemKind } from "@shared/types";
import { CopySystemButton } from "./CopySystemButton";
import { BOOKMARK_STAR_FIELDS, BookmarkStar } from "./BookmarkButton";
import { memoOnSnapSlice, type SnapSlice } from "./snapSlice";
import { primaryStarRoleTooltip } from "./speciesMatchHelpers";
import { Tooltip } from "./ui/Tooltip";
import { RecordMedal, recordMarksByBodyId, recordMarksTitle } from "./noticesClient";
import { NspCard } from "./NspCard";

const KIND_LABEL: Record<SystemKind, string> = {
  bubble: "Bubble",
  colony: "Colony",
  colonising: "Colonising",
  facility: "Facility",
  empty: "Empty",
};
const KIND_TIP: Record<SystemKind, string> = {
  bubble: "Populated by Frontier: its planets were walked long ago — no first-footfall bonus here.",
  colony: "A player colony: no first-footfall bonus in populated systems.",
  colonising: "Being colonised: builders have been on the ground — no first-footfall bonus expected.",
  facility: "No residents, but something runs here — no first-footfall bonus expected.",
  empty: "Nobody lives here: a first footfall can still pay ×5.",
};

/**
 * The dot after a star's class (his colours): green scoopable, cyan neutron, red white dwarf or black
 * hole, purple anything else that cannot be scooped.
 */
function starDot(st: PrimaryStarHeaderEntryDTO): { kind: string; words: string } {
  if (st.blackHole) return { kind: "hazard", words: "Black hole" };
  if (st.starRole === "fuel") return { kind: "fuel", words: "Scoopable" };
  if (st.starRole === "neutron_boost") return { kind: "neutron", words: "Neutron star · jet boost" };
  if (st.starRole === "wd_boost") return { kind: "hazard", words: "White dwarf · boost" };
  return { kind: "none", words: "Not scoopable" };
}

const SYSTEM_CARD_FIELDS = [
  "primaryStarsHeader",
  "viewingSystemName",
  "currentSystem",
  "currentSystemKind",
  "currentRegion",
  "remoteView",
  "notableBodies",
  "nspOutlook",
  "dScanBodies",
  "focusedSystemUndiscovered",
  "notices",
  ...BOOKMARK_STAR_FIELDS,
] as const;

/** Re-rendered when the system it describes changes, not on every push (snapSlice.ts). */
export const SystemCardRow = memoOnSnapSlice(SYSTEM_CARD_FIELDS, function SystemCardRow({
  snap,
  onOpenSystemMap,
  onNotableClick,
}: {
  snap: SnapSlice<(typeof SYSTEM_CARD_FIELDS)[number]>;
  onOpenSystemMap: () => void;
  onNotableClick: (n: NotableBodyInfo, ev: ReactMouseEvent) => void;
}) {
  const header = snap.primaryStarsHeader;
  const name = header?.systemName ?? snap.viewingSystemName ?? snap.currentSystem ?? null;
  if (!name) return null;

  const rv = snap.remoteView?.state === "ready" ? snap.remoteView : null;
  const stars = header?.stars ?? [];
  const notable = snap.notableBodies ?? [];
  // Records broken here (owner, 2026-09-30): a gold border on a star, a medal on a notable planet.
  const records = recordMarksByBodyId(snap);

  return (
    <div className="sys-row" aria-label="System">
      <div className="sys-row__cards">
        <section className="sys-card cockpit-card">
          <div className="sys-card__head">
            <span className="sys-card__name">
              {name}
              <CopySystemButton system={name} />
              <BookmarkStar snap={snap} system={name} />
            </span>
            <button
              type="button"
              className="sys-card__btn"
              onClick={onOpenSystemMap}
              title="Open the system map"
            >
              Map ▸
            </button>
          </div>
          <div className="sys-card__chips">
            {snap.currentSystemKind ? (
              <Tooltip text={KIND_TIP[snap.currentSystemKind]}>
                <span className={`sys-chip sys-chip--kind-${snap.currentSystemKind}`}>
                  {KIND_LABEL[snap.currentSystemKind]}
                </span>
              </Tooltip>
            ) : null}
            {snap.currentRegion ? (
              <Tooltip
                text={`${snap.currentRegion.name} — the galactic region. Several species never appear outside particular regions.`}
              >
                <span className="sys-chip">{snap.currentRegion.name}</span>
              </Tooltip>
            ) : null}
            {/* A honk is something you did; a looked-up system has none to report. */}
            {snap.dScanBodies && !rv ? (
              <span
                className={`sys-chip ${snap.dScanBodies.honked ? "sys-chip--ok" : "sys-chip--warn"}`}
                title="Discovery scan (honk) in this system"
              >
                Honk: {snap.dScanBodies.honked ? "yes" : "no"}
              </span>
            ) : null}
            {snap.focusedSystemUndiscovered ? (
              <span className="sys-chip sys-chip--first" title="You were the first to discover this system">
                First discovery
              </span>
            ) : null}
            {/* Only a looked-up system says where it came from; the journal is the default and goes unsaid. */}
            {rv ? (
              <span
                className="sys-chip sys-chip--src"
                title="Not from your journals: bodies, signals and logged species from Spansh, kept 30 days."
              >
                Spansh · {rv.fetchedAt?.slice(5, 10) ?? ""}
              </span>
            ) : null}
          </div>
        </section>

        {stars.map((st, i) => {
          const rec = st.bodyId != null ? (records.get(st.bodyId) ?? []) : [];
          return (
          <section
            key={`${st.letter ?? "p"}-${i}`}
            className={`sys-star-card cockpit-card${rec.length ? " sys-star-card--record" : ""}`}
            title={
              `${i === 0 ? "Main star · " : ""}${starDot(st).words} — ${primaryStarRoleTooltip(st.starRole)}` +
              (rec.length ? `\n${recordMarksTitle(rec)}` : "")
            }
          >
            <span className="sys-card__k">{st.letter ?? "★"}</span>
            <span className="sys-star-card__cls">{st.fullSpectralNotation || st.shortLabel || "—"}</span>
            <span
              className={`sys-star-dot sys-star-dot--${starDot(st).kind}`}
              aria-label={starDot(st).words}
            />
          </section>
          );
        })}

        <NspCard o={snap.nspOutlook} />

        {notable.length > 0 ? (
          <section className="sys-notable-card cockpit-card">
            <span className="sys-card__k">Notable</span>
            <ul>
              {notable.map((n, i) => (
                <li key={`${n.bodyId}-${i}`}>
                  <button
                    type="button"
                    className={`sys-notable-card__row${n.green ? ` sys-notable-card__row--ggg sys-notable-card__row--ggg-${n.green.level}` : ""}`}
                    title={
                      (n.sold ? "Data sold — " : "") +
                      (n.dssMapped ? "Mapped (DSS)" : "Scanned, not mapped") +
                      " — click for quick facts" +
                      (n.green ? `\n${n.green.why}` : "") +
                      (n.features ?? []).map((f) => `\n${f.label}: ${f.why}`).join("") +
                      (records.has(n.bodyId) ? `\n${recordMarksTitle(records.get(n.bodyId)!)}` : "")
                    }
                    onClick={(ev) => onNotableClick(n, ev)}
                  >
                    <span className={n.dssMapped ? "sys-notable-card__dot--dss" : "sys-notable-card__dot"}>
                      ●
                    </span>{" "}
                    {n.bodyLabelShort} <span className="dim">— {n.tag}</span>
                    {n.features?.length && !n.tag.includes(n.features[0]!.label) ? (
                      <span className="sys-notable-card__features"> · {n.features.map((f) => f.label).join(" · ")}</span>
                    ) : null}
                    {n.sold ? <span className="sys-notable-card__sold">sold</span> : null}
                    {records.has(n.bodyId) ? <RecordMedal marks={records.get(n.bodyId)!} /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
});
