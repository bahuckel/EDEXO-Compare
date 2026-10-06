/**
 * Boxel scanning from the keyboard (owner, 2026-10-06): the next system to fly goes to the clipboard,
 * ready to paste in the galaxy map, and key binds steer it — copy it again, start / finish a boxel run,
 * and the previous / next system of the boxel.
 *
 * - **Run**: Start makes the boxel he is in the run (saving it first when it is not saved yet) and
 *   copies its next system; while it runs, every jump copies the run's next system, wherever he is.
 *   Finish ends it, and so does a jump once every system is flown and the end is known.
 * - **No run**: after a jump into a saved boxel its next system is copied, when "Copy after each jump"
 *   is on (the Boxels screen).
 * - **Previous / next**: step through the systems still to fly (neither flown nor skipped) of the run,
 *   else of the saved boxel he is in, and copy each; a jump starts again from the next one.
 * - Past the last system known comes the one after it (EDJP counts up the same way): boxels number
 *   their systems without gaps, so it likely exists — until he marks the end with Not there.
 *   A run ends when every system is flown and the end is known.
 *
 * Delivery is the caller's (`deliver`): the desktop app's clipboard, or Windows' `clip` without it.
 */
import { parseBoxel } from "../shared/boxel.js";
import type { VisitedSystem } from "./boxel.js";
import type { SavedBoxelsService } from "./savedBoxels.js";

export interface BoxelRun {
  /** The next system to fly in the run, else in the saved boxel he is in; null when there is none. */
  next(): string | null;
  /** Copies {@link next}. Returns what was copied. */
  copyNext(): string | null;
  /** Copies the previous (-1) or next (+1) system still to fly from the last one copied. */
  step(dir: -1 | 1): string | null;
  /** Starts a run on the boxel he is in, or finishes the one running. Null: not in a boxel system. */
  toggle(): { running: boolean; boxel: string; copied: string | null } | null;
  /** A jump (FSDJump) just landed: copies what the run or the setting asks for. */
  onJump(): string | null;
}

export function createBoxelRun(d: {
  saved: SavedBoxelsService;
  visited: () => Iterable<VisitedSystem>;
  /** Systems known to exist: plotted routes and galaxy-map targets. */
  sightings: () => Iterable<{ name: string }>;
  currentSystem: () => string | null;
  deliver: (name: string) => void;
}): BoxelRun {
  /** The system last copied: where previous / next step from. */
  let cursor: { id: string; n: number } | null = null;

  const savedHere = (): string | null => {
    const cur = d.currentSystem();
    const b = cur ? parseBoxel(cur) : null;
    if (!b) return null;
    return (
      d.saved.list([], undefined, cur).find((x) => x.prefix.toLowerCase() === b.prefix.toLowerCase())?.id ??
      null
    );
  };
  const active = (): string | null => d.saved.runId() ?? savedHere();
  /**
   * What is left to fly, in numbers (`todo`, for previous / next) and in the order "next in line"
   * takes them (`queue`): after where he is, then the probe past the end while the end is not known,
   * then the ones before (owner, 2026-10-06: next in line, not the lowest one unflown).
   */
  const todoOf = (id: string) => {
    const r = d.saved.remaining(id, d.visited(), d.sightings(), d.currentSystem());
    if (!r) return null;
    const probe = r.endKnown ? [] : [r.end + 1];
    return {
      prefix: r.prefix,
      todo: [...r.todo, ...probe],
      queue: [...r.todo.filter((n) => n > r.anchor), ...probe, ...r.todo.filter((n) => n <= r.anchor)],
      done: r.endKnown && !r.todo.length,
    };
  };

  const copy = (id: string, prefix: string, n: number): string => {
    cursor = { id, n };
    const name = `${prefix}${n}`;
    d.deliver(name);
    return name;
  };

  const next = (): string | null => {
    const id = active();
    const r = id ? todoOf(id) : null;
    return r && r.queue.length ? `${r.prefix}${r.queue[0]}` : null;
  };

  const copyNext = (): string | null => {
    const id = active();
    const r = id ? todoOf(id) : null;
    if (!id || !r || !r.queue.length) return null;
    return copy(id, r.prefix, r.queue[0]!);
  };

  return {
    next,
    copyNext,
    step(dir) {
      const id = active();
      const r = id ? todoOf(id) : null;
      if (!id || !r || !r.todo.length) return null;
      // Nothing copied yet in this boxel: the first press copies the next in line itself.
      if (cursor?.id !== id) return copy(id, r.prefix, r.queue[0]!);
      const from = cursor.n;
      // The first one after (or before) the last copied; at either end it stays there.
      const pick =
        dir > 0
          ? (r.todo.find((n) => n > from) ?? r.todo[r.todo.length - 1]!)
          : ([...r.todo].reverse().find((n) => n < from) ?? r.todo[0]!);
      return copy(id, r.prefix, pick);
    },
    toggle() {
      const running = d.saved.runId();
      if (running) {
        const b = d.saved.list([]).find((x) => x.id === running);
        d.saved.setRun(null);
        cursor = null;
        return { running: false, boxel: b ? `${b.boxel} ${b.sector}` : "", copied: null };
      }
      const cur = d.currentSystem();
      const b = cur ? parseBoxel(cur) : null;
      if (!cur || !b || b.index == null) return null;
      const id = savedHere() ?? d.saved.add(cur)?.id ?? null;
      if (!id) return null;
      d.saved.setRun(id);
      return { running: true, boxel: `${b.boxel} ${b.sector}`, copied: copyNext() };
    },
    onJump() {
      cursor = null;
      const run = d.saved.runId();
      if (run) {
        const r = todoOf(run);
        // The run's last system flown and its end known: the run is over.
        if (!r || r.done || !r.queue.length) {
          d.saved.setRun(null);
          return null;
        }
        return copy(run, r.prefix, r.queue[0]!);
      }
      return d.saved.autoCopyNext() && savedHere() ? copyNext() : null;
    },
  };
}
