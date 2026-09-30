/**
 * Bookmarks (shared/bookmarks.ts): the ☆ on the system card and the galaxy map's Bookmark button, both
 * with the same editor, and the list.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { AppSnapshot } from "@shared/types";
import {
  MAX_NOTE_LENGTH,
  PRESET_TAGS,
  normaliseTag,
  type BookmarkDTO,
  type BookmarkRowDTO,
  type BookmarksListDTO,
} from "@shared/bookmarks";
import { useModal } from "./ui/useModal";
import { CopySystemButton } from "./CopySystemButton";
import { isStr, isStrArr, usePersistedState } from "./usePersistedState";

async function saveBookmark(b: Partial<BookmarkDTO> & { system: string }): Promise<BookmarkDTO | null> {
  const r = await fetch("/api/bookmarks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  });
  const j = (await r.json().catch(() => null)) as { ok?: boolean; bookmark?: BookmarkDTO } | null;
  if (j?.ok) window.dispatchEvent(new Event(BOOKMARKS_CHANGED));
  return j?.ok && j.bookmark ? j.bookmark : null;
}

async function removeBookmark(id: string): Promise<boolean> {
  const r = await fetch(`/api/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (r.ok) window.dispatchEvent(new Event(BOOKMARKS_CHANGED));
  return r.ok;
}

/** Bodies worth offering in the picker: the system's bio bodies and its notable ones. */
function bodyChoices(snap: AppSnapshot): { key: string; label: string }[] {
  const out = new Map<string, string>();
  for (const b of snap.bodies ?? []) out.set(b.state.key, b.tabLabel || b.state.bodyName || b.state.key);
  for (const n of snap.notableBodies ?? []) {
    const k = `${n.systemAddress}:${n.bodyId}`;
    if (!out.has(k)) out.set(k, `${n.bodyLabelShort} — ${n.tag}`);
  }
  return [...out]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** Tag chips: presets first, then the commander's own, then a box to add one. */
function TagPicker({
  tags,
  custom,
  onChange,
}: {
  tags: string[];
  custom: string[];
  onChange: (t: string[]) => void;
}) {
  const [text, setText] = useState("");
  const has = (t: string) => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const toggle = (t: string) =>
    onChange(has(t) ? tags.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...tags, t]);
  const all = [
    ...PRESET_TAGS,
    ...custom.filter((c) => !PRESET_TAGS.some((p) => p.toLowerCase() === c.toLowerCase())),
  ];
  for (const t of tags) if (!all.some((a) => a.toLowerCase() === t.toLowerCase())) all.push(t);
  const add = () => {
    const t = normaliseTag(text);
    if (t && !has(t)) onChange([...tags, t]);
    setText("");
  };
  return (
    <div className="bm-tags">
      {all.map((t) => (
        <button
          key={t}
          type="button"
          className={`fdb-chip${has(t) ? " fdb-chip--on" : ""}`}
          aria-pressed={has(t)}
          onClick={() => toggle(t)}
        >
          {t}
        </button>
      ))}
      <input
        className="bm-tag-input"
        value={text}
        maxLength={32}
        placeholder="+ your own tag"
        aria-label="Add a tag"
        onChange={(ev) => setText(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

/** The bookmark form, for a new one or an existing one. */
function BookmarkEditor({
  initial,
  bodies,
  pos = null,
  onSaved,
  onCancel,
}: {
  initial: Partial<BookmarkDTO> & { system: string; systemAddress: number | null };
  bodies: { key: string; label: string }[];
  pos?: { x: number; y: number; z: number } | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [tags, setTags] = useState<string[]>(initial.tags ?? []);
  const [note, setNote] = useState(initial.note ?? "");
  const [bodyKey, setBodyKey] = useState<string>(initial.bodyKey ?? "");
  const [custom, setCustom] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetch("/api/bookmarks")
      .then((r) => r.json())
      .then((j: BookmarksListDTO) => setCustom(j.customTags ?? []))
      .catch(() => {});
  }, []);
  const body = bodies.find((b) => b.key === bodyKey);
  const save = async () => {
    setBusy(true);
    const ok = await saveBookmark({
      ...(initial.id ? { id: initial.id } : {}),
      system: initial.system,
      systemAddress: initial.systemAddress,
      bodyKey: bodyKey || null,
      body: bodyKey ? (body?.label.split(" — ")[0] ?? initial.body ?? null) : null,
      tags,
      note,
      pos,
    });
    setBusy(false);
    if (ok) onSaved();
  };
  return (
    <div className="bm-editor">
      <div className="bm-editor__head">
        <strong>{initial.system}</strong>
        {bodies.length ? (
          <select value={bodyKey} onChange={(ev) => setBodyKey(ev.target.value)} aria-label="Body">
            <option value="">the whole system</option>
            {bodies.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <TagPicker tags={tags} custom={custom} onChange={setTags} />
      <textarea
        className="bm-note"
        value={note}
        maxLength={MAX_NOTE_LENGTH}
        placeholder="Note (optional)"
        rows={3}
        onChange={(ev) => setNote(ev.target.value)}
      />
      <div className="bm-editor__actions">
        <button type="button" className="fdb-chip fdb-chip--on" disabled={busy} onClick={() => void save()}>
          {initial.id ? "Save" : "Bookmark"}
        </button>
        <button type="button" className="fdb-chip" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * A bookmark button with its editor (owner, 2026-09-30: "the galaxy map should bookmark a system and
 * take notes, and the star on the main screen should work the same"). The editor opens on the page,
 * not inside the (clipped) card. `existing` is the system's first bookmark, when there is one.
 */
export function BookmarkButton({
  system,
  systemAddress,
  pos,
  existing,
  bodies = [],
  variant = "star",
}: {
  system: string;
  systemAddress: number | null;
  pos?: { x: number; y: number; z: number } | null;
  existing: BookmarkDTO | null;
  bodies?: { key: string; label: string }[];
  /** "star": the ☆ drawn by CSS (system card); "button": a labelled button (galaxy map). */
  variant?: "star" | "button";
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (!(ev.target instanceof Node)) return;
      if (wrap.current?.contains(ev.target) || pop.current?.contains(ev.target)) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const title = existing
    ? `Bookmarked: ${[existing.body, existing.tags.join(", "), existing.note].filter(Boolean).join(" · ") || "no tags"} — click to edit`
    : "Bookmark this system: tags and a note";
  const onClick = (ev: ReactMouseEvent<HTMLButtonElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const width = Math.min(416, window.innerWidth - 32);
    const top = r.bottom + 6 + 360 > window.innerHeight ? Math.max(16, r.top - 366) : r.bottom + 6;
    setAt({ left: Math.max(16, Math.min(r.left, window.innerWidth - width - 16)), top });
    setOpen((v) => !v);
  };
  return (
    <span className="bm-star-wrap" ref={wrap}>
      {variant === "star" ? (
        <button
          type="button"
          className={`bm-star${existing ? " bm-star--on" : ""}`}
          onClick={onClick}
          title={title}
          aria-label={title}
          aria-expanded={open}
        >
          {/* The glyph is drawn by CSS, so the system name's text stays just the name. */}
        </button>
      ) : (
        <button
          type="button"
          className={`g3d-btn bm-btn${existing ? " bm-btn--on" : ""}`}
          onClick={onClick}
          title={title}
          aria-expanded={open}
        >
          {existing ? "★ Bookmarked" : "☆ Bookmark"}
        </button>
      )}
      {open
        ? createPortal(
            <div ref={pop} className="bm-popover" role="dialog" aria-label="Bookmark" style={{ left: at.left, top: at.top }}>
              <BookmarkEditor
                initial={existing ?? { system, systemAddress }}
                bodies={bodies}
                pos={pos ?? null}
                onSaved={() => setOpen(false)}
                onCancel={() => setOpen(false)}
              />
              {existing ? (
                <button
                  type="button"
                  className="bm-remove"
                  onClick={() => void removeBookmark(existing.id).then(() => setOpen(false))}
                >
                  Remove bookmark
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

/** The ☆ beside the system name: filled when the system has a bookmark (the list holds the rest). */
export function BookmarkStar({ snap, system }: { snap: AppSnapshot; system: string }) {
  const here = snap.bookmarksHere ?? [];
  return (
    <BookmarkButton
      system={system}
      systemAddress={snap.viewingSystemAddress ?? snap.currentSystemAddress ?? null}
      existing={here[0] ?? null}
      bodies={bodyChoices(snap)}
    />
  );
}

/**
 * The same button for a system that is not on screen (the galaxy map): it looks its bookmark up
 * itself, and again after a save, so the label follows.
 */
export function SystemBookmarkButton({
  system,
  systemAddress,
  pos,
}: {
  system: string;
  systemAddress: number | null;
  pos?: { x: number; y: number; z: number } | null;
}) {
  const [existing, setExisting] = useState<BookmarkDTO | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let live = true;
    void fetch("/api/bookmarks")
      .then((r) => r.json())
      .then((j: BookmarksListDTO) => {
        if (!live) return;
        const hit = (j.items ?? []).find((b) =>
          systemAddress != null && b.systemAddress != null
            ? b.systemAddress === systemAddress
            : b.system.toLowerCase() === system.toLowerCase(),
        );
        setExisting(hit ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [system, systemAddress, rev]);
  // Re-read once the editor has saved or removed (bookmarks changed elsewhere reach it on reopen).
  useEffect(() => {
    const onChange = () => setRev((v) => v + 1);
    window.addEventListener(BOOKMARKS_CHANGED, onChange);
    return () => window.removeEventListener(BOOKMARKS_CHANGED, onChange);
  }, []);
  return <BookmarkButton system={system} systemAddress={systemAddress} pos={pos} existing={existing} variant="button" />;
}

/** Fired after a bookmark is saved or removed, so a button off the snapshot can re-read. */
const BOOKMARKS_CHANGED = "edexo:bookmarks-changed";

function ly(d: number | null): string {
  if (d == null) return "—";
  if (d < 1) return "here";
  if (d >= 10000) return `${(d / 1000).toFixed(1)} kly`;
  return `${Math.round(d).toLocaleString("en-US")} ly`;
}

/** The Bookmarks window: filter by tag, search, nearest or newest first. */
export function BookmarksModal({
  onClose,
  currentSystemAddress,
}: {
  onClose: () => void;
  currentSystemAddress: number | null;
}) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const [data, setData] = useState<BookmarksListDTO | null>(null);
  const [tagFilter, setTagFilter] = usePersistedState<string[]>("bookmarks.tags", [], isStrArr);
  const [sort, setSort] = usePersistedState("bookmarks.sort", "newest", isStr);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<BookmarkRowDTO | null>(null);
  const load = useCallback(() => {
    void fetch("/api/bookmarks")
      .then((r) => r.json())
      .then((j: BookmarksListDTO) => setData(j))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const tagsInUse = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of data?.items ?? []) for (const t of b.tags) m.set(t.toLowerCase(), t);
    return [...m.values()].sort((a, b) => a.localeCompare(b));
  }, [data]);
  const rows = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const want = tagFilter.map((t) => t.toLowerCase());
    const list = (data?.items ?? []).filter(
      (b) =>
        want.every((t) => b.tags.some((x) => x.toLowerCase() === t)) &&
        words.every((w) => [b.system, b.body ?? "", b.note, ...b.tags].join(" ").toLowerCase().includes(w)),
    );
    if (sort === "nearest") list.sort((a, b) => (a.distanceLy ?? Infinity) - (b.distanceLy ?? Infinity));
    return list;
  }, [data, tagFilter, search, sort]);

  const show = (b: BookmarkRowDTO) => {
    void (async () => {
      await fetch("/api/ui/view-system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemAddress: b.systemAddress === currentSystemAddress ? null : b.systemAddress,
        }),
      });
      if (b.bodyKey) {
        await fetch("/api/ui/selected-body", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bodyKey: b.bodyKey }),
        });
      }
    })();
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-panel fdb-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Bookmarks"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="fdb-head">
          <div>
            <h2 className="fdb-title">Bookmarks</h2>
            <p className="dim fdb-sub">
              Systems you marked with the ☆ beside a system&apos;s name, with their tags and notes. Kept on
              this PC.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {editing ? (
          <BookmarkEditor
            initial={editing}
            bodies={editing.bodyKey && editing.body ? [{ key: editing.bodyKey, label: editing.body }] : []}
            onSaved={() => {
              setEditing(null);
              load();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}

        <div className="carriers-search">
          <input
            type="search"
            className="carriers-search__input"
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            placeholder="Search system, body, tag, note"
            aria-label="Search bookmarks"
          />
          <button
            type="button"
            className={`fdb-chip${sort === "nearest" ? " fdb-chip--on" : ""}`}
            onClick={() => setSort(sort === "nearest" ? "newest" : "nearest")}
            aria-pressed={sort === "nearest"}
          >
            Nearest first
          </button>
        </div>
        {tagsInUse.length ? (
          <div className="fdb-filters">
            {tagsInUse.map((t) => {
              const on = tagFilter.some((x) => x.toLowerCase() === t.toLowerCase());
              return (
                <button
                  key={t}
                  type="button"
                  className={`fdb-chip${on ? " fdb-chip--on" : ""}`}
                  aria-pressed={on}
                  onClick={() =>
                    setTagFilter(
                      on ? tagFilter.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...tagFilter, t],
                    )
                  }
                >
                  {t}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="fdb-scroll">
          <table className="fdb-table carriers-table bm-table">
            <thead>
              <tr>
                <th>Distance</th>
                <th>System</th>
                <th>Tags</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>{ly(b.distanceLy)}</td>
                  <td>
                    <strong>{b.system}</strong>
                    <CopySystemButton system={b.system} />
                    {b.body ? <div className="dim">{b.body}</div> : null}
                  </td>
                  <td>
                    {b.tags.map((t) => (
                      <span key={t} className="bm-tag">
                        {t}
                      </span>
                    ))}
                  </td>
                  <td className="bm-note-cell">{b.note}</td>
                  <td className="bm-actions">
                    {b.systemAddress != null ? (
                      <button type="button" className="fdb-chip" onClick={() => show(b)}>
                        Show
                      </button>
                    ) : null}
                    <button type="button" className="fdb-chip" onClick={() => setEditing(b)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="fdb-chip"
                      onClick={() => {
                        if (window.confirm(`Remove the bookmark for ${b.system}?`))
                          void removeBookmark(b.id).then(load);
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && !data.items.length ? (
          <p className="fdb-empty">No bookmarks yet. Press the ☆ beside a system&apos;s name to add one.</p>
        ) : data && !rows.length ? (
          <p className="fdb-empty">Nothing matches.</p>
        ) : null}
      </div>
    </div>
  );
}
