/**
 * The options modal and its panels, split out of App.tsx (7.3).
 */
import { useToast } from "./ui/feedback";
import { useModal } from "./ui/useModal";
import { InfoPopover } from "./ui/Tooltip";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSnapshot } from "@shared/types";
import { journalHistoryPresetLabel, journalHistoryWindowPresetChoices, parseJournalHistoryPreset, JournalHistoryPreset } from "@shared/journalHistoryPreset";
import { useFeederStatus } from "./FeederStatusPanel";
import { ExoMissLogPanel } from "./SpeciesCard";
import { EXO_MAP_CR_MAX, EXO_MAP_CR_MIN, EXO_MAP_CR_STEP, EXO_MAP_PLUS_SLIDER_MAX, secondScreenUrl } from "./lsPrefs";

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
function CopyLanUrlButton({ url }: { url: string }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(t);
  }, [done]);

  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* an unparseable URL is still copyable; it just gets its whole self as the label */
  }

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
      {done ? "copied" : `Copy for ${host}`}
    </button>
  );
}

/**
 * Contributing discoveries back to Canonn Research.
 *
 * The privacy line is the point of this panel, not a footnote on it. Canonn's endpoint takes the
 * journal line verbatim with the commander's name attached — there is no anonymous form and no key
 * to scope it down — so the switch itself is the whole consent and it has to say so before it is
 * flipped, not after.
 */
