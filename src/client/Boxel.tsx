/**
 * Boxels (shared/boxel.ts; guild tester report, 2026-09-30; owner's redo, 2026-10-05: "I tried using
 * it and it isn't easy, reliable and functional" — plan in docs/plan-05102026-boxels.md).
 *
 * A full-window screen laid out like My discoveries: a side menu of every saved boxel (a search over
 * them, a tick per boxel = "in the table"), and one table of every system of every ticked boxel, -0 up
 * to its end — which you have flown, what the galaxy index has there, and the next one to fly.
 *
 * Current boxel saves the boxel you are in (to the last system number typed, else to the highest one
 * anyone knows) and ticks it. Skip and the cut (×) on a row correct a saved boxel, as before; the table
 * and the side menu re-read the journals after every jump, so the ticks follow you.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoxelTableDTO, BoxelTableRowDTO, PreviousBoxelDTO, SavedBoxelDTO } from "@shared/boxel";
import type { BoxelLookupStatus } from "@shared/boxel";
import { parseBoxel } from "@shared/boxel";
import { useModal } from "./ui/useModal";
import { CopySystemButton } from "./CopySystemButton";
import { useToast } from "./ui/feedback";
import { isBool, isNum, isStrArr, oneOf, usePersistedState } from "./usePersistedState";
import { Table, type Column } from "./DiscoveriesTables";
import { fuzzyRankAny } from "./fuzzyMatch";
import { NOTABLE_KINDS, type NotableKind } from "@shared/notices";
import { Select } from "./ui/Select";
import { BoxelLookingFor, BoxelMassCodeHelp, GoldenTag } from "./BoxelAdvice";
import { Tooltip } from "./ui/Tooltip";
import { LoadingNote, RefreshBar } from "./ui/Loading";
import { STAR_CLASSES } from "@shared/galaxyTraits";
import {
  BOXEL_FILTER_KINDS,
  boxelFilterSuggestions,
  boxelRowFilter,
  NOTABLE_SHORT,
  type BoxelFilterKind,
} from "./boxelFilter";

const NOTABLE_LABEL = Object.fromEntries(NOTABLE_KINDS.map((k) => [k.key, k.label])) as Record<
  NotableKind,
  string
>;

const FROM_TITLE = {
  index: "From the galaxy index (EDSM / Spansh records)",
  lookup: "From Spansh (Look up)",
  route: "From a route you plotted or a system you targeted in the galaxy map: the main star's class only",
} as const;

/** A fact from the galaxy index or a Spansh look-up (not your own scan) reads dimmer, and says so on hover. */
function fromIndex(r: BoxelTableRowDTO, text: string) {
  return r.from === "index" || r.from === "lookup" || r.from === "route" ? (
    <span className="boxel-from-index" title={FROM_TITLE[r.from]}>
      {text}
    </span>
  ) : (
    <span>{text}</span>
  );
}

/** Previous boxels drawn at once: a long log holds thousands. */
const PREV_PAGE = 60;
const PREV_RANGES: { days: number; label: string }[] = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "365d" },
  { days: 0, label: "All" },
];
const STAR_LABEL = Object.fromEntries(STAR_CLASSES.map((c) => [c.key, c.label])) as Record<string, string>;

