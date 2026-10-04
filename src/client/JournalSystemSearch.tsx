/**
 * The header's system search over the journals and Spansh. Split out of HeaderBar.tsx (code review D, 2026-09-27).
 */
import { CopySystemButton } from "./CopySystemButton";
import { InlineSpinner } from "./SharedModals";
import { bodyPartOfQuery, ownerFirst } from "./systemSearchMatch";
import { useToast } from "./ui/feedback";
import type { JournalSystemInfo } from "@shared/types";
import { memoOnSnapSlice, type SnapSlice } from "./snapSlice";
import { useEffect, useMemo, useRef, useState } from "react";
import { Tooltip } from "./ui/Tooltip";

/**
 * The header's system search: the journals first, Spansh as you type (owner, 2026-09-25).
 *
 * Pasting a name copied from EDSM or Spansh used to show nothing unless you then pressed a "Search:
 * EDSM / Spansh" button, and choosing a hit showed "no data" unless you pressed a "Load bodies"
 * button too. Now a name of three letters or more is looked up on Spansh by itself, the hits join
 * the dropdown — nothing is opened until you pick one — and picking a system the journals do not know
 * fetches its bodies from Spansh (see `server/remoteSystems.ts`). When a name cannot be found, the
 * list says so and says where it looked.
 */
/** One empty list, so a snapshot without systems does not bust the memos below on every render. */
const NO_SYSTEMS: JournalSystemInfo[] = [];

const SEARCH_FIELDS = ["journalSystems", "bodies", "journalBoot", "remoteView", "viewingSystemAddress"] as const;