function CanonnUploadPanel({ state }: { state: AppSnapshot["canonnUpload"] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const setEnabled = async (enabled: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/settings/canonn-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) setMsg(j.error ?? "Could not change the setting.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="options-canonn options-meta-block">
      <p className="dim" style={{ marginBottom: "0.65rem", lineHeight: 1.45 }}>
        <strong>Send discoveries to Canonn</strong> — the community science archive this app's rules
        came from. Organic scans, the sales that date them, codex entries, and whatever else Canonn is
        currently asking for.
      </p>

      <p className="options-canonn-privacy dim" style={{ marginBottom: "0.65rem", lineHeight: 1.45 }}>
        <strong>Your CMDR name is shared.</strong> Canonn's archive is keyed on it, and the journal
        line is sent exactly as the game wrote it. There is no anonymous form of this. Only live
        events go — turning it on never uploads your existing journals — and it is off until you turn
        it on.
      </p>

      <label className="options-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy}
          onChange={(ev) => void setEnabled(ev.target.checked)}
        />
        <span>Send my discoveries to Canonn</span>
      </label>

      {state.enabled && state.sent + state.failed > 0 ? (
        <p className="dim options-canonn-tally">
          This session: {state.sent.toLocaleString()} sent
          {state.failed > 0 ? `, ${state.failed.toLocaleString()} not accepted` : ""}.
        </p>
      ) : null}

      {msg ? <p className="warn tiny">{msg}</p> : null}

      <p className="dim tiny" style={{ marginTop: "0.5rem" }}>
        <a href="https://canonn.science/" target="_blank" rel="noreferrer noopener">
          canonn.science
        </a>
      </p>
    </section>
  );
}

function EdsmAutoFetchPanel({ state }: { state: AppSnapshot["edsmAutoFetch"] }) {
  const [commanderName, setCommanderName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function post(
    path: string,
    body: unknown,
    method = "POST",
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(body),
      });
      return (await r.json()) as { ok: boolean; error?: string };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Request failed." };
    }
  }

  return (
    <section className="options-edsm options-meta-block">
      <p className="dim" style={{ marginBottom: "0.65rem", lineHeight: 1.45 }}>
        <strong>EDSM auto-fetch</strong> — when you jump into a system the app has no scans for, look it up on
        EDSM while you travel, so the system can be triaged before you arrive.
      </p>
      <p className="options-edsm-privacy dim" style={{ marginBottom: "0.65rem", lineHeight: 1.45 }}>
        This sends <strong>the name of every system you enter</strong> to edsm.net, a third party, and your
        EDSM commander name and API key with it. Nothing else leaves your machine. It is off until you turn it
        on.
      </p>
      {/*
        Was a paragraph explaining account registration and key storage (A5). The registration part
        is one instruction and belongs on one line; the storage part is a promise about a secret,
        which is worth keeping but is not what somebody reads while they are fetching a key — so it
        sits behind the ⓘ with the rest of the detail.
      */}
      <p className="dim" style={{ marginBottom: "0.65rem" }}>
        Register or log in, then copy your key from{" "}
        <a href="https://www.edsm.net/en/settings/api" target="_blank" rel="noreferrer noopener">
          edsm.net/en/settings/api
        </a>
        .
        <InfoPopover title="Where the key is kept" label="Where the key is kept">
          <p>
            The key is stored on this machine only, in its own file beside your settings — never in the
            settings file itself, and never in the repository.
          </p>
          <p>
            <strong>Forget key</strong> deletes that file and switches auto-fetch off with it.
          </p>
        </InfoPopover>
      </p>

      {state.hasKey ? (
        <p className="options-edsm-stored dim">
          Stored: <strong>{state.commanderName}</strong> · key ending <code>{state.keyHint}</code>
        </p>
      ) : null}

      <div className="options-edsm-fields">
        <label htmlFor="edsm-cmdr">EDSM commander name</label>
        <input
          id="edsm-cmdr"
          type="text"
          autoComplete="off"
          value={commanderName}
          placeholder={state.commanderName ?? "CMDR name on EDSM"}
          onChange={(ev) => setCommanderName(ev.target.value)}
        />
        <label htmlFor="edsm-key">EDSM API key</label>
        <input
          id="edsm-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder={state.hasKey ? "•••• stored" : "from edsm.net/en/settings/api"}
          onChange={(ev) => setApiKey(ev.target.value)}
        />
      </div>

      <div className="options-edsm-actions">
        <button
          type="button"
          className="btn secondary"
          disabled={busy || !commanderName.trim() || !apiKey.trim()}
          onClick={() => {
            setBusy(true);
            setMsg(null);
            void post("/api/settings/edsm-credentials", { commanderName, apiKey })
              .then((r) => {
                setMsg(
                  r.ok
                    ? { kind: "ok", text: "Key stored on this machine." }
                    : { kind: "err", text: r.error ?? "Could not store the key." },
                );
                // Never keep the secret in component state once the server has it.
                if (r.ok) setApiKey("");
              })
              .finally(() => setBusy(false));
          }}
        >
          Save key
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={busy || !state.hasKey}
          onClick={() => {
            setBusy(true);
            setMsg(null);
            void post("/api/settings/edsm-credentials", null, "DELETE")
              .then(() => {
                setApiKey("");
                setMsg({ kind: "ok", text: "Key deleted. Auto-fetch is off." });
              })
              .finally(() => setBusy(false));
          }}
        >
          Forget key
        </button>
      </div>

      <label className="options-edsm-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy || !state.hasKey}
          onChange={(ev) => {
            const enabled = ev.target.checked;
            setBusy(true);
            setMsg(null);
            void post("/api/settings/edsm-auto-fetch", { enabled })
              .then((r) => {
                if (!r.ok) setMsg({ kind: "err", text: r.error ?? "Could not change the setting." });
              })
              .finally(() => setBusy(false));
          }}
        />
        <span>
          Look up systems on EDSM automatically when I jump
          {state.hasKey ? "" : " (store your API key first)"}
        </span>
      </label>

      {msg ? <p className={msg.kind === "ok" ? "msg ok" : "msg err"}>{msg.text}</p> : null}
    </section>
  );
}

/**
 * Where the feeder corpus lives — the only setting that has to exist while the feeder is *hidden*.
 *
 * The toolbar entry is gated on `feeder.available`, and `available` is false whenever the corpus
 * cannot be found. Both built-in search paths are relative to `PROJECT_ROOT`, which in a packaged
 * build is the install directory, so an owner whose corpus sits beside the repository could never
 * reach the feeder at all — and could not reach a setting inside it either. So it lives in Options,
 * which is always open to them, and it names every path that was tried rather than only reporting
 * failure.
 */
