/**
 * The Bookmarks window (shared/bookmarks.ts): filter by tag, search, nearest or newest first. The ☆
 * and the button with their editor are in BookmarkButton.tsx.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { type BookmarkRowDTO, type BookmarksListDTO } from "@shared/bookmarks";
import { useModal } from "./ui/useModal";
import { CopySystemButton } from "./CopySystemButton";
import { isStr, isStrArr, usePersistedState } from "./usePersistedState";
import { BookmarkEditor, removeBookmark } from "./BookmarkButton";

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
