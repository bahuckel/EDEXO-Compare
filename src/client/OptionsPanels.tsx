/**
 * The Options dialog's panels: uploads (Canonn, EDDN, EDSM), EDSM fetching, collection focus, snapshot stamp, feeder corpus. Split out of OptionsModal.tsx (code review D, 2026-09-27).
 */
import { useFeederStatus } from "./FeederStatusPanel";
import { FoldPanel } from "./ui/Fold";
import { Select } from "./ui/Select";
import { useToast } from "./ui/feedback";
import type { CollectionFocusConfig } from "@shared/collectionFocus";
import {
  CARRIER_NOTICE_MIN_FROM_SOL_LY,
  NEARBY_JUMPS_MAX,
  NEARBY_JUMPS_MIN,
  NOTABLE_KINDS,
  type CarrierNoticeMode,
  type NearbyPrefsDTO,
  type NotifyPrefsDTO,
  type NotifySettingsDTO,
} from "@shared/notices";
import { POI_GROUP_OPTIONS } from "@shared/gecCategories";
import { BODY_FEATURE_GROUPS, BODY_FEATURES } from "@shared/bodyFeatures";
import { APP_THEME_PRESETS, resolveAppTheme, rgbToHex, type AppThemeChoice, type SavedAppTheme } from "@shared/appThemes";
import { readAppTheme, readSavedThemes, setAppTheme, writeSavedThemes } from "./appTheme";
import { CARRIER_SERVICE_OPTIONS } from "@shared/carrierServices";
import type { AppSnapshot } from "@shared/types";
import { useCallback, useEffect, useState } from "react";

/**
 * Contributing discoveries back to Canonn Research.
 *
 * The privacy line is the point of this panel, not a footnote on it. Canonn's endpoint takes the
 * journal line verbatim with the commander's name attached — there is no anonymous form and no key
 * to scope it down — so the switch itself is the whole consent and it has to say so **before** it is
 * flipped, not behind the `?`. That is the one difference from the two EDSM boxes: everything else
 * folds away, and "your CMDR name is shared" does not.
 */