/** Re-rendered when the systems or the viewed system change, not on every push (snapSlice.ts). */
export const JournalSystemSearch = memoOnSnapSlice(SEARCH_FIELDS, function JournalSystemSearch({
  snap,
  onGoToBioBody,
}: {
  snap: SnapSlice<(typeof SEARCH_FIELDS)[number]>;
  onGoToBioBody?: (bodyKey: string) => void;
}) {
  const toast = useToast();
  const systems: JournalSystemInfo[] = snap.journalSystems ?? NO_SYSTEMS;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<{
    q: string;
    busy: boolean;
    hits: JournalSystemInfo[];
    error: string | null;
  }>({ q: "", busy: false, hits: [], error: null });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** A pasted body name: its tab opens once the chosen system's bodies are in. */
  const [pendingBody, setPendingBody] = useState<{ name: string; at: number } | null>(null);

  const journalLoading = snap.journalBoot != null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const el = wrapRef.current;
      if (el && ev.target instanceof Node && !el.contains(ev.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const typed = query.trim();
  const q = typed.toLowerCase();
  // Memoised on the list and the query (UI review P3): the header re-renders on every push, and this
  // walked every system the commander has visited each time.
  const filtered = useMemo(
    () =>
      q === ""
        ? systems
        : ownerFirst(
            systems.filter(
              (s) =>
                s.starSystem.toLowerCase().includes(q) ||
                String(s.systemAddress).includes(q) ||
                bodyPartOfQuery(typed, s.starSystem) !== null,
            ),
            typed,
          ),
    [systems, q, typed],
  );

  useEffect(() => {
    if (!pendingBody) return;
    if (Date.now() - pendingBody.at > 30_000) {
      setPendingBody(null);
      return;
    }
    const want = pendingBody.name.toLowerCase();
    const hit = (snap.bodies ?? []).find((b) => b.state.bodyName.trim().toLowerCase() === want);
    if (hit) {
      onGoToBioBody?.(hit.state.key);
      setPendingBody(null);
    }
  }, [pendingBody, snap.bodies, onGoToBioBody]);

  // Spansh, by itself, a moment after the typing or the paste stops.
  useEffect(() => {
    if (!open || journalLoading || typed.length < 3) {
      setRemote((r) => (r.q === "" && !r.busy ? r : { q: "", busy: false, hits: [], error: null }));
      return;
    }
    let live = true;
    setRemote({ q: typed, busy: true, hits: [], error: null });
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await fetch(`/api/system/spansh-search?q=${encodeURIComponent(typed)}`);
          const j = (await r.json().catch(() => null)) as {
            systems?: JournalSystemInfo[];
            error?: string;
          } | null;
          if (!r.ok) throw new Error(j?.error || r.statusText);
          if (live) setRemote({ q: typed, busy: false, hits: j?.systems ?? [], error: null });
        } catch (e) {
          if (live) {
            setRemote({ q: typed, busy: false, hits: [], error: e instanceof Error ? e.message : String(e) });
          }
        }
      })();
    }, 450);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [typed, open, journalLoading]);

  // Anything the journals know is never offered again as a Spansh hit, matched or not.
  const journalAddrs = useMemo(() => new Set(systems.map((s) => s.systemAddress)), [systems]);
  const spanshHits = ownerFirst(
    remote.hits.filter((s) => !journalAddrs.has(s.systemAddress)),
    typed,
  );
  const searched = remote.q === typed && typed.length >= 3;

  const applyView = (systemAddress: number | null, meta?: { starSystem?: string }) => {
    const bodyPart = meta?.starSystem ? bodyPartOfQuery(typed, meta.starSystem) : null;
    setPendingBody(bodyPart ? { name: typed, at: Date.now() } : null);
    void (async () => {
      try {
        const payload: { systemAddress: number | null; starSystem?: string } = {
          systemAddress,
        };
        if (
          systemAddress != null &&
          typeof meta?.starSystem === "string" &&
          meta.starSystem.trim().length > 0
        ) {
          payload.starSystem = meta.starSystem.trim();
        }
        const r = await fetch("/api/ui/view-system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not change system view.");
      }
    })();
    setQuery("");
    setOpen(false);
  };

  const rv = snap.remoteView ?? null;

  return (
    <div className="journal-system-search" ref={wrapRef}>
      <input
        type="search"
        className="journal-system-search-input"
        autoComplete="off"
        placeholder={journalLoading ? "Loading journals…" : "Search or paste a system name…"}
        value={query}
        disabled={journalLoading}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => !journalLoading && setOpen(true)}
        aria-label="Search systems in your journals and on Spansh"
        aria-expanded={open}
        aria-controls="journal-system-search-results"
      />
      {(snap.viewingSystemAddress != null || rv) && !journalLoading ? (
        <div className="journal-system-view-actions">
          {snap.viewingSystemAddress != null ? (
            <button
              type="button"
              className="journal-system-follow-btn"
              title="Leave journal lookup and return to the commander’s live system"
              onClick={() => applyView(null)}
            >
              Return to commander
            </button>
          ) : null}
          {/* A looked-up system: say where its bodies came from, or why there are none. */}
          {rv?.state === "loading" ? (
            <span className="journal-system-remote dim">
              <InlineSpinner /> Fetching {rv.starSystem} from Spansh…
            </span>
          ) : rv?.state === "error" ? (
            <span className="journal-system-remote journal-system-remote--error">
              {rv.starSystem}: {rv.error ?? "could not be fetched."}
            </span>
          ) : rv?.state === "ready" ? (
            <Tooltip text="Not from your journals: bodies, signals and logged species from Spansh, kept 30 days. Species other commanders logged are marked; the rest is the app’s prediction.">
              <span className="journal-system-remote dim">
                From Spansh · {rv.bioBodyCount ?? 0} bio {(rv.bioBodyCount ?? 0) === 1 ? "body" : "bodies"} of{" "}
                {rv.bodyCount ?? 0}
                {rv.fetchedAt ? ` · fetched ${rv.fetchedAt.slice(0, 10)}` : ""}
              </span>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
      {open && !journalLoading ? (
        <ul
          className="journal-system-search-results"
          id="journal-system-search-results"
          role="listbox"
          aria-label="Matching systems"
        >
          {filtered.slice(0, 50).map((s) => (
            <li key={s.systemAddress}>
              <button
                type="button"
                className="journal-system-search-row"
                role="option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyView(s.systemAddress, { starSystem: s.starSystem })}
              >
                <span className="journal-system-search-name">{s.starSystem}</span>
                {bodyPartOfQuery(typed, s.starSystem) ? (
                  <span className="journal-system-search-body">→ {bodyPartOfQuery(typed, s.starSystem)}</span>
                ) : null}
                <span className="journal-system-search-addr dim tab">{s.systemAddress}</span>
              </button>
              <CopySystemButton system={s.starSystem} />
            </li>
          ))}
          {spanshHits.map((s) => (
            <li key={`spansh-${s.systemAddress}`}>
              <button
                type="button"
                className="journal-system-search-row journal-system-search-row--edsm"
                role="option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyView(s.systemAddress, { starSystem: s.starSystem })}
              >
                <span className="journal-system-search-name">{s.starSystem}</span>
                {bodyPartOfQuery(typed, s.starSystem) ? (
                  <span className="journal-system-search-body">→ {bodyPartOfQuery(typed, s.starSystem)}</span>
                ) : null}
                <span className="journal-system-search-addr dim tab">{s.systemAddress}</span>
                <span className="journal-system-search-edsm-badge dim">Spansh</span>
              </button>
              <CopySystemButton system={s.starSystem} />
            </li>
          ))}
          {typed.length >= 3 && (remote.busy || !searched) ? (
            <li className="journal-system-search-empty dim">
              <InlineSpinner /> Searching Spansh…
            </li>
          ) : null}
          {searched && !remote.busy && remote.error ? (
            <li className="journal-system-search-empty">
              Spansh could not be searched ({remote.error}).
              {filtered.length === 0 ? ` “${typed}” is not in your journals.` : ""}
            </li>
          ) : null}
          {searched && !remote.busy && !remote.error && filtered.length === 0 && spanshHits.length === 0 ? (
            <li className="journal-system-search-empty dim">
              “{typed}” is not in your journals or on Spansh.
            </li>
          ) : null}
          {typed.length > 0 && typed.length < 3 && filtered.length === 0 ? (
            <li className="journal-system-search-empty dim">
              Not in your journals — type 3 letters or more to search Spansh.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
});