function FeederCorpusSetting() {
  const { status } = useFeederStatus();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status) setDraft(status.configuredCorpusDir ?? "");
  }, [status]);

  const save = useCallback(
    async (value: string | null) => {
      setBusy(true);
      try {
        const r = await fetch("/api/settings/feeder-data-directory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feederDataDir: value }),
        });
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
        toast.success(value ? "Corpus folder saved — reopen the app to load it." : "Corpus folder cleared.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save the corpus folder.");
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  if (!status) return null;

  return (
    <section className="options-block">
      <h4 className="options-block-title">Data feeder corpus</h4>
      <p className="options-journal-line dim">
        {status.available ? (
          <>
            Found at <code>{status.corpusDir}</code>
          </>
        ) : (
          "No corpus found — the feeder toolbar entry stays hidden until one is set."
        )}
      </p>
      <div className="options-row">
        <input
          type="text"
          className="options-text-input"
          value={draft}
          spellCheck={false}
          placeholder="Full path to the feeder data folder"
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Feeder corpus folder"
        />
        <button type="button" disabled={busy || !draft.trim()} onClick={() => void save(draft.trim())}>
          Save
        </button>
        <button
          type="button"
          disabled={busy || !status.configuredCorpusDir}
          onClick={() => {
            setDraft("");
            void save(null);
          }}
        >
          Clear
        </button>
      </div>
      {!status.available && status.searchedDirs.length > 0 ? (
        <details className="options-journal-line dim">
          <summary>Where it looked</summary>
          <ul className="options-path-list">
            {status.searchedDirs.map((d) => (
              <li key={d}>
                <code>{d}</code>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
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

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
            <FeederCorpusSetting />
            {/*
              The second screen is the same server on the same key — one query parameter apart
              (§51). Both were printed as whole URLs, on the reasoning that a bookmarkable link
              should be visible; in practice the link is pasted, never read, and the access key made
              every one of them wrap (A5).
            */}
            {snap.mode === "server" && snap.lanUrls.length > 0 ? (
              <>
                <p className="options-journal-line options-oneline dim">
                  <span className="options-oneline-label">Phone</span>
                  {snap.lanUrls.map((u) => (
                    <CopyLanUrlButton key={u} url={u} />
                  ))}
                </p>
                <p className="options-journal-line options-oneline dim">
                  <span className="options-oneline-label">Second screen</span>
                  {snap.lanUrls.map((u) => (
                    <CopyLanUrlButton key={u} url={secondScreenUrl(u)} />
                  ))}
                  <InfoPopover title="Second screen" label="What the second screen shows">
                    <p>
                      The same server, one query parameter apart: read-only triage for this system, meant
                      for a tablet or a spare monitor beside the game.
                    </p>
                    <p>
                      The link carries this machine&apos;s LAN access key, so bookmark it on the device once
                      and it keeps working across restarts.
                    </p>
                  </InfoPopover>
                </p>
              </>
            ) : (
              <p className="options-journal-line dim">
                LAN server: use <code>npm run start:server</code>
              </p>
            )}
          </section>

          <ExoMissLogPanel outliers={snap.exoOutliers} />

          <EdsmAutoFetchPanel state={snap.edsmAutoFetch} />
          <CanonnUploadPanel state={snap.canonnUpload} />

          <section className="options-journal-history options-meta-block options-oneline">
            <label className="options-oneline-label" htmlFor="journal-history-window">
              Journal history
            </label>
            <select
              id="journal-history-window"
              value={serverJournalHistoryPreset}
              onChange={(ev) => {
                void persistJournalHistory(parseJournalHistoryPreset(ev.target.value));
              }}
            >
              <option value="all">{journalHistoryPresetLabel("all")}</option>
              {journalHistoryWindowPresetChoices().map((p) => (
                <option key={p} value={p}>
                  {journalHistoryPresetLabel(p)}
                </option>
              ))}
            </select>
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

          <button type="button" className="btn-top-danger options-reset-exo" onClick={onResetExobiology}>
            Reset exobiology…
          </button>
        </div>
      </div>
    </div>
  );
}
