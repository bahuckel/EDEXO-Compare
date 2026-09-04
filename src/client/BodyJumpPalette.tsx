import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BodyComputed } from "@shared/types";
import { useModal } from "./ui/useModal";
import { fuzzyRank } from "./fuzzyMatch";

/**
 * Ctrl+K — jump to any body by name.
 *
 * The tab strip is one scrollable row now, which is honest about how many bodies a system has but
 * slow to search by eye once a system has 20+. Typing beats scrolling, and it works no matter how
 * narrow the window is.
 */

export type BodyJumpItem = {
  key: string;
  label: string;
  bio: number | null;
  group: string | null;
};

export function bodyJumpItems(
  bodies: BodyComputed[],
  groupLabelByKey: Map<string, string> | null,
): BodyJumpItem[] {
  return bodies.map((b) => ({
    key: b.state.key,
    label: b.tabLabel,
    bio: b.state.biologicalSignals ?? null,
    group: groupLabelByKey?.get(b.state.key) ?? null,
  }));
}

export function BodyJumpPalette({
  items,
  selectedKey,
  onPick,
  onClose,
}: {
  items: BodyJumpItem[];
  selectedKey: string | null;
  onPick: (bodyKey: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const dialogRef = useModal<HTMLDivElement>(true, onClose, { autoFocus: false });

  const matches = useMemo(() => {
    const scored: Array<{ item: BodyJumpItem; rank: number }> = [];
    for (const item of items) {
      const rank = fuzzyRank(item.label, query.trim());
      if (rank != null) scored.push({ item, rank });
    }
    scored.sort((a, b) => a.rank - b.rank);
    return scored.map((s) => s.item);
  }, [items, query]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // A new query invalidates the highlighted row; start at the best match again.
  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const row = listRef.current?.children[active] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const commit = (key: string | undefined) => {
    if (!key) return;
    onPick(key);
    onClose();
  };

  return createPortal(
    <div className="modal-backdrop jump-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="modal jump-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to body"
        tabIndex={-1}
        onClick={(ev) => ev.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="jump-input"
          placeholder="Jump to body…"
          value={query}
          autoComplete="off"
          spellCheck={false}
          aria-label="Jump to body"
          aria-controls="jump-list"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "ArrowDown") {
              ev.preventDefault();
              setActive((i) => (matches.length ? (i + 1) % matches.length : 0));
            } else if (ev.key === "ArrowUp") {
              ev.preventDefault();
              setActive((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
            } else if (ev.key === "Enter") {
              ev.preventDefault();
              commit(matches[active]?.key);
            }
          }}
        />
        <ul id="jump-list" ref={listRef} className="jump-list" role="listbox">
          {matches.map((m, i) => (
            <li key={m.key} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`jump-row${i === active ? " jump-row--active" : ""}${
                  m.key === selectedKey ? " jump-row--current" : ""
                }`}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(m.key)}
              >
                <span className="jump-row-label">{m.label}</span>
                {m.bio != null ? <span className="jump-row-bio">{m.bio} bio</span> : null}
                {m.group ? <span className="jump-row-group dim">{m.group}</span> : null}
              </button>
            </li>
          ))}
          {matches.length === 0 ? <li className="jump-empty dim">No body matches “{query}”.</li> : null}
        </ul>
        <p className="jump-hint dim">
          <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> jump · <kbd>Esc</kbd> close
        </p>
      </div>
    </div>,
    document.body,
  );
}
