/**
 * Achievements (owner, 2026-09-27): every set, its bronze / silver / gold steps, and the one tracked.
 * The rules are in shared/dto/achievements.ts; the server builds the sets (server/achievements.ts).
 *
 * Galaxy-wide sets first, then one region at a time — the region the commander is in, unless another
 * is picked. A row opens to its entries, done and not. Tracking one marks its plants on the species
 * rows and in the HUD's Achievement section.
 */
import { isStrOrNull, usePersistedState } from "./usePersistedState";
import { useModal } from "./ui/useModal";
import { useToast } from "./ui/feedback";
import type { AchievementDetailDTO, AchievementDTO, AchievementsDTO } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";

const STEP = ["", "Bronze", "Silver", "Gold"] as const;
const KIND_LABEL: Record<AchievementDTO["kind"], string> = {
  galaxy: "Everything",
  genus: "Genus",
  rarity: "Rarity",
  region: "Region",
  regionGenus: "Genus",
  regionRarity: "Rarity",
  regionSampler: "Sampler",
  regionStars: "Stars",
  regionWorlds: "Worlds",
  regionSights: "Sights",
  regionGeology: "Geology",
  regionSpace: "Space-borne",
};

/** What makes one entry count, for the tooltip. */
function howItCounts(kind: AchievementDTO["kind"], legacy: boolean): string {
  if (kind === "regionStars" || kind === "regionWorlds" || kind === "regionGeology" || kind === "regionSpace")
    return "Counts once its codex entry is logged in this region";
  if (kind === "regionSights") return "Counts once you arrive in the system";
  if (kind === "regionSampler") return "Any plant of this tier, third sample done in this region";
  return legacy ? "Counts on its codex entry" : "Counts on its third sample";
}

const POI_NOTE =
  "Needs the EDAstro points of interest: open Points of interest in the menu and download them. This note goes away once they are here.";

function Progress({ a }: { a: AchievementDTO }) {
  const pct = (n: number) => (a.total > 0 ? (100 * n) / a.total : 0);
  return (
    <div
      className="ach-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={a.total}
      aria-valuenow={a.done}
      aria-label={`${a.done} of ${a.total}`}
    >
      <div className={`ach-bar__fill ach-bar__fill--s${a.step}`} style={{ width: `${pct(a.done)}%` }} />
      {a.thresholds.slice(0, 2).map((t, i) => (
        <span
          key={i}
          className="ach-bar__tick"
          style={{ left: `${pct(t)}%` }}
          title={`${STEP[i + 1]} at ${t}`}
        />
      ))}
    </div>
  );
}

function Medal({ step }: { step: AchievementDTO["step"] }) {
  if (!step) return <span className="ach-medal ach-medal--none">—</span>;
  return <span className={`ach-medal ach-medal--s${step}`}>{STEP[step]}</span>;
}

function nextStepNote(a: AchievementDTO): string {
  if (a.step >= 3) return "Complete";
  const need = a.thresholds[Math.min(a.step, 2) as 0 | 1 | 2] - a.done;
  return `${need} more for ${STEP[a.step + 1]}`;
}

