/**
 * The options modal and its panels, split out of App.tsx (7.3).
 */
import { useToast } from "./ui/feedback";
import { useModal } from "./ui/useModal";
import { InfoPopover } from "./ui/Tooltip";
import { Select } from "./ui/Select";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { AppSnapshot } from "@shared/types";
import {
  journalHistoryPresetLabel,
  journalHistoryWindowPresetChoices,
  parseJournalHistoryPreset,
  JournalHistoryPreset,
} from "@shared/journalHistoryPreset";
import { ExoMissLogPanel } from "./SpeciesCard";
import {
  EXO_MAP_CR_MAX,
  EXO_MAP_CR_MIN,
  EXO_MAP_CR_STEP,
  EXO_MAP_PLUS_SLIDER_MAX,
  secondScreenUrl,
} from "./lsPrefs";
import {
  CanonnUploadPanel,
  EddnUploadPanel,
  CollectionFocusPanel,
  NotifyPanel,
  ColourSchemePanel,
  SnapshotStampPanel,
  EdsmFetchPanel,
  EdsmUploadPanel,
  FeederCorpusSetting,
} from "./OptionsPanels";
export { EddnUploadPanel } from "./OptionsPanels";

/**
 * EDSM auto-fetch, in Options.
 *
 * Two gates, deliberately. The **key** is the consent — going to edsm.net and fetching your own is a
 * decision, where a checkbox is a reflex — and the **toggle** is the switch. Neither alone starts
 * traffic, and clearing the key takes the toggle down with it.
 *
 * The panel says what leaves the machine, in those words, above the control that starts it. The key
 * is write-only from here: the server sends back the commander name and the last four characters,
 * which is enough to recognise and useless to anyone reading over a shoulder.
 */
/**
 * The bookmarkable second-screen address for a LAN URL that already carries the access key.
 *
 * Built with `URL` rather than string concatenation because these URLs already have a `?k=` on them,
 * and "does this one need ? or &" is exactly the question that produces a broken link on a phone.
 */
/**
 * Copy one LAN URL, labelled by the address rather than by the whole link (A5).
 *
 * The URLs were printed in full, two of them per network interface, which on a machine with a
 * wired card and a wireless one is four lines of `http://192.168.0.3:7111/?k=…` — and the key in
 * them is long, so they wrapped. Nobody reads a URL they are about to paste: the address is enough
 * to tell two interfaces apart, and the clipboard carries the rest.
 *
 * Same confirmation rule as {@link CopySystemButton}: a refused clipboard leaves the label alone,
 * because a false "copied" is discovered by pasting nothing into a phone.
 */
/** The `host:port` out of a LAN URL, or the whole thing when it will not parse. */
function lanHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function CopyLanUrlButton({ url, label = "Copy" }: { url: string; label?: string }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(t);
  }, [done]);

  return (
    <button
      type="button"
      className="btn secondary tiny"
      onClick={() => {
        void navigator.clipboard?.writeText(url).then(
          () => setDone(true),
          () => setDone(false),
        );
      }}
      title={url}
    >
      {done ? "copied" : label}
    </button>
  );
}

/**
 * "Copy diagnostics" (combined plan, Phase 5 [O-C]): one block of text for a support message —
 * build, system, journal folder, how the journals were read at start, LAN and upload switches, the
 * last warnings. The server leaves out what is private (server/diagnostics.ts); the text is shown
 * here as well, so the commander sees what they are about to send, and can copy it by hand where
 * the clipboard is refused.
 */
function CopyDiagnostics() {
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/app/diagnostics", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 501 ? "Not available in this build." : r.statusText);
      const t = await r.text();
      setText(t);
      try {
        await navigator.clipboard.writeText(t);
        toast.success("Diagnostics copied — paste them into your message.");
      } catch {
        toast.info("Copy them from the box below.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the diagnostics.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="options-diagnostics">
      <div className="options-oneline">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => void copy()}>
          Copy diagnostics
        </button>
        <span className="dim options-diagnostics-hint">
          For a bug report: no names, keys or links, your home folder as ~.
        </span>
      </div>
      {text ? (
        <textarea
          className="options-diagnostics-text"
          readOnly
          value={text}
          rows={Math.min(18, text.split("\n").length)}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Diagnostics"
        />
      ) : null}
    </div>
  );
}