export function CanonnUploadPanel({ state }: { state: AppSnapshot["canonnUpload"] }) {
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
 * Sending live events to EDDN, the relay every other community tool listens to (owner, 2026-09-24).
 *
 * Off by default, and like Canonn the switch is the whole consent — so what leaves the machine is
 * said in the panel, not only behind the `?`. Unlike Canonn, EDDN scrambles the name before anyone
 * downstream sees it, and the panel says that too.
 */
export function EddnUploadPanel({ state }: { state: AppSnapshot["eddnUpload"] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <FoldPanel
      foldKey="options-eddn"
      className="options-meta-block"
      title="Send to EDDN"
      summary={state.enabled ? "on" : "off"}
      help={
        <>
          <p>
            EDDN is the Elite Dangerous Data Network: EDSM, Spansh, Inara and the other community tools build
            their galaxy maps from what players' apps send there. This app reports as
            &ldquo;EDEXO-Compare&rdquo;.
          </p>
          <p>
            <strong>What is sent</strong> — jumps, body scans, surface and FSS signals, organic scans (log and
            sample), codex entries, your plotted route, and the stations you dock at. Fuel, fines, reputation
            and anything else about you are removed first, as EDDN requires.
          </p>
          <p>
            <strong>Only live events.</strong> Turning this on never uploads your existing journals; it starts
            from the next thing you do in game.
          </p>
          <p>
            <a href="https://github.com/EDCD/EDDN" target="_blank" rel="noreferrer noopener">
              github.com/EDCD/EDDN
            </a>
          </p>
        </>
      }
    >
      <p className="dim options-canonn-privacy">
        <strong>Your CMDR name is sent to EDDN</strong>, which scrambles it before passing the data on — the
        tools that receive it never see it.
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
            void postSetting("/api/settings/eddn-upload", { enabled })
              .then((r) => {
                if (!r.ok) setMsg(r.error ?? "Could not change the setting.");
              })
              .finally(() => setBusy(false));
          }}
        />
        <span>Send my live events to EDDN</span>
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
 * One settings POST, shared by the contribution panels.
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
export function CollectionFocusPanel() {
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

/**
 * "Notify me" (guild tester report, 2026-09-30). What lands in the mail icon's list: notable bodies,
 * personal records and notable stellar phenomena. Stored on the server, so the phone and this window
 * follow the same switches. No system notifications and no sound, apart from the opt-in record chime.
 */
export function NotifyPanel() {
  const [st, setSt] = useState<NotifySettingsDTO | null>(null);
  const p = st?.prefs ?? null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/settings/notify")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.prefs) setSt(j as NotifySettingsDTO);
      })
      .catch(() => {
        /* the panel stays empty */
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback((patch: Partial<Omit<NotifyPrefsDTO, "notable" | "nearby" | "features">> & {
    notable?: Partial<NotifyPrefsDTO["notable"]>;
    features?: Partial<NotifyPrefsDTO["features"]>;
    nearby?: Partial<Omit<NearbyPrefsDTO, "poiGroups">> & { poiGroups?: Partial<NearbyPrefsDTO["poiGroups"]> };
  }) => {
    setBusy(true);
    setMsg(null);
    void postSetting("/api/settings/notify", patch)
      .then((r) => {
        if (!r.ok) {
          setMsg(r.error ?? "Could not change the setting.");
          return;
        }
        const next = r as unknown as NotifySettingsDTO;
        if (next.prefs) setSt(next);
      })
      .finally(() => setBusy(false));
  }, []);

  if (!st || !p) return null;
  const nb = p.nearby;
  const poiOn = POI_GROUP_OPTIONS.filter((g) => nb.poiGroups[g.key]).length;
  const onCount =
    NOTABLE_KINDS.filter((k) => p.notable[k.key]).length +
    (p.records ? 1 : 0) +
    (p.nsp ? 1 : 0) +
    (p.codexFirst ?? true ? 1 : 0) +
    poiOn +
    (nb.carriers !== "off" ? 1 : 0) +
    BODY_FEATURES.filter((f) => p.features?.[f.key]).length;
  const radiusLy = st.jumpLy != null ? Math.round(nb.jumps * st.jumpLy) : null;

  return (
    <FoldPanel
      foldKey="options-notify"
      className="options-meta-block"
      title="Notify me"
      summary={`${onCount} on${p.chime ? " · chime" : ""}`}
      help={
        <>
          <p>
            Finds go to the <strong>mail icon</strong> in the top bar and stay there until you mark them read. Each
            one names the system and the body, so you can find it again several jumps later.
          </p>
          <p>
            <strong>Personal records</strong>: the largest and the smallest radius of every star type and planet class
            you have scanned. Your journals set the starting records quietly; only a record you break from now on is
            announced. A star that broke one glows gold on the system card, and a planet gets a medal.
          </p>
          <p>
            <strong>Nearby</strong>: after each jump, points of interest and carriers within that many of your
            average jumps (your last twenty, or the ship&apos;s range until you have flown a few). Each point of
            interest is announced once. Carriers only count out in the black, over{" "}
            {CARRIER_NOTICE_MIN_FROM_SOL_LY.toLocaleString()} ly from Sol, and their position is only as fresh as
            EDAstro&apos;s last sighting — the notice says how old it is. Both use the lists you downloaded in the
            Points of interest and Carriers panels.
          </p>
          <p>
            <strong>Green gas giants</strong>: a codex entry confirms one, a body on the edGGG catalogue is a known
            one, and a surface temperature that a known one has makes it likely. A K10-Type Anomaly in the system
            (they spawn only around them) makes every gas giant there possible. Open a gas giant&apos;s details to
            mark it green, or not green, yourself.
          </p>
          <p>
            <strong>Body features</strong>: small bodies, fast orbits, landables with a view, rings and more, each
            with the figures that make it one. All off until you tick them.
          </p>
          <p>Never a Windows notification. The chime is the only sound, and it is off unless you turn it on.</p>
        </>
      }
    >
      <div className="options-notify-grid">
        {NOTABLE_KINDS.map((k) => (
          <label key={k.key} className="options-toggle">
            <input
              type="checkbox"
              checked={p.notable[k.key]}
              disabled={busy}
              onChange={(ev) => save({ notable: { [k.key]: ev.target.checked } })}
            />
            <span>{k.label}</span>
          </label>
        ))}
        <label className="options-toggle">
          <input type="checkbox" checked={p.records} disabled={busy} onChange={(ev) => save({ records: ev.target.checked })} />
          <span>Personal records (largest / smallest)</span>
        </label>
        <label className="options-toggle">
          <input type="checkbox" checked={p.nsp} disabled={busy} onChange={(ev) => save({ nsp: ev.target.checked })} />
          <span>Notable stellar phenomena</span>
        </label>
        <label
          className="options-toggle"
          title="A candidate plant on a body in your system that nobody has logged in this region yet (EDSM's codex): the gold [CODEX FIRST]."
        >
          <input
            type="checkbox"
            checked={p.codexFirst ?? true}
            disabled={busy}
            onChange={(ev) => save({ codexFirst: ev.target.checked })}
          />
          <span>Codex first: a plant nobody has logged in the region</span>
        </label>
        <label className="options-toggle">
          <input
            type="checkbox"
            checked={p.chime}
            disabled={busy || !p.records}
            onChange={(ev) => save({ chime: ev.target.checked })}
          />
          <span>Chime when a record falls (this PC only)</span>
        </label>
      </div>

      <h4 className="options-notify-h">Body features</h4>
      <p className="dim tiny options-notify-sub">
        Each one you tick shows on the Notable card with the reason, and a new scan of one comes to the mail icon.
      </p>
      {BODY_FEATURE_GROUPS.map((g) => (
        <div key={g.key}>
          <p className="dim tiny options-notify-sub">{g.label}</p>
          <div className="options-notify-grid">
            {BODY_FEATURES.filter((f) => f.group === g.key).map((f) => (
              <label key={f.key} className="options-toggle" title={f.hint}>
                <input
                  type="checkbox"
                  checked={p.features?.[f.key] ?? false}
                  disabled={busy}
                  onChange={(ev) => save({ features: { [f.key]: ev.target.checked } })}
                />
                <span>{f.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}

      <h4 className="options-notify-h">Nearby</h4>
      <div className="options-focus-grid">
        <label htmlFor="notify-jumps">Within</label>
        <span>
          <input
            id="notify-jumps"
            type="number"
            min={NEARBY_JUMPS_MIN}
            max={NEARBY_JUMPS_MAX}
            value={nb.jumps}
            disabled={busy}
            onChange={(ev) => save({ nearby: { jumps: Number(ev.target.value) } })}
          />{" "}
          <span className="dim">
            jumps{radiusLy != null ? ` ≈ ${radiusLy.toLocaleString()} ly` : " (range known after your first jump)"}
          </span>
        </span>
      </div>
      <p className="dim tiny options-notify-sub">
        Points of interest{st.poiDataReady ? "" : " — download the list in Points of interest first"}
      </p>
      <div className="options-notify-grid">
        {POI_GROUP_OPTIONS.map((g) => (
          <label key={g.key} className="options-toggle" title={g.hint}>
            <input
              type="checkbox"
              checked={nb.poiGroups[g.key]}
              disabled={busy}
              onChange={(ev) => save({ nearby: { poiGroups: { [g.key]: ev.target.checked } } })}
            />
            <span>{g.label}</span>
          </label>
        ))}
      </div>
      <p className="dim tiny options-notify-sub">
        Carriers, beyond {CARRIER_NOTICE_MIN_FROM_SOL_LY.toLocaleString()} ly from Sol
        {st.carrierDataReady ? "" : " — download the list in Carriers first"}
      </p>
      <div className="options-focus-grid">
        <label htmlFor="notify-carriers">Announce</label>
        <select
          id="notify-carriers"
          className="options-inline-select"
          value={nb.carriers}
          disabled={busy}
          onChange={(ev) => save({ nearby: { carriers: ev.target.value as CarrierNoticeMode } })}
        >
          <option value="off">no carriers</option>
          <option value="every">every carrier</option>
          <option value="services">only carriers with a service below</option>
        </select>
      </div>
      <p className="dim tiny options-notify-sub">Notable stellar phenomena, from EDAstro&apos;s codex</p>
      <NspDownload
        on={nb.nsp}
        busy={busy}
        onToggle={(v) => save({ nearby: { nsp: v } })}
      />
      {nb.carriers === "services" ? (
        <div className="options-notify-grid">
          {CARRIER_SERVICE_OPTIONS.map((o) => (
            <label key={o.key} className="options-toggle" title={o.hint}>
              <input
                type="checkbox"
                checked={nb.carrierServices.includes(o.key)}
                disabled={busy}
                onChange={(ev) =>
                  save({
                    nearby: {
                      carrierServices: ev.target.checked
                        ? [...nb.carrierServices, o.key]
                        : nb.carrierServices.filter((k) => k !== o.key),
                    },
                  })
                }
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      ) : null}
      {msg ? <p className="options-error">{msg}</p> : null}
    </FoldPanel>
  );
}

/**
 * The app's colour scheme (guild tester report, 2026-09-30): presets to pick from, a colour of your
 * own, and your own saved under a name. Everything drawn in the accent follows; colours that mean
 * something (live green, done blue, warnings, rarity, the ×5 badge) stay as they are. Per device.
 */
export function ColourSchemePanel() {
  const [choice, setChoice] = useState<AppThemeChoice>(() => readAppTheme());
  const [saved, setSaved] = useState<SavedAppTheme[]>(() => readSavedThemes());
  const [name, setName] = useState("");
  const current = resolveAppTheme(choice);
  const currentHex = "custom" in choice ? choice.custom : rgbToHex(current.rgb);
  const pick = (c: AppThemeChoice) => {
    setChoice(c);
    setAppTheme(c);
  };
  const isOn = (c: AppThemeChoice) => JSON.stringify(c) === JSON.stringify(choice);
  const save = () => {
    const n = name.trim().slice(0, 24);
    if (!n) return;
    const next = [...saved.filter((s) => s.name.toLowerCase() !== n.toLowerCase()), { name: n, hex: currentHex }];
    setSaved(next);
    writeSavedThemes(next);
    pick({ custom: currentHex, name: n });
    setName("");
  };
  const remove = (n: string) => {
    const next = saved.filter((s) => s.name !== n);
    setSaved(next);
    writeSavedThemes(next);
  };
  const presetLabel = APP_THEME_PRESETS.find((p) => p.key === current.key)?.label;
  return (
    <FoldPanel
      foldKey="options-colour-scheme"
      className="options-meta-block"
      title="Colour scheme"
      summary={presetLabel ?? ("name" in choice && choice.name ? choice.name : "Your own")}
      help={
        <p>
          The app&apos;s accent colour. Colours that mean something keep theirs whatever you pick: green for the live
          sampling run, blue for done, red and yellow for warnings, the rarity colours and the ×5 badge. The HUD overlays
          have their own colours, in the launcher&apos;s Overlays settings. Kept on this device.
        </p>
      }
    >
      <div className="theme-swatches" role="radiogroup" aria-label="Colour scheme">
        {APP_THEME_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={isOn({ preset: p.key })}
            className={`theme-swatch${isOn({ preset: p.key }) ? " theme-swatch--on" : ""}`}
            style={{ ["--swatch" as string]: `rgb(${p.rgb})` }}
            title={p.label}
            onClick={() => pick({ preset: p.key })}
          >
            <span className="theme-swatch__dot" />
            {p.label}
          </button>
        ))}
        {saved.map((s) => (
          <span key={s.name} className="theme-saved">
            <button
              type="button"
              role="radio"
              aria-checked={isOn({ custom: s.hex, name: s.name })}
              className={`theme-swatch${isOn({ custom: s.hex, name: s.name }) ? " theme-swatch--on" : ""}`}
              style={{ ["--swatch" as string]: s.hex }}
              onClick={() => pick({ custom: s.hex, name: s.name })}
            >
              <span className="theme-swatch__dot" />
              {s.name}
            </button>
            <button type="button" className="theme-saved__x" title={`Forget "${s.name}"`} onClick={() => remove(s.name)}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="theme-custom">
        <label>
          <span className="dim">Your own colour</span>{" "}
          <input type="color" value={currentHex} onChange={(ev) => pick({ custom: ev.target.value })} />
        </label>
        <input
          className="theme-name"
          value={name}
          maxLength={24}
          placeholder="Name it to keep it"
          onChange={(ev) => setName(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") save();
          }}
        />
        <button type="button" className="btn-top-toggle" disabled={!name.trim()} onClick={save}>
          Save scheme
        </button>
      </div>
    </FoldPanel>
  );
}

interface NspStatus {
  haveData: boolean;
  rowCount: number;
  systemCount: number;
  fetchedAtMs: number | null;
  running: boolean;
  bytesDone: number;
  bytesTotal: number | null;
  error: string | null;
  cooldownMsRemaining: number;
  sizeLabel: string;
}

/*
  The NSP list is EDAstro's whole codex file, 855 MB, read as it arrives and kept as a few MB of
  phenomena (server/edastroNsp.ts). Opt-in and said up front (owner, 2026-09-30): the button names
  the size, and nothing downloads until it is pressed.
*/
function NspDownload({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: (v: boolean) => void }) {
  const [st, setSt] = useState<NspStatus | null>(null);
  const load = useCallback(() => {
    void fetch("/api/nsp/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.status) setSt(j.status as NspStatus);
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!st?.running) return;
    const t = window.setInterval(load, 1000);
    return () => window.clearInterval(t);
  }, [st?.running, load]);
  const start = (force: boolean) => {
    void fetch("/api/nsp/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.status) setSt(j.status as NspStatus);
      })
      .catch(() => {});
  };
  if (!st) return null;
  const mb = (b: number) => `${Math.round(b / 1_000_000).toLocaleString()} MB`;
  return (
    <div className="options-nsp">
      <label className="options-toggle">
        <input type="checkbox" checked={on} disabled={busy || !st.haveData} onChange={(ev) => onToggle(ev.target.checked)} />
        <span>
          Phenomena nearby
          {st.haveData
            ? ` — ${st.systemCount.toLocaleString()} systems known`
            : " — download the list first"}
        </span>
      </label>
      {st.running ? (
        <p className="dim tiny">
          Downloading and sorting: {mb(st.bytesDone)}
          {st.bytesTotal ? ` of ${mb(st.bytesTotal)} (${Math.floor((100 * st.bytesDone) / st.bytesTotal)} %)` : ""}. Only the
          phenomena and green gas giant reports are kept.
        </p>
      ) : (
        <p className="options-nsp__row">
          <button type="button" className="btn-top-toggle" onClick={() => start(st.haveData && st.cooldownMsRemaining > 0)}>
            {st.haveData ? "Refresh" : "Download"} NSP data ({st.sizeLabel})
          </button>
          <span className="dim tiny">
            {st.haveData && st.fetchedAtMs
              ? `Last fetched ${new Date(st.fetchedAtMs).toLocaleDateString()}. A refresh only downloads again if EDAstro changed the file.`
              : `EDAstro's whole codex file, straight from EDAstro. Kept on this PC: only the phenomena and green gas giant reports, a few MB.`}
          </span>
        </p>
      )}
      {st.error ? <p className="options-error">{st.error}</p> : null}
    </div>
  );
}

/**
 * What a panel snapshot stamps beside the EDEXO mark (owner, 2026-09-26): all off by default; the
 * EDEXO stamp itself has no option. The camera sits on Exo-signals, Candidate species and the map.
 */
export function SnapshotStampPanel({ prefs }: { prefs: AppSnapshot["photoStamp"] | undefined }) {
  const p = prefs ?? { commander: false, system: false, timestamp: false };
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const rows: { key: keyof typeof p; label: string }[] = [
    { key: "commander", label: "Commander name" },
    { key: "system", label: "System name" },
    { key: "timestamp", label: "Date and time (UTC)" },
  ];
  const on = rows.filter((r) => p[r.key]).map((r) => r.label.toLowerCase());
  return (
    <FoldPanel
      foldKey="options-snapshot-stamp"
      className="options-meta-block"
      title="Snapshot images"
      summary={on.length ? `EDEXO + ${on.join(", ")}` : "EDEXO stamp only"}
      help={
        <p>
          The camera on <strong>Exo-signals</strong>, <strong>Candidate species</strong> and the{" "}
          <strong>system map</strong> copies that panel as an image with the ED Exo Compare stamp under it;
          Shift+click saves a PNG instead. These add lines beside the stamp.
        </p>
      }
    >
      {rows.map((r) => (
        <label key={r.key} className="options-toggle">
          <input
            type="checkbox"
            checked={p[r.key]}
            disabled={busy}
            onChange={(ev) => {
              const value = ev.target.checked;
              setBusy(true);
              setMsg(null);
              void postSetting("/api/settings/photo-stamp", { [r.key]: value })
                .then((res) => {
                  if (!res.ok) setMsg(res.error ?? "Could not change the setting.");
                })
                .finally(() => setBusy(false));
            }}
          />
          <span>{r.label}</span>
        </label>
      ))}
      {msg ? <p className="warn tiny">{msg}</p> : null}
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
export function EdsmFetchPanel({ state }: { state: AppSnapshot["edsmAutoFetch"] }) {
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
export function EdsmUploadPanel({ state, hasKey }: { state: AppSnapshot["edsmUpload"]; hasKey: boolean }) {
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
        <Select
          ariaLabel="How far back to upload"
          className="options-inline-select"
          value={scope}
          disabled={busy || !state.enabled || running}
          options={[
            { value: "day", label: "last day" },
            { value: "week", label: "last week" },
            { value: "month", label: "last month" },
            { value: "year", label: "last year" },
            { value: "all", label: "everything" },
          ]}
          onChange={(v) => setScope(v as typeof scope)}
        />
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
export function FeederCorpusSetting() {
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
