/**
 * The options modal and its panels, split out of App.tsx (7.3).
 */
import { useToast } from "./ui/feedback";
import { useModal } from "./ui/useModal";
import { InfoPopover } from "./ui/Tooltip";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { AppSnapshot } from "@shared/types";
import {
  journalHistoryPresetLabel,
  journalHistoryWindowPresetChoices,
  parseJournalHistoryPreset,
  JournalHistoryPreset,
} from "@shared/journalHistoryPreset";
import { FoldPanel } from "./ui/Fold";
import { useFeederStatus } from "./FeederStatusPanel";
import type { CollectionFocusConfig } from "@shared/collectionFocus";
import { ExoMissLogPanel } from "./SpeciesCard";
import {
  EXO_MAP_CR_MAX,
  EXO_MAP_CR_MIN,
  EXO_MAP_CR_STEP,
  EXO_MAP_PLUS_SLIDER_MAX,
  secondScreenUrl,
} from "./lsPrefs";

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
 * Contributing discoveries back to Canonn Research.
 *
 * The privacy line is the point of this panel, not a footnote on it. Canonn's endpoint takes the
 * journal line verbatim with the commander's name attached — there is no anonymous form and no key
 * to scope it down — so the switch itself is the whole consent and it has to say so **before** it is
 * flipped, not behind the `?`. That is the one difference from the two EDSM boxes: everything else
 * folds away, and "your CMDR name is shared" does not.
 */
function CanonnUploadPanel({ state }: { state: AppSnapshot["canonnUpload"] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <FoldPanel
      foldKey="options-canonn"
      className="options-meta-block"
      title="Send to Canonn"
      summary={state.enabled ? "on" : "off"}
      help={
        <>
          <p>
            Canonn Research is the community science archive this app's matching rules came from. Sending
            discoveries back is how the rules get better for everyone.
          </p>
          <p>
            <strong>What is sent</strong> — organic scans, the sales that date them, codex entries, and
            whatever else Canonn is currently asking for, as the game wrote them.
          </p>
          <p>
            <strong>Only live events.</strong> Turning this on never uploads your existing journals; it starts
            from the next thing you scan.
          </p>
          <p>
            <a href="https://canonn.science/" target="_blank" rel="noreferrer noopener">
              canonn.science
            </a>
          </p>
        </>
      }
    >
      <p className="dim options-canonn-privacy">
        <strong>Your CMDR name is shared.</strong> Canonn's archive is keyed on it and there is no anonymous
        form.
      </p>

      <label className="options-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy}
          onChange={(ev) => {
            const enabled = ev.target.checked;
            setBusy(true);
            setMsg(null);
            void postSetting("/api/settings/canonn-upload", { enabled })
              .then((r) => {
                if (!r.ok) setMsg(r.error ?? "Could not change the setting.");
              })
              .finally(() => setBusy(false));
          }}
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
    </FoldPanel>
  );
}

/**
 * One settings POST, shared by the three contribution panels.
 *
 * Lifted out of the EDSM fetch panel when the others arrived: three copies of "post JSON, read
 * `{ok, error}` back, turn a thrown fetch into an error object" drift, and the one that drifts is
 * the one that stops reporting failures.
 */
/**
 * The collection marker's thresholds, in Options.
 *
 * The ⌖ beside a species, and the `info gather` tag with it, come from two numbers that lived only
 * in `edexo-collection-focus.json` beside the user settings — editable with a text editor and a
 * restart, which is not a setting so much as a rumour. `⌖2` in the prediction rows is
 * `targetScans − ownScans`, so the commander could see the count and not the thing setting it.
 *
 * Two fields and a switch, deliberately: the config also carries a `dismissed` list, and a
 * per-species opt-out belongs on the species rather than in a box of ids here.
 *
 * Read from the server rather than the snapshot. It changes when somebody edits it and at no other
 * time, and the snapshot is already the largest thing on the wire.
 */