export function MapOptionsModal({
  snap,
  plusMinCr,
  plusPlusMinCr,
  onResetExobiology,
  onClose,
}: {
  snap: AppSnapshot;
  plusMinCr: number;
  plusPlusMinCr: number;
  onResetExobiology: () => void;
  onClose: () => void;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const toast = useToast();
  const [optPlus, setOptPlus] = useState(plusMinCr);
  const [optPlusPlus, setOptPlusPlus] = useState(plusPlusMinCr);
  const saveTimerRef = useRef<number | null>(null);
  const pendingTiersRef = useRef<{ p: number; pp: number } | null>(null);
  const tail = snap.journalPath ? snap.journalPath.split(/[/\\]/).pop() : "none";

  const persistExoMapTiers = useCallback(
    (p: number, pp: number) => {
      void (async () => {
        try {
          const r = await fetch("/api/settings/exo-map-tiers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plusMinCr: p, plusPlusMinCr: pp }),
          });
          const j = (await r.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (!r.ok) throw new Error(j?.error || r.statusText);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not save options.");
        }
      })();
    },
    [toast],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = pendingTiersRef.current;
      if (pending) persistExoMapTiers(pending.p, pending.pp);
    };
  }, [persistExoMapTiers]);

  useEffect(() => {
    setOptPlus(Math.min(plusMinCr, EXO_MAP_PLUS_SLIDER_MAX));
    setOptPlusPlus(plusPlusMinCr);
  }, [plusMinCr, plusPlusMinCr]);

  /*
    A checkbox plus a conditional dropdown, for a setting with one value (A5). The checkbox was
    derived state — "is the preset not `all`" — and the dropdown it revealed could not express the
    off position, so turning the window off and on again silently reset which window it was. One
    select holds the whole range, `all` included, and the server's value is the only state there is.
  */
  const serverJournalHistoryPreset: JournalHistoryPreset = snap.journalHistoryPreset ?? "all";

  const persistJournalHistory = useCallback(
    async (preset: JournalHistoryPreset) => {
      try {
        const r = await fetch("/api/settings/journal-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset }),
        });
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save journal history option.");
      }
    },
    [toast],
  );


  const queueSave = (p: number, pp: number) => {
    pendingTiersRef.current = { p, pp };
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const cur = pendingTiersRef.current;
      if (cur) persistExoMapTiers(cur.p, cur.pp);
    }, 320);
  };

  const plusPlusSliderMin = Math.min(
    EXO_MAP_CR_MAX,
    Math.ceil((optPlus + 1) / EXO_MAP_CR_STEP) * EXO_MAP_CR_STEP,
  );

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel options-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="options-modal-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="options-modal-title">Options</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <section className="options-meta-block">
            <CollectionFocusPanel />
            {/*
              The second screen is the same server on the same key — one query parameter apart
              (§51). Both were printed as whole URLs, on the reasoning that a bookmarkable link
              should be visible; in practice the link is pasted, never read, and the access key made
              every one of them wrap (A5).
            */}
            {snap.mode === "server" && snap.lanUrls.length > 0 ? (
              /*
                One row per address, rather than one button per address per destination.

                Two paragraphs of "Copy for 192.168.0.3:7111" buttons meant a machine with a wired
                card and a wireless one produced four long buttons that wrapped, with nothing saying
                which pair belonged to which address. The address is said once now and the two
                destinations are columns beside it.
              */
              <div className="options-lan">
                <span />
                <span className="options-lan-head">Phone</span>
                <span className="options-lan-head">
                  Second screen
                  <InfoPopover title="Second screen" label="What the second screen shows">
                    <p>
                      The same server, one query parameter apart: read-only triage for this system, meant for
                      a tablet or a spare monitor beside the game.
                    </p>
                    <p>
                      The link carries this machine&apos;s LAN access key, so bookmark it on the device once
                      and it keeps working across restarts.
                    </p>
                  </InfoPopover>
                </span>
                {snap.lanUrls.map((u) => (
                  <Fragment key={u}>
                    <span className="options-lan-addr">{lanHost(u)}</span>
                    <CopyLanUrlButton url={u} label="Copy" />
                    <CopyLanUrlButton url={secondScreenUrl(u)} label="Copy" />
                  </Fragment>
                ))}
              </div>
            ) : (
              <p className="options-journal-line dim">
                Other devices: turn on LAN access in the launcher&apos;s Network settings for phone and second-screen
                links.
              </p>
            )}
          </section>

          <NotifyPanel />
          <ColourSchemePanel />

          <ExoMissLogPanel outliers={snap.exoOutliers} />

          <EdsmFetchPanel state={snap.edsmAutoFetch} />
          <EdsmUploadPanel state={snap.edsmUpload} hasKey={snap.edsmAutoFetch.hasKey} />
          <CanonnUploadPanel state={snap.canonnUpload} />
          <EddnUploadPanel state={snap.eddnUpload} />
          <SnapshotStampPanel prefs={snap.photoStamp} />

          <section className="options-journal-history options-meta-block options-oneline">
            <label className="options-oneline-label" htmlFor="journal-history-window">
              Journal history
            </label>
            <Select
              id="journal-history-window"
              className="options-inline-select"
              value={serverJournalHistoryPreset}
              options={[
                { value: "all", label: journalHistoryPresetLabel("all") },
                ...journalHistoryWindowPresetChoices().map((p) => ({
                  value: p,
                  label: journalHistoryPresetLabel(p),
                })),
              ]}
              onChange={(v) => {
                void persistJournalHistory(parseJournalHistoryPreset(v));
              }}
            />
            <InfoPopover title="Journal history" label="What journal history changes">
              <p>
                By default the app merges <strong>every</strong> <code>Journal.*.log</code> in your Elite
                folder. Pick a window instead and it reads only the logs that start inside it.
              </p>
              <p>
                The cutoff uses real time and advances while the app runs. Changing this triggers a full
                journal resync.
              </p>
            </InfoPopover>
          </section>

          {/*
            The mechanism here predates this session and is not being changed — only its presentation
            (A5). Two paragraphs explained what a <strong>+</strong> means before either slider was
            reachable, which put the explanation of a control above the control itself. The owner's
            shape: one title saying what is being marked, then two labelled bars.
          */}
          <section className="options-meta-block options-tier-group">
            <h4 className="options-block-title">Body on system map marking</h4>
            <p className="options-tier-lead dim">
              The lowest per-species sell value a body must be worth before the system map marks it.
              <InfoPopover title="Body on system map marking" label="How the map marking works">
                <p>
                  <strong>Min. CR for +</strong> is the lowest per-species sell value (CR) that must be met
                  before the system map shows a <strong>+</strong> on that planet for exobiology.
                </p>
                <p>
                  <strong>Min. CR for ++</strong> does the same with a higher threshold: when it is met the
                  map shows <strong>++</strong> instead, so the more valuable finds stand out. It must stay
                  above the <strong>+</strong> threshold, which is why its slider starts where it does.
                </p>
              </InfoPopover>
            </p>
            <div className="options-tier-field">
              <label htmlFor="exo-tier-plus">Min. CR for +</label>
              <input
                id="exo-tier-plus"
                type="range"
                min={EXO_MAP_CR_MIN}
                max={EXO_MAP_PLUS_SLIDER_MAX}
                step={EXO_MAP_CR_STEP}
                value={Math.min(optPlus, EXO_MAP_PLUS_SLIDER_MAX)}
                onChange={(ev) => {
                  const plus = Number(ev.target.value);
                  let pp = optPlusPlus;
                  if (pp <= plus) {
                    pp = Math.min(EXO_MAP_CR_MAX, plus + EXO_MAP_CR_STEP);
                    if (pp <= plus) pp = plus + 1;
                  }
                  setOptPlus(plus);
                  setOptPlusPlus(pp);
                  queueSave(plus, pp);
                }}
              />
              <div className="options-tier-value">
                {Math.min(optPlus, EXO_MAP_PLUS_SLIDER_MAX).toLocaleString()} CR
              </div>
            </div>
            <div className="options-tier-field">
              <label htmlFor="exo-tier-plusplus">Min. CR for ++</label>
              <input
                id="exo-tier-plusplus"
                type="range"
                min={plusPlusSliderMin}
                max={EXO_MAP_CR_MAX}
                step={EXO_MAP_CR_STEP}
                value={Math.max(plusPlusSliderMin, optPlusPlus)}
                onChange={(ev) => {
                  let pp = Number(ev.target.value);
                  pp = Math.round(pp / EXO_MAP_CR_STEP) * EXO_MAP_CR_STEP;
                  const minPP = plusPlusSliderMin;
                  pp = Math.max(minPP, Math.min(EXO_MAP_CR_MAX, pp));
                  setOptPlusPlus(pp);
                  queueSave(optPlus, pp);
                }}
              />
              <div className="options-tier-value">
                {Math.max(plusPlusSliderMin, optPlusPlus).toLocaleString()} CR (min{" "}
                {plusPlusSliderMin.toLocaleString()} CR)
              </div>
            </div>
          </section>

          {/*
            What the app is running on, for support (review F-1.6, combined plan 3.3 + Phase 5 [O-C]):
            Options used to open on these lines, which mean nothing to someone choosing a colour scheme.
          */}
          <details className="options-about options-meta-block">
            <summary>About this install</summary>
            {snap.lastJournalEventIso ? (
              <p className="options-last-event dim">
                <span className="options-last-event-label">Last event:</span> {snap.lastJournalEventIso}
              </p>
            ) : null}
            <p className="options-journal-line dim">
              Journal: <code>{tail}</code>
              {snap.journalFileCount > 0 ? (
                <span className="tab"> · merged {snap.journalFileCount} log file(s)</span>
              ) : null}
            </p>
            <p className="options-journal-line dim">Species DB: {snap.speciesCount}</p>
            <CopyDiagnostics />
            <FeederCorpusSetting />
          </details>

          <button type="button" className="btn-top-danger options-reset-exo" onClick={onResetExobiology}>
            Reset exobiology…
          </button>
        </div>
      </div>
    </div>
  );
}