/** True while the window is at most `px` wide. */
function useNarrow(px: number): boolean {
  const query = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

type SideTab = "saved" | "explored" | "history";

/** Other stars listed in a row before "+N more". */
const OTHER_STARS_SHOWN = 2;

const isIncluded = (v: unknown): v is string[] | null => v === null || isStrArr(v);
const json = { "Content-Type": "application/json" };

export function BoxelScreen({
  onClose,
  currentSystem,
  dScan = null,
  revision = 0,
  copied: lastCopied = null,
}: {
  onClose: () => void;
  currentSystem: string | null;
  /** The main screen's D-Scan line: the system on screen shows exactly these figures. */
  dScan?: { systemName: string; found: number; total: number } | null;
  /** Snapshot `boxelsRevision`: a route, a target, a run or a copy changed what the lists show. */
  revision?: number;
  /** What a jump or a boxel key last put on the clipboard. */
  copied?: { name: string; at: string; run: boolean } | null;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const toast = useToast();
  const here = currentSystem ? parseBoxel(currentSystem) : null;

  const [saved, setSaved] = useState<SavedBoxelDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** "Copy after each jump" (server/savedBoxels.ts); null until the list has been read. */
  const [autoCopy, setAutoCopy] = useState<boolean | null>(null);
  /** The probe text just copied, for the chip's "copied" look. */
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  const copyText = (text: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(text),
      () => setCopied(null),
    );
  /** The ticked boxels; null until he ticks anything (then: the current boxel, else the newest). */
  const [included, setIncluded] = usePersistedState<string[] | null>("boxel.included", null, isIncluded);
  const [sideQuery, setSideQuery] = useState("");
  const [endInput, setEndInput] = useState("");
  const [planInput, setPlanInput] = useState("");
  /*
    The side menu's three lists (owner, 2026-10-05: "Sidebar can get quite large … a button switch
    between saved, fully explored and history on the top").
  */
  const [sideTab, setSideTab] = usePersistedState<SideTab>(
    "boxel.sideTab",
    "saved",
    oneOf("saved", "explored", "history"),
  );
  const showPrevious = sideTab === "history";
  // The side menu folds away to the left (owner, 2026-10-05: "< and > arrows … animated drawer").
  const [sideOpen, setSideOpen] = usePersistedState("boxel.sideOpen", true, isBool);
  // The [?] beside the close button: the mass code tables (owner, 2026-10-05).
  const [helpOpen, setHelpOpen] = usePersistedState("boxel.helpOpen", false, isBool);
  const [prevDays, setPrevDays] = usePersistedState("boxel.previousDays", 30, isNum);
  const [previous, setPrevious] = useState<PreviousBoxelDTO[] | null>(null);
  /** History's total for the range and search, and whether a page is on its way. */
  const [prevTotal, setPrevTotal] = useState<number | null>(null);
  const [prevLoading, setPrevLoading] = useState(false);
  const prevGen = useRef(0);
  const prevMore = useRef<HTMLDivElement | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** The saved boxel whose Find end tools (Copy prefix, Probe, Not there) are open. */
  const [findEndId, setFindEndId] = useState<string | null>(null);
  const [lookup, setLookup] = useState<BoxelLookupStatus | null>(null);
  const [cutAsk, setCutAsk] = useState<{ id: string; n: number } | null>(null);
  const [table, setTable] = useState<BoxelTableDTO | null>(null);
  // The boxels the table on screen belongs to: other boxels ticked, it is old until theirs lands.
  const [tableFor, setTableFor] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "n", dir: 1 });
  const [filterKind, setFilterKind] = usePersistedState<BoxelFilterKind>(
    "boxel.filterKind",
    "body",
    oneOf("system", "body", "star", "species"),
  );
  const [filterQuery, setFilterQuery] = useState("");
  const [notFlownOnly, setNotFlownOnly] = usePersistedState("boxel.notFlownOnly", false, isBool);

  const call = useCallback(async (init?: RequestInit, path = "/api/boxels") => {
    try {
      const r = await fetch(path, init);
      const j = (await r.json()) as {
        items?: SavedBoxelDTO[];
        id?: string;
        error?: string;
        autoCopyNext?: boolean;
      };
      if (j.items) setSaved(j.items);
      if (typeof j.autoCopyNext === "boolean") setAutoCopy(j.autoCopyNext);
      setError(r.ok ? null : (j.error ?? r.statusText));
      return r.ok ? j : null;
    } catch {
      setError("The app's server could not be reached.");
      return null;
    }
  }, []);

  // After every jump, route, target, copy or run change: the side menu and the table read again.
  useEffect(() => void call(), [currentSystem, revision, call]);

  const ids = useMemo(() => {
    if (!saved) return [];
    const known = new Set(saved.map((b) => b.id));
    if (included) return included.filter((id) => known.has(id));
    const first = saved.find((b) => b.current) ?? saved[0];
    return first ? [first.id] : [];
  }, [saved, included]);
  const idsKey = ids.join(",");

  const idsNow = useRef(idsKey);
  idsNow.current = idsKey;
  const loadTable = useCallback(() => {
    if (!idsKey) {
      setTable(null);
      setTableFor("");
      return;
    }
    void fetch(`/api/boxels/table?ids=${encodeURIComponent(idsKey)}`)
      .then(async (r) => {
        const j = (await r.json()) as BoxelTableDTO & { error?: string };
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        // A slow answer for boxels no longer ticked must not replace the newer one.
        if (idsKey !== idsNow.current) return;
        setTable(j);
        setTableFor(idsKey);
      })
      .catch((e: unknown) => {
        if (idsKey !== idsNow.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setTableFor(idsKey);
      });
  }, [idsKey]);
  // Other boxels ticked and theirs not in yet (a re-read after a jump keeps the same boxels: no sign).
  const tableStale = !!table && tableFor !== idsKey;

  useEffect(loadTable, [loadTable, saved]);
  // Every scan on the main screen re-reads the table (notables, biology) and the side menu's counts.
  const scanKey = dScan ? `${dScan.systemName}|${dScan.found}|${dScan.total}` : "";
  const firstScan = useRef(true);
  useEffect(() => {
    if (firstScan.current) {
      firstScan.current = false;
      return;
    }
    void call();
  }, [scanKey, call]);

  /*
    Look up (plan Q1): the boxel's systems from Spansh, pages five seconds apart. Polled while it
    runs; the table is read again as it goes and when it ends.
  */
  const lookupCall = useCallback(async (init?: RequestInit, path = "/api/boxels/lookup") => {
    try {
      const r = await fetch(path, init);
      const j = (await r.json()) as { status?: BoxelLookupStatus | null; error?: string };
      setLookup(j.status ?? null);
      if (!r.ok && j.error) setError(j.error);
    } catch {
      /* the next poll */
    }
  }, []);
  useEffect(() => void lookupCall(), [lookupCall]);
  const running = !!lookup?.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      void lookupCall();
      loadTable();
    }, 2_500);
    return () => {
      clearInterval(t);
      // The side menu too: a look-up that found systems past the end has extended the boxel.
      void call();
      loadTable();
    };
  }, [running, lookupCall, loadTable, call]);
  const lookUpBoxel = (b: SavedBoxelDTO) =>
    void lookupCall({ method: "POST" }, `/api/boxels/${encodeURIComponent(b.id)}/lookup`);

  const tick = (id: string, on: boolean) => {
    const set = new Set(ids);
    if (on) set.add(id);
    else set.delete(id);
    setIncluded([...set]);
  };
  const only = (id: string) => setIncluded([id]);

  /*
    Save a boxel by any of its systems, flown or not (Current boxel: the one you are in; Plan: a name
    typed — the name alone says the boxel, owner 2026-10-05), to the last number typed or else the
    highest one recorded, and tick it.
  */
  const addBoxel = (system: string) => {
    const end = endInput.trim();
    void call({
      method: "POST",
      headers: json,
      body: JSON.stringify({ system, end: end === "" ? null : Number(end) }),
    }).then((j) => {
      if (!j?.id) return;
      setEndInput("");
      setPlanInput("");
      if (!ids.includes(j.id)) setIncluded([j.id, ...ids]);
    });
  };
  const addCurrent = () => {
    if (currentSystem && here) addBoxel(currentSystem);
  };
  const plan = parseBoxel(planInput);
  /** The saved boxel the Last system # field would change: the one typed in Plan, else the current one. */
  const endShownFor = (() => {
    const b = plan ?? here;
    return b ? ((saved ?? []).find((x) => x.prefix.toLowerCase() === b.prefix.toLowerCase()) ?? null) : null;
  })();

  /*
    History (owner, 2026-10-05; paged 2026-10-06: "go through the journal log from newest to oldest …
    a loading circle appears and moves down as older systems are loaded"): every boxel flown through,
    newest first, a page at a time — the first when the tab opens (and after each jump, save or search),
    the next when the list is scrolled to its end. The search runs on the server, over all of them.
  */
  const prevQuery = showPrevious ? sideQuery.trim() : "";
  const loadPrevious = useCallback(
    (reset: boolean) => {
      const gen = reset ? ++prevGen.current : prevGen.current;
      const offset = reset ? 0 : (previousRef.current?.length ?? 0);
      setPrevLoading(true);
      const q = new URLSearchParams({
        days: String(prevDays),
        offset: String(offset),
        limit: String(PREV_PAGE),
      });
      if (prevQuery) q.set("q", prevQuery);
      void fetch(`/api/boxels/previous?${q}`)
        .then((r) => r.json() as Promise<{ items?: PreviousBoxelDTO[]; total?: number }>)
        .then((j) => {
          if (gen !== prevGen.current) return;
          setPrevious((had) => [...(reset ? [] : (had ?? [])), ...(j.items ?? [])]);
          setPrevTotal(j.total ?? null);
        })
        .catch(() => gen === prevGen.current && reset && setPrevious([]))
        .finally(() => gen === prevGen.current && setPrevLoading(false));
    },
    [prevDays, prevQuery],
  );
  const previousRef = useRef<PreviousBoxelDTO[] | null>(null);
  previousRef.current = previous;
  useEffect(() => {
    if (!showPrevious) return;
    const t = window.setTimeout(() => loadPrevious(true), prevQuery ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [showPrevious, loadPrevious, prevQuery, saved, currentSystem]);
  // The end of the list in view: the next page.
  const prevHasMore = previous != null && prevTotal != null && previous.length < prevTotal;
  useEffect(() => {
    const el = prevMore.current;
    if (!el || !prevHasMore || prevLoading) return;
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) loadPrevious(false);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [prevHasMore, prevLoading, loadPrevious, previous]);
  const keep = (p: PreviousBoxelDTO) =>
    void call({
      method: "POST",
      headers: json,
      body: JSON.stringify({ system: p.lastSystem, end: null }),
    }).then((j) => {
      if (j?.id && !ids.includes(j.id)) setIncluded([j.id, ...ids]);
    });

  const patch = (id: string, body: Record<string, unknown>) =>
    call(
      { method: "PATCH", headers: json, body: JSON.stringify(body) },
      `/api/boxels/${encodeURIComponent(id)}`,
    );
  const extendTo = (b: SavedBoxelDTO, n: number) =>
    void call({ method: "POST", headers: json, body: JSON.stringify({ lastSystem: `${b.prefix}${n}` }) });
  const remove = (id: string) => {
    setConfirmId(null);
    void call({ method: "DELETE" }, `/api/boxels/${encodeURIComponent(id)}`).then(() =>
      setIncluded(ids.filter((x) => x !== id)),
    );
  };

  /*
    Open (owner, 2026-10-05): a system you flew opens in EDEXO from your journals; one you did not is
    looked up on Spansh (keyless and unthrottled, where EDSM allows about 360 requests an hour) and
    shown the same way — by the id64 a Look up kept, else by a name search.
  */
  const view = async (systemAddress: number, starSystem: string) => {
    await fetch("/api/ui/view-system", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ systemAddress, starSystem }),
    });
    onClose();
  };
  const openRow = (r: BoxelTableRowDTO) => {
    if (r.systemAddress != null)
      void view(r.systemAddress, r.name).catch(() => toast.error("The app's server could not be reached."));
    else void open(r.name);
  };
  const open = async (system: string) => {
    try {
      const r = await fetch(`/api/system/spansh-search?q=${encodeURIComponent(system)}`);
      const j = (await r.json()) as { systems?: { systemAddress: number; starSystem: string }[] };
      const hit = (j.systems ?? []).find((s) => s.starSystem.toLowerCase() === system.toLowerCase());
      if (!hit) {
        toast.error(`${system}: nobody has logged it on Spansh yet — it may be undiscovered.`);
        return;
      }
      await view(hit.systemAddress, hit.starSystem);
    } catch {
      toast.error("Spansh could not be reached.");
    }
  };

  const byId = useMemo(() => new Map((saved ?? []).map((b) => [b.id, b])), [saved]);
  const looked = useMemo(() => new Map((table?.lookups ?? []).map((l) => [l.boxelId, l])), [table]);
  /*
    The highest system flown per boxel: a cut (×) is offered only after it, since the boxel always
    lists as far as he has flown (owner, 2026-10-05).
  */
  const flownMax = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of table?.rows ?? []) if (r.flown) m.set(r.boxelId, Math.max(m.get(r.boxelId) ?? -1, r.n));
    return m;
  }, [table]);
  const order = useMemo(() => new Map(ids.map((id, i) => [id, i])), [ids]);
  const columns = useMemo<Column<BoxelTableRowDTO>[]>(
    () => [
      {
        key: "n",
        label: "#",
        numeric: true,
        title: "The system's number in its boxel (rows of several boxels stay grouped by boxel)",
        value: (r) => (order.get(r.boxelId) ?? 0) * 1e5 + r.n,
        render: (r) => <span className="dim">{r.n}</span>,
      },
      {
        key: "sys",
        label: "System",
        value: (r) => r.name,
        render: (r) => (
          <span className="boxel-sys">
            {r.name}
            <CopySystemButton system={r.name} />
          </span>
        ),
      },
      {
        key: "flown",
        label: "Flown",
        title: "Flown (when you were last there), skipped, or not yet",
        value: (r) => (r.flown ? `2${r.visitedAt ?? ""}` : r.skipped ? "1" : null),
        render: (r) =>
          r.flown ? (
            <span
              className="fdb-dss"
              title={r.visitedAt ? `Last there ${r.visitedAt.slice(0, 16).replace("T", " ")}` : undefined}
            >
              ✓ {r.visitedAt ? r.visitedAt.slice(0, 10) : "flown"}
            </span>
          ) : r.skipped ? (
            <span className="boxel-skipped">skipped</span>
          ) : r.onRoute ? (
            <span
              className="dim"
              title="Not flown yet: a route you plotted passes through it, or you targeted it in the galaxy map, so it exists"
            >
              on route
            </span>
          ) : r.gap ? (
            <span
              className="dim"
              title="Not recorded anywhere, but a higher system of this boxel is known: systems are numbered without gaps (mass codes a–g), so it exists"
            >
              exists
            </span>
          ) : (
            <span className="dim">—</span>
          ),
      },
      {
        key: "main",
        label: "Main star",
        title:
          "Flown: the arrival star as you scanned it. Not flown: its class in the galaxy index (no luminosity)",
        value: (r) => r.mainStar,
        render: (r) =>
          r.notOnSpansh && !r.from ? (
            <span
              className="dim"
              title="Looked up: Spansh has no record of it — undiscovered, as far as anyone uploaded"
            >
              not on Spansh
            </span>
          ) : (
            fromIndex(r, r.mainStar ?? "—")
          ),
      },
      {
        key: "stars",
        label: "Other stars",
        value: (r) => (r.from ? r.otherStars.length : null),
        // Two, then "+3 more" with the rest on hover (owner, 2026-10-05: the field had no limit).
        render: (r) =>
          r.otherStars.length ? (
            <span className="boxel-stars">
              {fromIndex(r, r.otherStars.slice(0, OTHER_STARS_SHOWN).join(", "))}
              {r.otherStars.length > OTHER_STARS_SHOWN ? (
                <Tooltip
                  text={r.otherStars.slice(OTHER_STARS_SHOWN).join(", ")}
                  className="boxel-stars__more"
                >
                  <span tabIndex={0}>+{r.otherStars.length - OTHER_STARS_SHOWN} more</span>
                </Tooltip>
              ) : null}
            </span>
          ) : (
            <span className="dim">—</span>
          ),
      },
      {
        key: "bodies",
        label: "Bodies",
        numeric: true,
        title:
          "Flown: bodies you scanned, of the count the FSS gave. Not flown: the bodies the galaxy index knows",
        value: (r) => r.bodies?.total ?? r.bodies?.scanned ?? null,
        render: (r) =>
          !r.bodies ? (
            <span className="dim">—</span>
          ) : r.bodies.scanned == null ? (
            fromIndex(r, String(r.bodies.total ?? "—"))
          ) : (
            <span
              className={r.bodies.total != null && r.bodies.scanned >= r.bodies.total ? "fdb-dss" : undefined}
            >
              {r.bodies.scanned}
              {r.bodies.total != null ? `/${r.bodies.total}` : ""}
            </span>
          ),
      },
      {
        key: "notable",
        label: "Notable",
        title:
          "Earth-like, water and ammonia worlds, other terraformables, Helium gas giants (the exact class) and green gas giants. Green and Helium gas giants only from your journals: the galaxy index has no gas giants of those classes",
        value: (r) => (r.notables.length ? r.notables.reduce((t, x) => t + (x.n ?? 1), 0) : null),
        render: (r) =>
          r.notables.length ? (
            <span
              className={`boxel-notables${r.from === "index" || r.from === "lookup" ? " boxel-from-index" : ""}`}
            >
              {r.notables.map((x) => (
                <span key={x.kind} className="boxel-notable" title={NOTABLE_LABEL[x.kind]}>
                  {NOTABLE_SHORT[x.kind]}
                  {x.n != null && x.n > 1 ? ` ×${x.n}` : ""}
                </span>
              ))}
            </span>
          ) : (
            <span className="dim">—</span>
          ),
      },
      {
        key: "bio",
        label: "Biology",
        title:
          "Flown: biology signals you saw and the species you logged, with what EDSM and Spansh recorded. Not flown: the galaxy index's records",
        value: (r) => (r.bio ? r.bio.species.length * 1000 + (r.bio.signals ?? (r.bio.seen ? 1 : 0)) : null),
        render: (r) => {
          if (!r.bio) return <span className="dim">—</span>;
          const signals = r.bio.signals ? `${r.bio.signals} signal${r.bio.signals === 1 ? "" : "s"}` : "";
          if (r.bio.species.length)
            return (
              <span className="boxel-bio">
                {signals ? <span className="dim">{signals}: </span> : null}
                {r.bio.species.join(", ")}
              </span>
            );
          return (
            <span className="dim">
              {signals || (r.bio.seen ? "signals, species not logged" : "none recorded")}
            </span>
          );
        },
      },
      {
        key: "act",
        label: "",
        value: () => null,
        render: (r) => {
          const b = byId.get(r.boxelId);
          return (
            <span className="boxel-row__actions">
              <button
                type="button"
                className="fdb-chip"
                title={
                  r.flown
                    ? "Open it in EDEXO, from your journals"
                    : "Look it up on Spansh and open it in EDEXO"
                }
                onClick={() => openRow(r)}
              >
                {r.flown ? "Open" : "Spansh"}
              </button>
              {b && !r.flown ? (
                <button
                  type="button"
                  className={`fdb-chip${r.skipped ? " fdb-chip--on" : ""}`}
                  aria-pressed={r.skipped}
                  title="Skipped: not flown, but it counts as done for this boxel"
                  onClick={() => void patch(b.id, { skip: r.n, on: !r.skipped })}
                >
                  {r.skipped ? "Unskip" : "Skip"}
                </button>
              ) : null}
              {b && r.n >= 1 && r.n > (flownMax.get(b.id) ?? -1) ? (
                <button
                  type="button"
                  className="fdb-chip boxel-x"
                  aria-label={`Delete -${r.n} and every system after it`}
                  title="Delete this system and every one after it (a last number typed too high)"
                  onClick={() => setCutAsk({ id: b.id, n: r.n })}
                >
                  ×
                </button>
              ) : null}
            </span>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byId, order, flownMax],
  );
  // A phone gets cards, titled by the system (owner, 2026-10-05: the redo works on a phone too).
  const narrow = useNarrow(760);
  const shownColumns = useMemo(
    () => (narrow ? [columns[1]!, columns[0]!, ...columns.slice(2)] : columns),
    [narrow, columns],
  );

  // Searched on the server (it searches every boxel, not only the pages read so far).
  const prevShown = previous ?? [];
  const sideShown = useMemo(() => {
    const q = sideQuery.trim();
    const mine = (saved ?? []).filter((b) => (sideTab === "explored") === (b.next == null));
    if (!q) return mine;
    return mine.filter((b) => fuzzyRankAny([b.boxel, b.sector, b.lastSystem], q) != null);
  }, [saved, sideQuery, sideTab]);
  const exploredCount = (saved ?? []).filter((b) => b.next == null).length;

  const ticked = ids.map((id) => byId.get(id)).filter((b): b is SavedBoxelDTO => !!b);
  const lead = ticked.find((b) => b.current) ?? ticked[0] ?? null;
  /*
    The system on the main screen reads its D-Scan line as it stands (owner, 2026-10-05: "it stays at
    5/24 … it should get the same data as the main screen"): the server has no system map for it.
  */
  /*
    By its figures, not the object: every snapshot (about once a second) brings a new dScan object, and
    keyed on that the whole table was rebuilt, filtered, sorted and drawn again each time — a quarter
    of a second for one 1,867-system boxel, the "unresponsive" Boxels screen (owner, 2026-10-06).
  */
  const dScanName = dScan?.systemName.toLowerCase() ?? null;
  const dScanFound = dScan?.found ?? 0;
  const dScanTotal = dScan?.total ?? 0;
  const allRows = useMemo(() => {
    const rows = table?.rows ?? [];
    if (dScanName == null) return rows;
    return rows.map((r) =>
      r.flown && r.name.toLowerCase() === dScanName
        ? { ...r, bodies: { scanned: dScanFound, total: dScanTotal } }
        : r,
    );
  }, [table, dScanName, dScanFound, dScanTotal]);
  const rows = useMemo(() => {
    const keep = boxelRowFilter(filterKind, filterQuery);
    return allRows.filter((r) => keep(r) && (!notFlownOnly || (!r.flown && !r.skipped)));
  }, [allRows, filterKind, filterQuery, notFlownOnly]);
  const suggestions = useMemo(() => boxelFilterSuggestions(filterKind, allRows), [filterKind, allRows]);
  /*
    The same element while its inputs stand, so a snapshot that changes nothing in the table (one comes
    about every second in game) does not draw its rows again (owner, 2026-10-06).
  */
  const emptyText = table ? (allRows.length ? "No systems match." : "No systems.") : "Reading…";
  const tableEl = useMemo(
    () => (
      <Table
        rows={rows}
        columns={shownColumns}
        layout={narrow ? "cards" : "list"}
        sort={sort}
        onSort={(key) =>
          setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
        }
        rowKey={(r) => `${r.boxelId}:${r.n}`}
        csvName="boxels"
        empty={emptyText}
        resetKey={`${idsKey}|${filterKind}|${filterQuery}|${notFlownOnly}`}
      />
    ),
    [rows, shownColumns, narrow, sort, emptyText, idsKey, filterKind, filterQuery, notFlownOnly],
  );
  const kindDef = BOXEL_FILTER_KINDS.find((k) => k.value === filterKind)!;

  return (
    // In the backdrop only so the header's own layout rule (`.top > :not(.modal-backdrop)`) leaves it be.
    <div className="modal-backdrop" role="presentation">
      <div ref={dialogRef} className="boxel-screen" role="dialog" aria-modal="true" aria-label="Boxels">
        <header className="modal-head boxel-screen__head">
          <h3 className="boxel-screen__title">Boxels</h3>
          <form
            className="boxel-current"
            onSubmit={(ev) => {
              ev.preventDefault();
              addCurrent();
            }}
          >
            <button
              type="submit"
              className="fdb-chip fdb-chip--on"
              disabled={!here}
              title={
                here
                  ? `Save ${here.boxel} in ${here.sector} and show it`
                  : "You are in a system with a catalogue name, which belongs to no boxel"
              }
            >
              Current boxel{here ? `: ${here.boxel}` : ""}
            </button>
            <span className="boxel-plan">
              <input
                className="carriers-search__input"
                value={planInput}
                placeholder="Plan: any system, e.g. Eol Prou AB-C d1-23"
                aria-label="Plan a boxel: any system name in it, flown or not"
                onChange={(ev) => setPlanInput(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key !== "Enter") return;
                  ev.preventDefault();
                  if (plan) addBoxel(planInput.trim());
                }}
              />
              <button
                type="button"
                className="fdb-chip fdb-chip--on"
                disabled={!plan}
                title={
                  plan
                    ? `Save ${plan.boxel} in ${plan.sector} and show it`
                    : "Type a system with a boxel name (sector, letters, mass code and number)"
                }
                onClick={() => addBoxel(planInput.trim())}
              >
                Plan{plan ? `: ${plan.boxel}` : ""}
              </button>
            </span>
            <label className="boxel-current__end">
              <span className="dim tiny">Last system #</span>
              <input
                className="carriers-search__input"
                inputMode="numeric"
                value={endInput}
                placeholder={endShownFor ? String(endShownFor.end) : "auto"}
                title="The boxel's last system number, if you know it (for Current boxel and Plan); empty: the highest one anyone has recorded"
                onChange={(ev) => setEndInput(ev.target.value.replace(/\D/g, ""))}
              />
            </label>
          </form>
          <button
            type="button"
            className={`fold-help-btn boxel-help-btn${helpOpen ? " fold-help-btn--on" : ""}`}
            onClick={() => setHelpOpen(!helpOpen)}
            aria-expanded={helpOpen}
            title={helpOpen ? "Hide the mass code tables" : "What do the mass codes hold?"}
          >
            ?
          </button>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {helpOpen ? <BoxelMassCodeHelp /> : null}
        <BoxelLookingFor here={here} onSave={addBoxel} />

        <div className={`boxel-screen__body${sideOpen ? "" : " boxel-screen__body--folded"}`}>
          <aside
            className="boxel-side"
            aria-label="Your boxels"
            inert={!sideOpen}
            // History's next page when scrolled near its end (the observer below does the same).
            onScroll={(ev) => {
              const el = ev.currentTarget;
              if (
                showPrevious &&
                prevHasMore &&
                !prevLoading &&
                el.scrollTop + el.clientHeight >= el.scrollHeight - 160
              )
                loadPrevious(false);
            }}
          >
            <div className="boxel-side__tabs" role="tablist" aria-label="Which boxels">
              {(
                [
                  ["saved", "Saved", saved ? saved.length - exploredCount : null],
                  ["explored", "Fully explored", saved ? exploredCount : null],
                  ["history", "History", showPrevious ? prevTotal : null],
                ] as const
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={sideTab === k}
                  className={`disc-tab${sideTab === k ? " disc-tab--on" : ""}`}
                  onClick={() => setSideTab(k)}
                >
                  {label}
                  {n != null ? <span className="dim tiny"> {n.toLocaleString()}</span> : null}
                </button>
              ))}
            </div>
            <input
              type="search"
              className="my-exo-search-input boxel-side__search"
              placeholder={showPrevious ? "Search the boxels you flew through…" : "Search your boxels…"}
              value={sideQuery}
              onChange={(ev) => setSideQuery(ev.target.value)}
            />
            {showPrevious ? null : !saved ? (
              <LoadingNote className="tiny" label="Reading…" />
            ) : saved.length === 0 ? (
              <p className="dim tiny">
                No boxels yet. Press <strong>Current boxel</strong> in a system such as Eol Prou AB-C d1-23.
              </p>
            ) : sideShown.length === 0 ? (
              <p className="dim tiny">
                {sideTab === "explored"
                  ? "None yet: a boxel moves here when every system is flown or skipped."
                  : sideQuery.trim()
                    ? "No saved boxel matches."
                    : "Every saved boxel is fully explored."}
              </p>
            ) : (
              <ul className="boxel-side__list">
                {sideShown.map((b) => {
                  const on = ids.includes(b.id);
                  const done = b.next == null;
                  return (
                    <li
                      key={b.id}
                      className={`boxel-side__item${on ? " boxel-side__item--on" : ""}${done ? " boxel-side__item--done" : ""}`}
                    >
                      <label className="boxel-side__tick">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(ev) => tick(b.id, ev.target.checked)}
                          aria-label={`Show ${b.boxel} in ${b.sector} in the table`}
                        />
                      </label>
                      <button
                        type="button"
                        className="boxel-side__name"
                        title="Show only this boxel"
                        onClick={() => only(b.id)}
                      >
                        <strong>{b.boxel}</strong> <span className="dim">{b.sector}</span>
                        {b.current ? <span className="boxel-side__here">you are here</span> : null}
                        {b.run ? (
                          <span
                            className="boxel-side__here"
                            title="Boxel run: after every jump its next system is on the clipboard (F7 finishes it)"
                          >
                            run
                          </span>
                        ) : null}
                        <GoldenTag boxel={b.boxel} />
                      </button>
                      <span
                        className="boxel-side__bar"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={b.total}
                        aria-valuenow={b.flown + b.skipped.length}
                        aria-label={`${b.flown} of ${b.total} flown`}
                      >
                        <span style={{ width: `${((b.flown + b.skipped.length) / b.total) * 100}%` }} />
                      </span>
                      <span className="boxel-side__count dim tiny">
                        {b.flown} / {b.total} flown
                        {b.skipped.length ? ` · ${b.skipped.length} skipped` : ""}
                        {" · "}
                        <span className={b.notable ? "boxel-notable" : undefined}>{b.notable} notable</span>
                      </span>
                      <span className="boxel-side__actions">
                        <button
                          type="button"
                          className="fdb-chip"
                          disabled={running}
                          title={
                            looked.get(b.id)
                              ? `Looked up on Spansh ${looked.get(b.id)!.fetchedAt.slice(0, 10)} (${looked.get(b.id)!.systems} systems): again`
                              : "Fill the systems you have not flown from Spansh: stars, every body, species logged (a few requests, five seconds apart)"
                          }
                          onClick={() => lookUpBoxel(b)}
                        >
                          {looked.get(b.id) ? "Look up again" : "Look up"}
                        </button>
                        {(looked.get(b.id)?.highest ?? -1) > b.end && !b.flownBeyond.length ? (
                          <button
                            type="button"
                            className="fdb-chip"
                            title={`Spansh lists systems up to -${looked.get(b.id)!.highest}: the boxel goes further than -${b.end}.`}
                            onClick={() => extendTo(b, looked.get(b.id)!.highest)}
                          >
                            Extend to -{looked.get(b.id)!.highest}
                          </button>
                        ) : null}
                        {b.flownBeyond.length ? (
                          <button
                            type="button"
                            className="fdb-chip"
                            title={`You have flown -${b.flownBeyond.join(", -")} too: the boxel goes further than -${b.end}.`}
                            onClick={() => extendTo(b, b.flownBeyond[b.flownBeyond.length - 1]!)}
                          >
                            Extend to -{b.flownBeyond[b.flownBeyond.length - 1]}
                          </button>
                        ) : null}
                        {/*
                          Finding the boxel's last system in the galaxy map (owner, 2026-10-06; ideas from
                          EDJP and SHBOXSEARCH): the prefix lists the boxel in one search, the probe is the
                          number after the end. Found: plot or target it and the boxel extends itself.
                          Not found: Not there, and the end is known.
                        */}
                        <button
                          type="button"
                          className={`fdb-chip${b.run ? " fdb-chip--on" : ""}`}
                          title={
                            b.run
                              ? "Finish the boxel run (F7 in the game)"
                              : "Start a boxel run here: after every jump its next system is on the clipboard, wherever you are (F7 in the game; F8 / F9 step through its systems)"
                          }
                          onClick={() => void patch(b.id, { run: !b.run })}
                        >
                          {b.run ? "Finish run" : "Start run"}
                        </button>
                        {/* One button for the three (owner, 2026-10-06: crowded); the end, once known. */}
                        {b.endKnown && !b.probe ? null : (
                          <button
                            type="button"
                            className={`fdb-chip${findEndId === b.id ? " fdb-chip--on" : ""}`}
                            aria-expanded={findEndId === b.id}
                            title="Find this boxel's last system in the galaxy map: copy its prefix or the next number, and mark it Not there when the map finds nothing"
                            onClick={() => setFindEndId(findEndId === b.id ? null : b.id)}
                          >
                            Find end {findEndId === b.id ? "▾" : "▸"}
                          </button>
                        )}
                        {findEndId === b.id ? (
                          <button
                            type="button"
                            className={`fdb-chip${copied === b.prefix ? " fdb-chip--on" : ""}`}
                            title={`Copies "${b.prefix}": paste it in the galaxy map's search to list the boxel's systems the game knows`}
                            onClick={() => copyText(b.prefix)}
                          >
                            {copied === b.prefix ? "Copied" : "Copy prefix"}
                          </button>
                        ) : null}
                        {findEndId === b.id && b.probe ? (
                          <>
                            <button
                              type="button"
                              className={`fdb-chip${copied === b.probe ? " fdb-chip--on" : ""}`}
                              title={`Copies ${b.probe}: search it in the galaxy map. Found: plot a route to it or target it, and the boxel extends itself. Not found: press Not there.`}
                              onClick={() => copyText(b.probe!)}
                            >
                              {copied === b.probe ? "Copied" : `Probe -${b.end + 1}`}
                            </button>
                            <button
                              type="button"
                              className="fdb-chip"
                              title={`The galaxy map did not find ${b.probe}: -${b.end} is this boxel's last system`}
                              onClick={() => void patch(b.id, { lastIs: b.end })}
                            >
                              Not there
                            </button>
                          </>
                        ) : b.endKnown ? (
                          <span
                            className="dim tiny"
                            title="You checked in the galaxy map that the next system does not exist"
                          >
                            ends at -{b.end}
                          </span>
                        ) : null}
                        {confirmId === b.id ? (
                          <>
                            <button type="button" className="fdb-chip boxel-del" onClick={() => remove(b.id)}>
                              Delete
                            </button>
                            <button type="button" className="fdb-chip" onClick={() => setConfirmId(null)}>
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="fdb-chip boxel-x"
                            aria-label={`Delete ${b.boxel} from your boxels`}
                            title="Delete from your boxels"
                            onClick={() => setConfirmId(b.id)}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <section className="boxel-prev" aria-label="Boxels you flew through">
              {showPrevious ? (
                <>
                  <div className="boxel-prev__range" role="group" aria-label="Last visit within">
                    {PREV_RANGES.map((r) => (
                      <button
                        key={r.days}
                        type="button"
                        className={`disc-chip${prevDays === r.days ? " disc-chip--on" : ""}`}
                        aria-pressed={prevDays === r.days}
                        onClick={() => setPrevDays(r.days)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  {!previous ? (
                    <p className="dim tiny">Reading your journals…</p>
                  ) : prevShown.length === 0 ? (
                    <p className="dim tiny">No boxels flown in that time.</p>
                  ) : (
                    <ul className="boxel-side__list">
                      {prevShown.map((p) => (
                        <li key={p.prefix} className="boxel-side__item boxel-prev__item">
                          <span className="boxel-prev__name">
                            <strong>{p.boxel}</strong> <span className="dim">{p.sector}</span>
                          </span>
                          <span className="boxel-side__count dim tiny">
                            {p.flown} flown, up to -{p.highest}
                            {p.lastVisit ? ` · last ${p.lastVisit.slice(0, 10)}` : ""}
                          </span>
                          {p.notables.length || p.rareStars.length || p.species.length ? (
                            <span className="boxel-notables boxel-prev__why">
                              {p.notables.map((x) => (
                                <span key={x.kind} className="boxel-notable" title={NOTABLE_LABEL[x.kind]}>
                                  {NOTABLE_SHORT[x.kind]}
                                  {x.n != null && x.n > 1 ? ` ×${x.n}` : ""}
                                </span>
                              ))}
                              {p.rareStars.map((k) => (
                                <span key={k} className="bm-tag" title={STAR_LABEL[k] ?? k}>
                                  {k}
                                </span>
                              ))}
                              {p.species.length ? (
                                <span className="dim" title={p.species.join(", ")}>
                                  {p.species.length} species
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                          <span className="boxel-side__actions">
                            {p.saved ? (
                              <span className="dim tiny">saved</span>
                            ) : (
                              <button
                                type="button"
                                className="fdb-chip"
                                title="Save it to your boxels, for a return"
                                onClick={() => keep(p)}
                              >
                                Keep
                              </button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {prevHasMore || prevLoading ? (
                    <div ref={prevMore} className="boxel-loading" role="status">
                      <span className="boxel-loading__spin" aria-hidden="true" /> Loading
                      {prevTotal != null && previous
                        ? ` · ${previous.length.toLocaleString()} of ${prevTotal.toLocaleString()}`
                        : ""}
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          </aside>
          <button
            type="button"
            className="boxel-drawer"
            aria-expanded={sideOpen}
            aria-label={sideOpen ? "Hide your boxels" : "Show your boxels"}
            title={sideOpen ? "Hide the side menu" : "Show the side menu"}
            onClick={() => setSideOpen(!sideOpen)}
          >
            <span aria-hidden>{sideOpen ? "‹" : "›"}</span>
          </button>

          <main className="boxel-main">
            {error ? <p className="fdb-empty">{error}</p> : null}
            {ticked.length ? (
              <div className="fdb-summary">
                <span>
                  <strong>{ticked.length === 1 ? ticked[0]!.boxel : `${ticked.length} boxels`}</strong>
                  {ticked.length === 1 ? ` in ${ticked[0]!.sector}` : ""}
                </span>
                <span>
                  <strong>{allRows.filter((r) => r.flown).length}</strong> of {allRows.length} flown
                </span>
                <span>
                  <strong>{allRows.filter((r) => r.from === "index").length}</strong> more in the galaxy index
                </span>
                {allRows.some((r) => r.from === "lookup") ? (
                  <span>
                    <strong>{allRows.filter((r) => r.from === "lookup").length}</strong> from Spansh
                  </span>
                ) : null}
                {allRows.some((r) => r.onRoute) ? (
                  <span title="Not flown: on a route you plotted, or targeted in the galaxy map">
                    <strong>{allRows.filter((r) => r.onRoute).length}</strong> on your routes
                  </span>
                ) : null}
                {allRows.some((r) => r.gap) ? (
                  <span title="Recorded nowhere, but a higher system of the boxel is known, so they exist (mass codes a–g number their systems without gaps)">
                    <strong>{allRows.filter((r) => r.gap).length}</strong> exist unrecorded
                  </span>
                ) : null}
                {lead?.next ? (
                  <span className="boxel-next">
                    <span className="dim">Next to fly </span>
                    <strong>{lead.next}</strong>
                    <CopySystemButton system={lead.next} />
                  </span>
                ) : null}
                {lastCopied ? (
                  <span
                    className="boxel-next"
                    title={`Put on the clipboard ${lastCopied.at.slice(11, 19)} by a jump or a boxel key (F6–F9)`}
                  >
                    <span className="dim">Copied </span>
                    <strong>{lastCopied.name}</strong>
                    {lastCopied.run ? <span className="boxel-side__here">run</span> : null}
                  </span>
                ) : null}
                {autoCopy != null ? (
                  <label
                    className="boxel-autocopy dim tiny"
                    title="Desktop app: after each jump into a saved boxel, the next system to fly is put on the clipboard, ready to paste in the galaxy map. F6 copies it again (Launcher → Key binds)."
                  >
                    <input
                      type="checkbox"
                      checked={autoCopy}
                      onChange={(ev) =>
                        void call(
                          {
                            method: "POST",
                            headers: json,
                            body: JSON.stringify({ autoCopyNext: ev.target.checked }),
                          },
                          "/api/boxels/options",
                        )
                      }
                    />{" "}
                    Copy after each jump
                  </label>
                ) : null}
              </div>
            ) : null}
            {lookup && (lookup.running || lookup.note) ? (
              <p className="boxel-lookup-status" role="status">
                {lookup.running ? (
                  <>
                    Looking up <strong>{lookup.boxel}</strong> on Spansh: {lookup.systems.toLocaleString()}{" "}
                    systems in {lookup.pages} page{lookup.pages === 1 ? "" : "s"}…{" "}
                    <button
                      type="button"
                      className="fdb-chip"
                      onClick={() => void lookupCall({ method: "DELETE" })}
                    >
                      Stop
                    </button>
                  </>
                ) : (
                  <span className="dim">
                    {lookup.boxel}: {lookup.note}
                  </span>
                )}
              </p>
            ) : null}
            {table?.common.length ? (
              <p className="boxel-common">
                <span className="dim">Recorded most: </span>
                {table.common.map((c) => (
                  <span key={c.name} className="bm-tag">
                    {c.name} · {c.systems}
                  </span>
                ))}
              </p>
            ) : null}
            {table?.noIndex ? (
              <p className="dim tiny">No galaxy index on this machine: only your own journals were read.</p>
            ) : null}
            {cutAsk
              ? (() => {
                  const b = byId.get(cutAsk.id);
                  if (!b) return null;
                  const n = cutAsk.n;
                  const after = b.end - n;
                  const flownFrom =
                    allRows.filter((r) => r.boxelId === b.id && r.n >= n && r.flown).length +
                    b.flownBeyond.length;
                  const skipped = b.skipped.includes(n);
                  return (
                    <div className="boxel-cut" role="alertdialog" aria-label="Delete from here">
                      <span>
                        Delete{" "}
                        <strong>
                          {b.boxel} -{n}
                        </strong>
                        {after > 0 ? ` and the ${after.toLocaleString()} after it` : ""}? The boxel will end
                        at -{n - 1}.
                        {flownFrom > 0 ? (
                          <>
                            {" "}
                            <strong className="warn">
                              {flownFrom} of the systems from -{n} on {flownFrom === 1 ? "is" : "are"} flown
                            </strong>{" "}
                            — the boxel goes on past it. To finish it without flying -{n}, skip it instead.
                          </>
                        ) : null}
                      </span>
                      <span className="boxel-cut__actions">
                        {flownFrom > 0 && !skipped ? (
                          <button
                            type="button"
                            className="fdb-chip fdb-chip--on"
                            onClick={() => {
                              setCutAsk(null);
                              void patch(b.id, { skip: n, on: true });
                            }}
                          >
                            Skip -{n} instead
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="fdb-chip boxel-del"
                          onClick={() => {
                            setCutAsk(null);
                            void patch(b.id, { cutFrom: n });
                          }}
                        >
                          Delete from -{n}
                        </button>
                        <button type="button" className="fdb-chip" onClick={() => setCutAsk(null)}>
                          Keep
                        </button>
                      </span>
                    </div>
                  );
                })()
              : null}
            {ticked.length ? (
              <div className="boxel-filter" role="search">
                <Select
                  ariaLabel="What the search looks at"
                  className="boxel-filter__kind"
                  value={filterKind}
                  options={BOXEL_FILTER_KINDS.map((k) => ({ value: k.value, label: k.label }))}
                  onChange={(v) => setFilterKind(v)}
                />
                <input
                  type="search"
                  className="my-exo-search-input boxel-filter__input"
                  placeholder={`${kindDef.label}: ${kindDef.hint}`}
                  aria-label={`Filter by ${kindDef.label.toLowerCase()}`}
                  list={suggestions.length ? "boxel-filter-suggest" : undefined}
                  value={filterQuery}
                  onChange={(ev) => setFilterQuery(ev.target.value)}
                />
                {suggestions.length ? (
                  <datalist id="boxel-filter-suggest">
                    {suggestions.map((x) => (
                      <option key={x} value={x} />
                    ))}
                  </datalist>
                ) : null}
                <button
                  type="button"
                  className={`disc-chip${notFlownOnly ? " disc-chip--on" : ""}`}
                  aria-pressed={notFlownOnly}
                  onClick={() => setNotFlownOnly(!notFlownOnly)}
                >
                  Not flown yet
                </button>
                <span className="dim tiny">
                  {rows.length === allRows.length
                    ? `${allRows.length.toLocaleString()} systems`
                    : `${rows.length.toLocaleString()} of ${allRows.length.toLocaleString()}`}
                </span>
              </div>
            ) : null}
            {!saved && !error ? (
              <LoadingNote label="Reading your boxels…" />
            ) : ticked.length && !table && !error ? (
              <LoadingNote
                label="Reading the systems in this boxel…"
                detail="Every system in it, with the galaxy index and what your journals know of each."
              />
            ) : ticked.length ? (
              <>
                <RefreshBar active={tableStale} />
                <div className={tableStale ? "is-refreshing" : undefined} aria-busy={tableStale}>
                  {tableEl}
                </div>
              </>
            ) : saved?.length ? (
              <p className="dim disc-empty">Tick a boxel in the side menu to list its systems.</p>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