function Detail({ id, kind }: { id: string; kind: AchievementDTO["kind"] }) {
  const [d, setD] = useState<AchievementDetailDTO | null>(null);
  const [err, setErr] = useState(false);
  const [showDone, setShowDone] = useState(false);
  useEffect(() => {
    let live = true;
    void fetch(`/api/achievements/detail?id=${encodeURIComponent(id)}`)
      .then((r) =>
        r.ok ? (r.json() as Promise<AchievementDetailDTO>) : Promise.reject(new Error(String(r.status))),
      )
      .then((j) => live && setD(j))
      .catch(() => live && setErr(true));
    return () => {
      live = false;
    };
  }, [id]);
  if (err) return <p className="dim ach-detail">Could not load this set.</p>;
  if (!d) return <p className="dim ach-detail">Loading…</p>;
  const todo = d.entries.filter((e) => !e.done);
  const done = d.entries.filter((e) => e.done);
  const when = (iso?: string) => (iso ? iso.slice(0, 10) : "");
  return (
    <div className="ach-detail">
      <h5 className="ach-detail__h">Still to find ({todo.length})</h5>
      {todo.length ? (
        <ul className="ach-entries">
          {todo.map((e) => (
            <li key={e.key} className="ach-entry ach-entry--todo" title={howItCounts(kind, e.legacy)}>
              {e.name}
              {e.hint ? <span className="dim"> — {e.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="dim">Nothing — every entry is done.</p>
      )}
      {done.length ? (
        <>
          <button
            type="button"
            className="ach-link ach-detail__toggle"
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone ? "Hide" : "Show"} done ({done.length})
          </button>
          {showDone ? (
            <ul className="ach-entries">
              {done.map((e) => (
                <li key={e.key} className="ach-entry ach-entry--done">
                  ✓ {e.name}
                  {e.hint ? <span className="dim"> — {e.hint}</span> : null}
                  <span className="dim">
                    {" "}
                    {e.doneIn ? `${e.doneIn}, ` : ""}
                    {when(e.doneAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Row({
  a,
  tracked,
  open,
  onOpen,
  onTrack,
}: {
  a: AchievementDTO;
  tracked: boolean;
  open: boolean;
  onOpen: () => void;
  onTrack: () => void;
}) {
  return (
    <li className={`ach-row${tracked ? " ach-row--tracked" : ""}${a.step === 3 ? " ach-row--gold" : ""}`}>
      <div className="ach-row__main">
        <button
          type="button"
          className="ach-row__name"
          onClick={onOpen}
          aria-expanded={open}
          title={`id: ${a.id}`}
        >
          <span className="ach-row__caret" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          {a.name}
          <span className="ach-row__kind">{KIND_LABEL[a.kind]}</span>
        </button>
        <Medal step={a.step} />
        <span className="ach-row__count">
          {a.done}/{a.total}
        </span>
        <button
          type="button"
          className={`ach-track${tracked ? " ach-track--on" : ""}`}
          onClick={onTrack}
          aria-pressed={tracked}
          disabled={a.total === 0 && !tracked}
          title={
            tracked
              ? "Stop tracking"
              : a.kind === "regionStars" ||
                  a.kind === "regionWorlds" ||
                  a.kind === "regionSights" ||
                  a.kind === "regionGeology" ||
                  a.kind === "regionSpace"
                ? "Track — the HUD lists what is still to find, nearest sights first"
                : "Track — mark its plants in the app and the HUD"
          }
        >
          {tracked ? "★ Tracked" : "☆ Track"}
        </button>
      </div>
      <Progress a={a} />
      <div className="ach-row__note dim">{a.needsPoi && a.total === 0 ? POI_NOTE : nextStepNote(a)}</div>
      {open && a.total > 0 ? <Detail id={a.id} kind={a.kind} /> : null}
    </li>
  );
}

/** One category on the overview: the galaxy, or one region. */
interface Category {
  key: string;
  name: string;
  sets: AchievementDTO[];
  /** The set the card's bar shows: End Game, or the region's "Complete". */
  head: AchievementDTO | null;
}

/** Groups inside a category view, in reading order. */
const SECTION_OF: Record<AchievementDTO["kind"], string> = {
  galaxy: "Everything",
  region: "Overview",
  regionSampler: "Overview",
  regionStars: "Overview",
  regionWorlds: "Overview",
  regionSights: "Overview",
  regionGeology: "Geology and phenomena",
  regionSpace: "Geology and phenomena",
  genus: "By genus",
  regionGenus: "By genus",
  rarity: "By rarity",
  regionRarity: "By rarity",
};
const SECTION_ORDER = ["Everything", "Overview", "Geology and phenomena", "By genus", "By rarity"];

function medalCounts(sets: readonly AchievementDTO[]): [number, number, number] {
  const n: [number, number, number] = [0, 0, 0];
  for (const a of sets) if (a.step > 0) n[a.step - 1]! += 1;
  return n;
}

function CategoryCard({
  c,
  here,
  tracking,
  matches,
  onOpen,
}: {
  c: Category;
  here: boolean;
  tracking: boolean;
  matches: number | null;
  onOpen: () => void;
}) {
  const [bronze, silver, gold] = medalCounts(c.sets);
  const h = c.head;
  const pct = h && h.total > 0 ? (100 * h.done) / h.total : 0;
  return (
    <li>
      <button
        type="button"
        className={`ach-card${here ? " ach-card--here" : ""}${tracking ? " ach-card--tracking" : ""}`}
        onClick={onOpen}
      >
        <span className="ach-card__name">{c.name}</span>
        <span className="ach-card__tags">
          {here ? <span className="ach-card__tag ach-card__tag--here">You are here</span> : null}
          {tracking ? <span className="ach-card__tag ach-card__tag--track">★ Tracking</span> : null}
          {matches != null ? <span className="ach-card__tag">{matches} matching</span> : null}
        </span>
        {h ? (
          <>
            <span className="ach-card__count">
              {h.done}/{h.total} {c.key === "galaxy" ? "variants" : "here"}
            </span>
            <span className="ach-bar ach-card__bar" aria-hidden="true">
              <span className={`ach-bar__fill ach-bar__fill--s${h.step}`} style={{ width: `${pct}%` }} />
            </span>
          </>
        ) : null}
        <span className="ach-card__medals">
          <span className="ach-medal--s3" title="Gold">
            {gold} gold
          </span>
          <span className="ach-medal--s2" title="Silver">
            {silver} silver
          </span>
          <span className="ach-medal--s1" title="Bronze">
            {bronze} bronze
          </span>
          <span className="dim">of {c.sets.length}</span>
        </span>
      </button>
    </li>
  );
}

export function AchievementsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const toast = useToast();
  const [data, setData] = useState<AchievementsDTO | null>(null);
  const [failed, setFailed] = useState(false);
  /** The category open, or null for the overview of cards. */
  const [category, setCategory] = usePersistedState<string | null>("achievements.category", null, isStrOrNull);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    void fetch("/api/achievements")
      .then((r) =>
        r.ok ? (r.json() as Promise<AchievementsDTO>) : Promise.reject(new Error(String(r.status))),
      )
      .then((j) => setData(j))
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  /** Galaxy first, then the region the commander is in, then the rest by name. */
  const categories = useMemo<Category[]>(() => {
    const all = data?.achievements ?? [];
    const galaxy: Category = {
      key: "galaxy",
      name: "Galaxy",
      sets: all.filter((a) => !a.region),
      head: all.find((a) => a.id === "galaxy") ?? null,
    };
    const byRegion = new Map<string, Category>();
    for (const a of all) {
      if (!a.region) continue;
      const rk = a.id.split(":")[1] ?? "";
      const c = byRegion.get(rk) ?? { key: rk, name: a.region, sets: [], head: null };
      c.sets.push(a);
      if (a.kind === "region") c.head = a;
      byRegion.set(rk, c);
    }
    const here = data?.currentRegion ?? null;
    const regions = [...byRegion.values()].sort(
      (x, y) => Number(y.key === here) - Number(x.key === here) || x.name.localeCompare(y.name),
    );
    return [galaxy, ...regions];
  }, [data]);

  const track = async (id: string | null) => {
    try {
      const r = await fetch("/api/achievements/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setData((d) => (d ? { ...d, trackedId: id } : d));
    } catch {
      toast.error("Could not change the tracked achievement.");
    }
  };

  const q = query.trim().toLowerCase();
  const nameMatches = (a: AchievementDTO) => !q || a.name.toLowerCase().includes(q);
  // A card stays when its name matches, or when any of its sets does (then it says how many).
  const cards = categories
    .map((c) => {
      if (!q || c.name.toLowerCase().includes(q)) return { c, matches: null as number | null };
      const n = c.sets.filter(nameMatches).length;
      return n ? { c, matches: n } : null;
    })
    .filter((x): x is { c: Category; matches: number | null } => x !== null);
  const current = category ? (categories.find((c) => c.key === category) ?? null) : null;
  const tracked = data?.achievements.find((a) => a.id === data.trackedId) ?? null;
  const trackedCategory = tracked ? (tracked.region ? tracked.id.split(":")[1] : "galaxy") : null;

  const rows = (list: AchievementDTO[]) => (
    <ul className="ach-list">
      {list.map((a) => (
        <Row
          key={a.id}
          a={a}
          tracked={data?.trackedId === a.id}
          open={open === a.id}
          onOpen={() => setOpen((o) => (o === a.id ? null : a.id))}
          onTrack={() => void track(data?.trackedId === a.id ? null : a.id)}
        />
      ))}
    </ul>
  );

  const categoryView = (c: Category) => {
    // The card's name matched, or nothing is typed: show everything in it.
    const list = !q || c.name.toLowerCase().includes(q) ? c.sets : c.sets.filter(nameMatches);
    return (
      <>
        <div className="ach-crumb">
          <button type="button" className="ach-link" onClick={() => setCategory(null)}>
            ← All categories
          </button>
          <h4 className="ach-h ach-crumb__h">{c.name}</h4>
        </div>
        {c.key !== "galaxy" && !data?.poiData ? (
          <p className="ach-poi-card">{POI_NOTE.replace("Needs", "The Sights set needs")}</p>
        ) : null}
        {SECTION_ORDER.map((sec) => {
          const part = list.filter((a) => SECTION_OF[a.kind] === sec);
          return part.length ? (
            <section key={sec} className="ach-section">
              <h5 className="ach-sub">{sec}</h5>
              {rows(part)}
            </section>
          ) : null;
        })}
        {list.length === 0 ? <p className="dim">Nothing matches.</p> : null}
      </>
    );
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-panel modal-panel--achievements"
        role="dialog"
        aria-modal="true"
        aria-labelledby="achievements-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="achievements-title">Achievements</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body modal-body--achievements">
          {failed ? (
            <p className="dim">The achievements could not be loaded.</p>
          ) : !data ? (
            <p className="dim">Loading…</p>
          ) : !data.available ? (
            <p className="dim">This build has no codex catalogue, so there is nothing to count against.</p>
          ) : (
            <>
              {tracked ? (
                <div className="ach-tracked">
                  <span className="ach-tracked__k">Tracking</span>
                  <button
                    type="button"
                    className="ach-link ach-tracked__name"
                    onClick={() => {
                      setCategory(trackedCategory);
                      setOpen(tracked.id);
                    }}
                    title="Open it"
                  >
                    {tracked.name}
                  </button>
                  <span>
                    {tracked.done}/{tracked.total}
                  </span>
                  <Medal step={tracked.step} />
                  <button type="button" className="ach-link" onClick={() => void track(null)}>
                    Stop
                  </button>
                </div>
              ) : null}
              <div className="ach-tools">
                <input
                  type="search"
                  className="ach-search"
                  placeholder={current ? `Filter ${current.name}` : "Search regions and achievements"}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search achievements"
                />
              </div>
              {current ? (
                categoryView(current)
              ) : (
                <>
                  <p className="dim ach-intro">
                    Every colour variant counts once per set: a plant counts on its third sample, a legacy
                    plant (Anemone, Brain Tree, Sinuous Tubers, Shards, Amphora, Bark Mounds) on its codex
                    entry. Each region also has Stars and Worlds (codex entries), a Sampler (one plant of each
                    rarity) and Sights (points of interest to fly to). From your journals only. Bronze at 25
                    %, Silver at 50 %, Gold at all of it.
                  </p>
                  {!data.poiData ? (
                    <p className="ach-poi-card">
                      {POI_NOTE.replace("Needs", "Each region's Sights set needs")}
                    </p>
                  ) : null}
                  {cards.length ? (
                    <ul className="ach-cards">
                      {cards.map(({ c, matches }) => (
                        <CategoryCard
                          key={c.key}
                          c={c}
                          here={c.key === data.currentRegion}
                          tracking={c.key === trackedCategory}
                          matches={matches}
                          onOpen={() => {
                            setCategory(c.key);
                            setOpen(null);
                          }}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="dim">Nothing matches.</p>
                  )}
                </>
              )}
              <p className="dim ach-source">{data.source}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