function CollectionFocusPanel() {
  const [cfg, setCfg] = useState<CollectionFocusConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/settings/collection-focus")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.config) setCfg(j.config as CollectionFocusConfig);
      })
      .catch(() => {
        /* the panel simply stays empty; nothing here is load-bearing */
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Always adopt what came back: the server clamps, and the box should show what will be used. */
  const save = useCallback((patch: Partial<CollectionFocusConfig>) => {
    setBusy(true);
    setMsg(null);
    void postSetting("/api/settings/collection-focus", patch)
      .then((r) => {
        if (!r.ok) {
          setMsg(r.error ?? "Could not change the setting.");
          return;
        }
        const next = (r as unknown as { config?: CollectionFocusConfig }).config;
        if (next) setCfg(next);
      })
      .finally(() => setBusy(false));
  }, []);

  if (!cfg) return null;

  return (
    <FoldPanel
      foldKey="options-collection-focus"
      className="options-meta-block"
      title="Worth-sampling marker"
      summary={cfg.enabled ? `${cfg.targetScans} scans · under ${cfg.corpusFloor} bodies` : "off"}
      help={
        <>
          <p>
            The ⌖ beside a species means the corpus is thin on it <em>and</em> you have confirmed it few times
            — so a sample there teaches the app more than its credits are worth. The number after it is how
            many of your own scans are still wanted.
          </p>
          <p>
            A <strong>Log</strong> counts, the same as a Sample or an Analyse. You do not have to finish a run
            for it to stop asking.
          </p>
        </>
      }
    >
      <label className="options-toggle">
        <input
          type="checkbox"
          checked={cfg.enabled}
          disabled={busy}
          onChange={(ev) => save({ enabled: ev.target.checked })}
        />
        <span>Mark species worth sampling</span>
      </label>

      {cfg.enabled ? (
        <div className="options-focus-grid">
          <label htmlFor="focus-target">Stop asking after</label>
          <span>
            <input
              id="focus-target"
              type="number"
              min={1}
              max={20}
              value={cfg.targetScans}
              disabled={busy}
              onChange={(ev) => save({ targetScans: Number(ev.target.value) })}
            />{" "}
            <span className="dim">of your own scans</span>
          </span>

          <label htmlFor="focus-floor">Corpus counts as thin under</label>
          <span>
            <input
              id="focus-floor"
              type="number"
              min={0}
              max={5000}
              step={10}
              value={cfg.corpusFloor}
              disabled={busy}
              onChange={(ev) => save({ corpusFloor: Number(ev.target.value) })}
            />{" "}
            <span className="dim">bodies</span>
          </span>
        </div>
      ) : null}

      {cfg.dismissed.length > 0 ? (
        <p className="dim options-focus-dismissed">
          {cfg.dismissed.length} species dismissed by hand in <code>edexo-collection-focus.json</code>.
        </p>
      ) : null}

      {msg ? <p className="options-error">{msg}</p> : null}
    </FoldPanel>
  );
}

async function postSetting(
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

/**
 * Fetching from EDSM, in Options.
 *
 * The half that reads: system names go out, somebody else's scans come back. It holds the API key
 * because the key is the account, and the account is what both halves use — but the switch here buys
 * only the lookups. Sending is its own box below, with its own switch.
 *
 * Same shape as that one: three controls and one line, everything else behind the `?`. What stays
 * visible is what leaves the machine, because that is the part nobody should have to go looking for.
 */
function EdsmFetchPanel({ state }: { state: AppSnapshot["edsmAutoFetch"] }) {
  const [commanderName, setCommanderName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  return (
    <FoldPanel
      foldKey="options-edsm-fetch"
      className="options-meta-block"
      title="Fetch from EDSM"
      summary={state.hasKey ? (state.enabled ? "on" : "key stored") : "no key"}
      help={
        <>
          <p>
            When you jump into a system this app has no scans for, it looks the system up on EDSM while you
            travel, so it can be triaged before you arrive.
          </p>
          <p>
            <strong>What is sent</strong> — the name of every system you enter, with your commander name and
            key. Nothing else. Off until you turn it on.
          </p>
          <p>
            <strong>The key</strong> lives on this machine in its own file beside your settings, never in the
            settings file and never in the repository. The app only ever shows its last four characters back
            to you. <strong>Forget key</strong> deletes it and switches both EDSM features off.
          </p>
          <p>
            Get a key from{" "}
            <a href="https://www.edsm.net/en/settings/api" target="_blank" rel="noreferrer noopener">
              edsm.net/en/settings/api
            </a>
            .
          </p>
        </>
      }
    >
      <p className="dim options-edsm-privacy">Sends the name of each system you enter to edsm.net.</p>

      <div className="options-field-rows">
        <label htmlFor="edsm-cmdr">Commander</label>
        <input
          id="edsm-cmdr"
          type="text"
          autoComplete="off"
          value={commanderName}
          placeholder={state.commanderName ?? "CMDR name on EDSM"}
          onChange={(ev) => setCommanderName(ev.target.value)}
        />
        <label htmlFor="edsm-key">API key</label>
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
            void postSetting("/api/settings/edsm-credentials", { commanderName, apiKey })
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
            void postSetting("/api/settings/edsm-credentials", null, "DELETE")
              .then(() => {
                setApiKey("");
                setMsg({ kind: "ok", text: "Key deleted." });
              })
              .finally(() => setBusy(false));
          }}
        >
          Forget key
        </button>
      </div>

      {state.hasKey ? (
        <p className="options-edsm-stored dim">
          <strong>{state.commanderName}</strong> · key ending <code>{state.keyHint}</code>
        </p>
      ) : null}

      <label className="options-edsm-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy || !state.hasKey}
          onChange={(ev) => {
            const enabled = ev.target.checked;
            setBusy(true);
            setMsg(null);
            void postSetting("/api/settings/edsm-auto-fetch", { enabled })
              .then((r) => {
                if (!r.ok) setMsg({ kind: "err", text: r.error ?? "Could not change the setting." });
              })
              .finally(() => setBusy(false));
          }}
        />
        <span>Look up systems when I jump{state.hasKey ? "" : " (store your key first)"}</span>
      </label>

      {msg ? <p className={msg.kind === "ok" ? "msg ok" : "msg err"}>{msg.text}</p> : null}
    </FoldPanel>
  );
}

/**
 * Contributing the journal to EDSM, in Options.
 *
 * Three controls and one line of prose. The first draft explained the protocol, the privacy position
 * and the catch-up's resume behaviour in four paragraphs above the switch, which is a wall of text
 * in a settings menu — the owner's note: *"no one wants to be greeted by a wall of text in their
 * options menu"*. All of it moved behind the `?`, which is the drawer `FoldPanel` already provides
 * (WEBUI-REDESIGN 5.3) and which the commander opens only if they care.
 *
 * The one sentence that stays visible is the one a commander must not have to ask for: that this
 * sends the journal itself, not just system names. Consent is not a footnote.
 */
function EdsmUploadPanel({ state, hasKey }: { state: AppSnapshot["edsmUpload"]; hasKey: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  /** A week, not everything: a four-year run should be chosen, not the default. */
  const [scope, setScope] = useState<"day" | "week" | "month" | "year" | "all">("week");
  const progress = state.progress;
  const running = progress?.running === true;

  const flip = (path: string, enabled: boolean) => {
    setBusy(true);
    setMsg(null);
    void postSetting(path, { enabled })
      .then((r) => {
        if (!r.ok) setMsg({ kind: "err", text: r.error ?? "Could not change the setting." });
      })
      .finally(() => setBusy(false));
  };

  return (
    <FoldPanel
      foldKey="options-edsm-upload"
      className="options-meta-block"
      title="Send to EDSM"
      summary={state.enabled ? (state.live ? "on, live" : "on") : "off"}
      help={
        <>
          <p>
            The same thing EDMarketConnector and EDDiscovery do: your discoveries appear on your EDSM
            commander profile. Uses the key from <em>Fetch from EDSM</em> above.
          </p>
          <p>
            <strong>What is sent</strong> — the game's own journal lines: where you jumped, what you scanned,
            when. EDSM publishes a list of event types it does not want and those are skipped. Fetching above
            sends only system names; this is much more.
          </p>
          <p>
            <strong>Catch up</strong> reads your journals oldest first and sends whatever EDSM has not been
            given, as far back as you choose. It remembers how far it got, so stopping is safe and running it
            again resumes. A short run does not stop a longer one later.
          </p>
          <p>
            <strong>Keep sending</strong> repeats that every few minutes while you play, reaching back a week
            so a few days with the app closed heal themselves. Gaps older than that are what the button is
            for.
          </p>
          <p>
            If EDMarketConnector is also running, you will both be uploading. EDSM ignores what it already
            has, so it is redundant rather than harmful.
          </p>
        </>
      }
    >
      <p className="dim options-edsm-privacy">Sends your journal — jumps, scans, times — to edsm.net.</p>

      <label className="options-edsm-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy || !hasKey || running}
          onChange={(ev) => flip("/api/settings/edsm-upload", ev.target.checked)}
        />
        <span>Send my journal to EDSM{hasKey ? "" : " (store your API key first)"}</span>
      </label>

      <label className="options-edsm-toggle">
        <input
          type="checkbox"
          checked={state.live}
          disabled={busy || !state.enabled}
          onChange={(ev) => flip("/api/settings/edsm-live-upload", ev.target.checked)}
        />
        <span>Keep sending as I play</span>
      </label>

      <div className="options-edsm-actions">
        <select
          aria-label="How far back to upload"
          value={scope}
          disabled={busy || !state.enabled || running}
          onChange={(ev) => setScope(ev.target.value as typeof scope)}
        >
          <option value="day">last day</option>
          <option value="week">last week</option>
          <option value="month">last month</option>
          <option value="year">last year</option>
          <option value="all">everything</option>
        </select>
        <button
          type="button"
          className="btn secondary"
          disabled={busy || !state.enabled || running}
          onClick={() => {
            setBusy(true);
            setMsg(null);
            void postSetting("/api/settings/edsm-catch-up", { scope })
              .then((r) => {
                if (!r.ok) setMsg({ kind: "err", text: r.error ?? "Could not start." });
              })
              .finally(() => setBusy(false));
          }}
        >
          {running ? "Catching up…" : "Catch up"}
        </button>
        {running ? (
          <button
            type="button"
            className="btn secondary"
            onClick={() => void postSetting("/api/settings/edsm-catch-up-cancel", {})}
          >
            Stop
          </button>
        ) : null}
      </div>

      {running && progress ? (
        <p className="options-edsm-stored dim">
          {progress.filesDone} / {progress.filesTotal} journals · {progress.eventsSent.toLocaleString()} sent
        </p>
      ) : state.ledger.eventsAccepted > 0 ? (
        <p className="options-edsm-stored dim">
          {state.ledger.eventsAccepted.toLocaleString()} events sent
          {state.ledger.lastRunAt ? `, last ${new Date(state.ledger.lastRunAt).toLocaleDateString()}` : ""}
        </p>
      ) : null}

      {progress?.error ? (
        <p className="msg err">
          {progress.error}
          {progress.fatal ? " — check the commander name and key above." : ""}
        </p>
      ) : null}

      {msg ? <p className={msg.kind === "ok" ? "msg ok" : "msg err"}>{msg.text}</p> : null}
    </FoldPanel>
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
                LAN server: use <code>npm run start:server</code>
              </p>
            )}
          </section>

          <ExoMissLogPanel outliers={snap.exoOutliers} />

          <EdsmFetchPanel state={snap.edsmAutoFetch} />
          <EdsmUploadPanel state={snap.edsmUpload} hasKey={snap.edsmAutoFetch.hasKey} />
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
